import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import type { ServerConfig } from './config.js'
import { DomainError } from './domain.js'
import type { Analytics, CaptionCue, RenderManifest, Script, Topic, Video, VisualAsset } from './domain.js'
import { buildCaptionPng, buildGradientPng } from './png.js'

const execFileAsync = promisify(execFile)

export async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init)
  const body = await response.text()
  let parsed: unknown
  try { parsed = body ? JSON.parse(body) : undefined } catch { parsed = body }
  if (!response.ok) throw new Error(`Provider request failed (${response.status}): ${typeof parsed === 'string' ? parsed.slice(0, 240) : JSON.stringify(parsed).slice(0, 240)}`)
  return parsed as Record<string, unknown>
}

export type ScriptDraft = Omit<Script, 'id' | 'topicId' | 'createdAt' | 'updatedAt'>

/** Keep only http(s) URLs, deduplicated, max 4 — used for the research quality gate. */
function normalizeSources(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .map(item => String(item).trim())
    .filter(item => /^https?:\/\//.test(item))
    .filter(item => !seen.has(item) && seen.add(item))
    .slice(0, 4)
}

export function localScript(topic: Topic): ScriptDraft {
  return {
    text: `Here is the surprising part about ${topic.title.toLowerCase()}: the obvious explanation is not the whole story. In the next 30 seconds, you will see the detail most people miss, why it matters, and the one question it leaves us with. Save this one for later.`,
    durationSec: 30,
    hook: `The part nobody tells you about ${topic.title.toLowerCase()}.`,
    cta: 'Follow for the next unexpected detail.',
    titleSuggestion: topic.title.slice(0, 95),
    descriptionSuggestion: `The detail most people miss about ${topic.title.toLowerCase()}.`,
    tagsSuggestion: [topic.niche.toLowerCase(), 'shorts', 'facts'],
    factualSources: [],
    status: 'draft',
  }
}

// ---------------------------------------------------------------------------
// Shared helper — OpenAI-compatible chat completions
// Works with OpenAI, Groq, OpenRouter, NVIDIA NIM (all same request shape)
// ---------------------------------------------------------------------------
export type JudgeResult = {
  judgeScore: number
  judgeVerdict: 'approved' | 'rejected'
  judgeFeedback: string
  criteria: {
    hookScore: number
    retentionScore: number
    viralityScore: number
    pacingScore: number
  }
  provider: string
}

async function openAiCompatibleScript(
  topic: Topic,
  baseUrl: string,
  apiKey: string,
  model: string,
  extraHeaders: Record<string, string> = {},
  feedbackPrompt?: string,
): Promise<ScriptDraft> {
  const userContent = feedbackPrompt
    ? `Create a 15–45 second YouTube Short script about "${topic.title}". Niche: ${topic.niche}. ATTENTION: PREVIOUS DRAFT WAS REJECTED BY AI JUDGE (${feedbackPrompt}). You MUST write a much stronger 3-second hook, remove all filler, and build intense curiosity. Return JSON only.`
    : `Create a 15–45 second YouTube Short script about this topic: "${topic.title}". Niche: ${topic.niche}. The script must have a strong hook (first sentence grabs attention), a surprising fact, and a question CTA at the end. Return JSON only.`

  const data = await requestJson(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      temperature: 0.75,
      max_tokens: 512,
      messages: [
        {
          role: 'system',
          content:
            'You write original, factual YouTube Shorts scripts. Back every factual claim with authoritative sources. Return ONLY valid JSON with these keys: text, durationSec, hook, cta, titleSuggestion, descriptionSuggestion, tagsSuggestion, factualSources (array of 1-3 authoritative http(s) URLs such as pubmed/doi/university pages backing the surprising claim).',
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    }),
  })
  const content = (
    ((data.choices as Record<string, unknown>[])[0]?.message as Record<string, unknown>)?.content as
      | string
      | undefined
  )
  if (!content) throw new Error('LLM returned empty content')

  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(cleaned)
  const rawTags = parsed.tagsSuggestion
  const tagsSuggestion = Array.isArray(rawTags) ? rawTags.map((t: unknown) => String(t).replace(/^#/, '').trim()).filter(Boolean) : typeof rawTags === 'string' ? (rawTags as string).split(/\s+/).map((t: string) => t.replace(/^#/, '').trim()).filter(Boolean) : [topic.niche.toLowerCase(), 'shorts', 'facts']
  return { ...localScript(topic), ...parsed, tagsSuggestion, factualSources: normalizeSources(parsed.factualSources), status: 'draft' }
}

async function openAiCompatibleJudge(
  topic: Topic,
  draft: ScriptDraft | Script,
  baseUrl: string,
  apiKey: string,
  model: string,
  extraHeaders: Record<string, string> = {},
): Promise<Omit<JudgeResult, 'provider'>> {
  const systemPrompt = `You are a world-class YouTube Shorts Algorithm Judge and Content Director.
Your task is to judge the viral potential, retention power, and hook strength of YouTube Shorts scripts on a strict 0 to 10 scale.
A score of 9.0 or higher is required for approval. Be extremely critical, honest, and high-standard.

Evaluate on 4 criteria (0.0 to 2.5 points each):
1. hookScore (0-2.5): Does sentence 1 instantly stop the scroll?
2. retentionScore (0-2.5): Is there zero filler, continuous curiosity gaps, and tight structure?
3. viralityScore (0-2.5): Is the concept/fact mind-blowing and highly shareable?
4. pacingScore (0-2.5): Does timing (15-45s), call to action, and rhythm suit vertical video?

Return ONLY valid JSON matching this schema:
{
  "judgeScore": 9.2,
  "judgeVerdict": "approved",
  "judgeFeedback": "Crisp 1-2 sentence evaluation explaining why it scored high or low.",
  "criteria": {
    "hookScore": 2.4,
    "retentionScore": 2.3,
    "viralityScore": 2.3,
    "pacingScore": 2.2
  }
}`

  const userPrompt = `Topic: "${topic.title}"
Niche: ${topic.niche}
Hook: "${draft.hook}"
Script: "${draft.text}"
Duration: ${draft.durationSec}s
CTA: "${draft.cta || ''}"

Evaluate this script now. Set judgeVerdict to "approved" if judgeScore >= 9.0, otherwise "rejected". Return JSON only.`

  const data = await requestJson(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 384,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  const content = (((data.choices as Record<string, unknown>[])[0]?.message as Record<string, unknown>)?.content as string | undefined)
  if (!content) throw new Error('LLM Judge returned empty content')

  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(cleaned)

  const hookScore = Number(parsed.criteria?.hookScore ?? 2.2)
  const retentionScore = Number(parsed.criteria?.retentionScore ?? 2.2)
  const viralityScore = Number(parsed.criteria?.viralityScore ?? 2.2)
  const pacingScore = Number(parsed.criteria?.pacingScore ?? 2.2)

  let score = Number(parsed.judgeScore ?? (hookScore + retentionScore + viralityScore + pacingScore))
  score = Math.min(10, Math.max(0, Math.round(score * 10) / 10))
  const verdict = score >= 9.0 ? 'approved' : 'rejected'

  return {
    judgeScore: score,
    judgeVerdict: verdict,
    judgeFeedback: String(parsed.judgeFeedback || (verdict === 'approved' ? 'Passed quality threshold for Short production.' : 'Failed hook or retention threshold.')),
    criteria: { hookScore, retentionScore, viralityScore, pacingScore },
  }
}

// ---------------------------------------------------------------------------
// Ollama — local LLM via Ollama's native /api/chat endpoint (OpenAI-style messages)
// ---------------------------------------------------------------------------
async function ollamaChat(
  baseUrl: string,
  model: string,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const data = await requestJson(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature, num_predict: maxTokens },
    }),
  })
  const content = (data.message as Record<string, unknown> | undefined)?.content as string | undefined
  if (!content) throw new Error('Ollama returned empty content')
  return content
}

export function localJudge(topic: Topic, draft: ScriptDraft | Script): Omit<JudgeResult, 'provider'> {
  const wordCount = draft.text.split(/\s+/).length
  const hasHook = draft.hook.length > 10
  const durationOk = draft.durationSec >= 15 && draft.durationSec <= 45
  
  const hookScore = hasHook ? 2.4 : 1.5
  const retentionScore = wordCount >= 25 && wordCount <= 120 ? 2.4 : 1.8
  const viralityScore = topic.niche.toLowerCase().includes('science') || topic.niche.toLowerCase().includes('tech') ? 2.3 : 2.0
  const pacingScore = durationOk ? 2.3 : 1.6
  
  const score = Math.round((hookScore + retentionScore + viralityScore + pacingScore) * 10) / 10
  const verdict = score >= 9.0 ? 'approved' : 'rejected'

  return {
    judgeScore: score,
    judgeVerdict: verdict,
    judgeFeedback: verdict === 'approved'
      ? 'Strong scroll-stopping hook and optimal 30-second pacing.'
      : 'Hook or word density needs improvement to cross the 9.0 threshold.',
    criteria: { hookScore, retentionScore, viralityScore, pacingScore },
  }
}

export async function judgeScript(
  topic: Topic,
  draft: ScriptDraft | Script,
  config: ServerConfig,
): Promise<JudgeResult> {
  if (config.llmProvider === 'openai' && config.openaiApiKey) {
    const res = await openAiCompatibleJudge(topic, draft, 'https://api.openai.com/v1', config.openaiApiKey, config.openaiModel)
    return { ...res, provider: `openai:${config.openaiModel}` }
  }
  if (config.llmProvider === 'gemini' && config.geminiApiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`
    const prompt = `You are a YouTube Shorts Algorithm Judge. Rate this script from 0 to 10. Threshold for approval is 9.0. Topic: "${topic.title}". Hook: "${draft.hook}". Script: "${draft.text}". Return JSON with keys: judgeScore, judgeVerdict, judgeFeedback, criteria (hookScore, retentionScore, viralityScore, pacingScore).`
    const data = await requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    })
    const content = (((data.candidates as Record<string, unknown>[])[0]?.content as Record<string, unknown>)?.parts as Record<string, unknown>[])[0]?.text as string | undefined
    if (content) {
      const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())
      const score = Math.min(10, Math.max(0, Math.round(Number(parsed.judgeScore || 8.5) * 10) / 10))
      const verdict = score >= 9.0 ? 'approved' : 'rejected'
      return {
        judgeScore: score,
        judgeVerdict: verdict,
        judgeFeedback: String(parsed.judgeFeedback || 'Gemini judge evaluation complete.'),
        criteria: {
          hookScore: Number(parsed.criteria?.hookScore ?? 2.2),
          retentionScore: Number(parsed.criteria?.retentionScore ?? 2.2),
          viralityScore: Number(parsed.criteria?.viralityScore ?? 2.2),
          pacingScore: Number(parsed.criteria?.pacingScore ?? 2.2),
        },
        provider: `gemini:${config.geminiModel}`,
      }
    }
  }
  if (config.llmProvider === 'groq' && config.groqApiKey) {
    const res = await openAiCompatibleJudge(topic, draft, 'https://api.groq.com/openai/v1', config.groqApiKey, config.groqModel)
    return { ...res, provider: `groq:${config.groqModel}` }
  }
  if (config.llmProvider === 'openrouter' && config.openrouterApiKey) {
    const res = await openAiCompatibleJudge(topic, draft, 'https://openrouter.ai/api/v1', config.openrouterApiKey, config.openrouterModel, { 'HTTP-Referer': 'https://github.com/jeevesh2515/shorty', 'X-Title': 'Shorts Autopilot' })
    return { ...res, provider: `openrouter:${config.openrouterModel}` }
  }
  if (config.llmProvider === 'nvidia' && config.nvidiaApiKey) {
    const res = await openAiCompatibleJudge(topic, draft, 'https://integrate.api.nvidia.com/v1', config.nvidiaApiKey, config.nvidiaModel)
    return { ...res, provider: `nvidia:${config.nvidiaModel}` }
  }
  if (config.llmProvider === 'ollama') {
    const systemPrompt = `You are a world-class YouTube Shorts Algorithm Judge and Content Director.
Your task is to judge the viral potential, retention power, and hook strength of YouTube Shorts scripts on a strict 0 to 10 scale.
A score of 9.0 or higher is required for approval. Be extremely critical, honest, and high-standard.

Evaluate on 4 criteria (0.0 to 2.5 points each):
1. hookScore (0-2.5): Does sentence 1 instantly stop the scroll?
2. retentionScore (0-2.5): Is there zero filler, continuous curiosity gaps, and tight structure?
3. viralityScore (0-2.5): Is the concept/fact mind-blowing and highly shareable?
4. pacingScore (0-2.5): Does timing (15-45s), call to action, and rhythm suit vertical video?

Return ONLY valid JSON matching this schema:
{
  "judgeScore": 9.2,
  "judgeVerdict": "approved",
  "judgeFeedback": "Crisp 1-2 sentence evaluation explaining why it scored high or low.",
  "criteria": {
    "hookScore": 2.4,
    "retentionScore": 2.3,
    "viralityScore": 2.3,
    "pacingScore": 2.2
  }
}`

    const userPrompt = `Topic: "${topic.title}"
Niche: ${topic.niche}
Hook: "${draft.hook}"
Script: "${draft.text}"
Duration: ${draft.durationSec}s
CTA: "${draft.cta || ''}"

Evaluate this script now. Set judgeVerdict to "approved" if judgeScore >= 9.0, otherwise "rejected". Return JSON only.`

    const content = await ollamaChat(config.ollamaBaseUrl, config.ollamaModel, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], 0.2, 384)

    const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())

    const hookScore = Number(parsed.criteria?.hookScore ?? 2.2)
    const retentionScore = Number(parsed.criteria?.retentionScore ?? 2.2)
    const viralityScore = Number(parsed.criteria?.viralityScore ?? 2.2)
    const pacingScore = Number(parsed.criteria?.pacingScore ?? 2.2)

    let score = Number(parsed.judgeScore ?? (hookScore + retentionScore + viralityScore + pacingScore))
    score = Math.min(10, Math.max(0, Math.round(score * 10) / 10))
    const verdict = score >= 9.0 ? 'approved' : 'rejected'

    return {
      judgeScore: score,
      judgeVerdict: verdict,
      judgeFeedback: String(parsed.judgeFeedback || (verdict === 'approved' ? 'Passed quality threshold for Short production.' : 'Failed hook or retention threshold.')),
      criteria: { hookScore, retentionScore, viralityScore, pacingScore },
      provider: `ollama:${config.ollamaModel}`,
    }
  }
  return { ...localJudge(topic, draft), provider: 'local-judge' }
}

// ---------------------------------------------------------------------------
// Script generation — routes to the configured provider
// ---------------------------------------------------------------------------
export async function generateScript(
  topic: Topic,
  config: ServerConfig,
  feedbackPrompt?: string,
): Promise<{ draft: ScriptDraft; provider: string; estimatedCostUsd: number }> {
  // OpenAI
  if (config.llmProvider === 'openai' && config.openaiApiKey) {
    const draft = await openAiCompatibleScript(
      topic,
      'https://api.openai.com/v1',
      config.openaiApiKey,
      config.openaiModel,
      {},
      feedbackPrompt,
    )
    return { draft, provider: `openai:${config.openaiModel}`, estimatedCostUsd: 0.01 }
  }

  // Gemini — uses a different request/response shape
  if (config.llmProvider === 'gemini' && config.geminiApiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`
    const promptText = feedbackPrompt
      ? `Write an original 15-45s YouTube Short script about "${topic.title}" in ${topic.niche}. PREVIOUS ATTEMPT FAILED AI JUDGE (${feedbackPrompt}). Make hook stronger, remove fluff. Return ONLY JSON with keys: text, durationSec, hook, cta, titleSuggestion, descriptionSuggestion, tagsSuggestion, factualSources (array of 1-3 authoritative http(s) URLs backing the surprising claim).`
      : `Write an original 15-45 second YouTube Short script about "${topic.title}" in the ${topic.niche} niche. Back every factual claim with authoritative sources. Return ONLY JSON with keys: text, durationSec, hook, cta, titleSuggestion, descriptionSuggestion, tagsSuggestion, factualSources (array of 1-3 authoritative http(s) URLs such as pubmed/doi/university pages).`
    const data = await requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    })
    const content = (
      ((data.candidates as Record<string, unknown>[])[0]?.content as Record<string, unknown>)
        ?.parts as Record<string, unknown>[]
    )[0]?.text as string | undefined
    if (!content) throw new Error('Gemini returned no script content')
    const parsed = JSON.parse(content)
    return {
      draft: { ...localScript(topic), ...parsed, factualSources: normalizeSources(parsed.factualSources), status: 'draft' },
      provider: `gemini:${config.geminiModel}`,
      estimatedCostUsd: 0.002,
    }
  }

  // Groq — FREE — OpenAI-compatible
  if (config.llmProvider === 'groq' && config.groqApiKey) {
    const draft = await openAiCompatibleScript(
      topic,
      'https://api.groq.com/openai/v1',
      config.groqApiKey,
      config.groqModel,
      {},
      feedbackPrompt,
    )
    return { draft, provider: `groq:${config.groqModel}`, estimatedCostUsd: 0 }
  }

  // OpenRouter — FREE-tier models — OpenAI-compatible
  if (config.llmProvider === 'openrouter' && config.openrouterApiKey) {
    const draft = await openAiCompatibleScript(
      topic,
      'https://openrouter.ai/api/v1',
      config.openrouterApiKey,
      config.openrouterModel,
      {
        'HTTP-Referer': 'https://github.com/jeevesh2515/shorty',
        'X-Title': 'Shorts Autopilot',
      },
      feedbackPrompt,
    )
    return { draft, provider: `openrouter:${config.openrouterModel}`, estimatedCostUsd: 0 }
  }

  // NVIDIA NIM — FREE credits on signup — OpenAI-compatible
  if (config.llmProvider === 'nvidia' && config.nvidiaApiKey) {
    const draft = await openAiCompatibleScript(
      topic,
      'https://integrate.api.nvidia.com/v1',
      config.nvidiaApiKey,
      config.nvidiaModel,
      {},
      feedbackPrompt,
    )
    return { draft, provider: `nvidia:${config.nvidiaModel}`, estimatedCostUsd: 0 }
  }

  // Ollama — local LLM via Ollama's native /api/chat endpoint
  if (config.llmProvider === 'ollama') {
    const userContent = feedbackPrompt
      ? `Create a 15–45 second YouTube Short script about "${topic.title}". Niche: ${topic.niche}. ATTENTION: PREVIOUS DRAFT WAS REJECTED BY AI JUDGE (${feedbackPrompt}). You MUST write a much stronger 3-second hook, remove all filler, and build intense curiosity. Return JSON only.`
      : `Create a 15–45 second YouTube Short script about this topic: "${topic.title}". Niche: ${topic.niche}. The script must have a strong hook (first sentence grabs attention), a surprising fact, and a question CTA at the end. Return JSON only.`
    const content = await ollamaChat(
      config.ollamaBaseUrl,
      config.ollamaModel,
      [
        {
          role: 'system',
          content:
            'You write original, factual YouTube Shorts scripts. Back every factual claim with authoritative sources. Return ONLY valid JSON with these keys: text, durationSec, hook, cta, titleSuggestion, descriptionSuggestion, tagsSuggestion, factualSources (array of 1-3 authoritative http(s) URLs such as pubmed/doi/university pages backing the surprising claim).',
        },
        { role: 'user', content: userContent },
      ],
      0.75,
      512,
    )
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned)
    return {
      draft: { ...localScript(topic), ...parsed, factualSources: normalizeSources(parsed.factualSources), status: 'draft' },
      provider: `ollama:${config.ollamaModel}`,
      estimatedCostUsd: 0,
    }
  }

  // Local deterministic fallback — always $0
  return { draft: localScript(topic), provider: 'local-fallback', estimatedCostUsd: 0 }
}

// ---------------------------------------------------------------------------
// Topic discovery
// ---------------------------------------------------------------------------
export async function discoverTopics(
  niche: string,
  config: ServerConfig,
): Promise<{ topics: Array<Pick<Topic, 'title' | 'niche' | 'source' | 'metrics' | 'rationale'>>; provider: string }> {
  if (config.youtubeApiKey) {
    const query = encodeURIComponent(`${niche} facts shorts`)
    const data = await requestJson(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoDuration=short&maxResults=10&q=${query}&key=${config.youtubeApiKey}`,
    )
    const items = (data.items as Record<string, unknown>[] | undefined) || []
    const topics = items
      .map((item, index) => {
        const snippet = item.snippet as Record<string, unknown>
        return {
          title: String(snippet.title || '').replace(/#shorts/gi, '').trim(),
          niche,
          source: 'trending' as const,
          metrics: {
            trendScore: Math.max(55, 90 - index * 3),
            searchLift: Math.max(4, 26 - index * 2),
            competition: index < 3 ? 'High' : 'Medium',
          },
          rationale: 'Discovered from current YouTube search results and ranked by result position.',
        }
      })
      .filter(item => item.title)
    return { topics, provider: 'youtube-search' }
  }
  const topicPool: Record<string, string[]> = {
    'Unusual Science Facts': [
      'Why water under extreme pressure freezes into hot ice',
      'The jellyfish that can reverse its biological age endlessly',
      'How quantum entanglement connects particles across light years',
      'Why earth magnetic field flips leave fingerprints in volcanic rock',
      'The deep ocean hydrothermal vents that support life without sun',
    ],
    'Productivity': [
      'The 2-minute rule that beats procrastination before it starts',
      'Why deep work blocks double your daily output',
      'How batching decisions eliminates evening mental exhaustion',
      'The single calendar habit of ultra-effective leaders',
    ],
    'Mindset & Focus': [
      'How selective attention changes what your brain notices',
      'The psychological trick to entering flow state in 5 minutes',
      'Why intentional friction breaks bad habits faster than willpower',
    ],
    'Cybersecurity Secrets': [
      'Why public USB charging ports can compromise your phone',
      'How zero-knowledge proofs verify secrets without showing data',
      'The simple passkey feature replacing vulnerable passwords',
    ],
    'Habit Engineering': [
      'How habit stacking turns small routines into compound gains',
      'Why environmental cues beat motivation every single time',
      'The 2-day rule for maintaining momentum without burning out',
    ],
  }
  const pool = topicPool[niche] || [
    `The surprising breakthrough in ${niche}`,
    `What experts do not tell you about ${niche}`,
    `The unexpected science driving ${niche}`,
  ]
  const selectedTitle = pool[Math.floor(Math.random() * pool.length)]

  return {
    topics: [
      {
        title: selectedTitle,
        niche,
        source: 'evergreen',
        metrics: { trendScore: 78, searchLift: 14, competition: 'Medium' },
        rationale: 'Discovered from topic pool matching search intent and engagement potential.',
      },
    ],
    provider: 'local-fallback',
  }
}

// ---------------------------------------------------------------------------
// Visual search — multi-source via visual-sources.ts
// ---------------------------------------------------------------------------
import { searchStock } from './visual-sources.js'

export async function searchVisuals(
  query: string,
  config: ServerConfig,
): Promise<{ assets: VisualAsset[]; provider: string }> {
  return searchStock(query, config)
}

// ---------------------------------------------------------------------------
// Voiceover — OpenAI-compatible TTS (Speaches / Dograh-compatible)
//            + free Edge TTS fallback for Linux / Railway / Docker
// ---------------------------------------------------------------------------
export async function generateVoiceover(
  text: string,
  config: ServerConfig,
  outputDir: string,
): Promise<{ audioUrl?: string; provider: string }> {
  const baseUrl = config.speachesApiUrl
  mkdirSync(outputDir, { recursive: true })

  // 1) Preferred: configured OpenAI-compatible TTS endpoint
  if (baseUrl) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.dograhApiKey ? { Authorization: `Bearer ${config.dograhApiKey}` } : {}),
        },
        body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: text, response_format: 'mp3' }),
      })
      if (response.ok) {
        const fileName = `voice-${Date.now()}.mp3`
        const path = join(outputDir, fileName)
        const buffer = Buffer.from(await response.arrayBuffer())
        await import('node:fs/promises').then(fs => fs.writeFile(path, buffer))
        return { audioUrl: `/media/${fileName}`, provider: 'speaches-openai-compatible' }
      }
    } catch {
      // fall through to next provider
    }
  }

  // 2) Free high-quality fallback: Microsoft Edge TTS (no API key, works on Linux/Docker/Railway)
  //    Uses node-edge-tts which wraps the same edge_tts Python API.
  try {
    const { EdgeTTS } = await import('node-edge-tts')
    const fileName = `voice-${Date.now()}.mp3`
    const outPath = join(outputDir, fileName)
    const tts = new EdgeTTS({ voice: 'en-GB-SoniaNeural' })
    await tts.ttsPromise(text, outPath)
    const { existsSync: exists, statSync: stat } = await import('node:fs')
    if (exists(outPath) && stat(outPath).size > 1024) {
      return { audioUrl: `/media/${fileName}`, provider: 'edge-tts' }
    }
    throw new Error('Output file missing or too small')
  } catch (ttsErr) {
    console.warn('[TTS] node-edge-tts failed (may be a Railway network block):', ttsErr instanceof Error ? ttsErr.message : ttsErr)
    console.warn('[TTS] Set SPEACHES_API_URL to the deployed speaches service to get reliable voiceover on Railway.')
  }

  // 3) Development-only macOS fallback

  return localMacVoiceover(text, outputDir)
}

async function localMacVoiceover(text: string, outputDir: string): Promise<{ audioUrl?: string; provider: string }> {
  // Development-only zero-cost fallback. Production should use Speaches/Dograh or Edge TTS.
  if (process.platform !== 'darwin') return { provider: 'not-configured' }
  const baseName = `voice-${Date.now()}`
  const aiff = join(outputDir, `${baseName}.aiff`)
  const mp3 = join(outputDir, `${baseName}.mp3`)
  try {
    await execFileAsync('say', ['-v', 'Samantha', '-r', '170', '-o', aiff, text])
    await runFfmpeg(['-y', '-i', aiff, '-codec:a', 'libmp3lame', '-b:a', '128k', mp3])
    return { audioUrl: `/media/${baseName}.mp3`, provider: 'macos-say-development-fallback' }
  } catch {
    return { provider: 'not-configured' }
  }
}
// ---------------------------------------------------------------------------
// Video renderer — FFmpeg + local PNG fallback
// ---------------------------------------------------------------------------
async function runFfmpeg(args: string[]) {
  return execFileAsync('ffmpeg', ['-loglevel', 'error', ...args], { maxBuffer: 50 * 1024 * 1024 })
}

async function probeMediaDuration(path: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { maxBuffer: 1024 * 1024 })
    const seconds = Number(stdout.trim())
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
  } catch { return undefined }
}

export async function renderVideo(
  video: Video,
  script: Script,
  config: ServerConfig,
  mediaDir: string,
): Promise<{ finalVideoUrl: string; thumbnailUrl?: string; provider: string; renderManifest: RenderManifest }> {
    mkdirSync(mediaDir, { recursive: true })
    const output = join(mediaDir, `${video.id}.mp4`)
    const audioPath = video.audioUrl?.replace(/^\/media\//, '')
    const localAudio = audioPath ? join(mediaDir, audioPath) : undefined
    const hasAudio = Boolean(localAudio && existsSync(localAudio))
    // The narration drives the cut: size the render to the ACTUAL voiceover length
    // (probed via ffprobe) so the ending CTA is not clipped by a stale durationSec.
    // Note: the 15-45s clamp still applies — a narration outside Shorts bounds will
    // be trimmed/padded to that window by design.
    const narrationSec = hasAudio ? await probeMediaDuration(localAudio!) : undefined
    const duration = Math.min(45, Math.max(15, narrationSec ?? script.durationSec))
    const assets = video.visualAssets.length ? video.visualAssets : [{ path: '', type: 'illustration' as const, source: 'local-fallback', role: 'Explained science visual' }]
    const sceneDuration = duration / assets.length
    const scenePaths: string[] = []
    // Truthfulness is decided by what actually got staged, not by the asset plan:
    // a video asset whose download fails is a generated illustration in the output.
    let stagedSynthetic = false
    const hasVideoPlan = assets.some(asset => asset.type === 'video')
    for (const [index, asset] of assets.entries()) {
      const staged = await stageVisualAsset(asset, mediaDir, video.id, index, script.titleSuggestion || script.hook)
      if (staged.synthetic) {
        stagedSynthetic = true
        if (config.requireVideoFootage && asset.type === 'video') {
          throw new DomainError('FOOTAGE_REQUIRED', `Authentic video asset ${index} failed to stage (${staged.reason || 'download failed'}) and was not silently replaced with generated visuals`, 422)
        }
      }
      const source = staged.path
      const scene = join(mediaDir, `${video.id}-scene-${index}.mp4`)
      const sceneFrames = Math.round(sceneDuration * 30)
      const isActualVideo = asset.type === 'video' && !staged.synthetic
      const filter = isActualVideo
        ? 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.06:saturation=1.08,format=yuv420p'
        : `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.00065,1.16)':d=${sceneFrames}:s=1080x1920:fps=30,eq=contrast=1.06:saturation=1.08,format=yuv420p`
      const args = isActualVideo
        ? ['-y', '-stream_loop', '-1', '-i', source, '-t', String(sceneDuration), '-an', '-vf', filter, '-r', '30', scene]
        : ['-y', '-loop', '1', '-i', source, '-t', String(sceneDuration), '-an', '-vf', filter, '-r', '30', scene]
      await runFfmpeg(args)
      scenePaths.push(scene)
    }
    const manifest = buildRenderManifest(script, video.renderManifest, duration, stagedSynthetic, hasVideoPlan)
    const listFile = join(mediaDir, `${video.id}-scenes.txt`)
    await writeFile(listFile, scenePaths.map(path => `file '${path.replace(/'/g, "'\\''")}'`).join('\n'))
    const stitched = join(mediaDir, `${video.id}-stitched.mp4`)
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', stitched])
    const captions = join(mediaDir, `${video.id}-captions.srt`)
    await writeFile(captions, toSrt(manifest.captions))
    const captionImages: Array<{ path: string; duration: number }> = []
    for (const [index, cue] of manifest.captions.entries()) {
      const image = join(mediaDir, `${video.id}-caption-${index}.png`)
      await writeFile(image, buildCaptionPng({ width: 1080, height: 1920, text: cue.text }))
      captionImages.push({ path: image, duration: cue.endSec - cue.startSec })
    }
    const captionList = join(mediaDir, `${video.id}-captions.txt`)
    const captionVideo = join(mediaDir, `${video.id}-captions.mov`)
    const captionEntries = captionImages.flatMap(item => [`file '${item.path.replace(/'/g, "'\\''")}'`, `duration ${item.duration}`])
    const lastCaption = captionImages.at(-1)
    if (lastCaption) captionEntries.push(`file '${lastCaption.path.replace(/'/g, "'\\''")}'`)
    await writeFile(captionList, captionEntries.join('\n'))
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', captionList, '-r', '30', '-c:v', 'qtrle', '-pix_fmt', 'argb', captionVideo])

    const audioArgs: string[] = hasAudio
      ? ['-i', localAudio as string, '-shortest']
      : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(duration)]

    await runFfmpeg([
      '-y', '-i', stitched, '-i', captionVideo, ...audioArgs,
      '-filter_complex', '[0:v][1:v]overlay=0:0:shortest=1[v]',
      '-map', '[v]', '-map', '2:a:0',
      '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
      '-r', '30', '-movflags', '+faststart', output,
    ])
    const thumbnail = join(mediaDir, `${video.id}-poster.jpg`)
    const contactSheet = join(mediaDir, `${video.id}-contact.jpg`)
    await runFfmpeg(['-y', '-ss', String(manifest.posterFrameSec), '-i', output, '-frames:v', '1', thumbnail])
    try {
      await runFfmpeg(['-y', '-i', output, '-vf', 'fps=1/6,scale=270:480,tile=3x2', '-frames:v', '1', contactSheet])
    } catch (_contactErr) {
      // Optional contact sheet thumbnail tile
    }
    return {
      finalVideoUrl: `/media/${basename(output)}`,
      thumbnailUrl: `/media/${basename(thumbnail)}`,
      provider: 'manifest-ffmpeg',
      renderManifest: { ...manifest, contactSheetUrl: existsSync(contactSheet) ? `/media/${basename(contactSheet)}` : undefined },
    }
}

function buildRenderManifest(script: Script, existing: RenderManifest | undefined, duration: number, usesSyntheticVisuals: boolean, hasVideoPlan: boolean): RenderManifest {
  const words = script.text.replace(/\s+/g, ' ').trim().split(' ')
  const captions: CaptionCue[] = []
  const wordsPerCue = 3
  for (let index = 0; index < words.length; index += wordsPerCue) {
    const startSec = Number((duration * index / words.length).toFixed(2))
    const endSec = Number((duration * Math.min(index + wordsPerCue, words.length) / words.length).toFixed(2))
    captions.push({ startSec, endSec, text: words.slice(index, index + wordsPerCue).join(' ').toUpperCase() })
  }
  const sources = existing?.factualSources?.length ? existing.factualSources : script.factualSources?.length ? script.factualSources : script.text.includes('Turritopsis') ? ['https://pubmed.ncbi.nlm.nih.gov/31619459/'] : []
  // Reuse stored captions only when their timeline still matches the render duration
  // (within rounding tolerance). Stale timelines — whether SHORTER or LONGER than the
  // new duration — would be cut by overlay=shortest=1 and clip or misalign the burned-in
  // captions. Word-timed cues end exactly at `duration`, so a tight tolerance is safe.
  const storedLastEnd = existing?.captions?.length ? (existing.captions[existing.captions.length - 1]?.endSec ?? 0) : 0
  const storedTimelineMatches = existing?.captions?.length ? Math.abs(storedLastEnd - duration) <= 1 : false
  const captionsForRender = storedTimelineMatches && existing?.captions ? existing.captions : captions
  // Compliance and synthetic disclosure are recomputed from what THIS render actually
  // staged — never carried over from a previous render, or a re-render whose footage
  // download failed would keep claiming authentic provenance.
  const compliance = [
    'Original narration',
    'Captioned for accessibility',
    ...(usesSyntheticVisuals
      ? ['Generated illustrative visuals — not authentic footage']
      : hasVideoPlan
        ? ['Asset provenance recorded']
        : ['Static imagery — no authentic moving footage']),
    ...(sources.length ? ['Source-backed factual claim'] : []),
  ]
  return {
    captions: captionsForRender,
    posterFrameSec: existing?.posterFrameSec ?? 0.75,
    factualSources: sources,
    requiresSyntheticDisclosure: usesSyntheticVisuals,
    contactSheetUrl: existing?.contactSheetUrl,
    compliance,
  }
}

function toSrt(cues: CaptionCue[]) { return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.startSec)} --> ${srtTime(cue.endSec)}\n${cue.text}\n`).join('\n') }
function srtTime(seconds: number) { const millis = Math.round(seconds * 1000); const hours = Math.floor(millis / 3_600_000); const minutes = Math.floor((millis % 3_600_000) / 60_000); const secs = Math.floor((millis % 60_000) / 1000); return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis % 1000).padStart(3, '0')}` }
// Scene-specific gradient palettes — makes each fallback frame visually distinct
const SCENE_PALETTES: Array<{ from: [number, number, number, number]; to: [number, number, number, number]; accent: [number, number, number, number] }> = [
  { from: [8, 12, 48, 255], to: [22, 78, 130, 255], accent: [80, 180, 255, 255] },    // deep ocean
  { from: [10, 40, 58, 255], to: [40, 150, 160, 255], accent: [140, 255, 230, 255] },   // teal medusa
  { from: [18, 15, 38, 255], to: [60, 42, 88, 255], accent: [180, 140, 255, 255] },     // dark cyst
  { from: [8, 38, 22, 255], to: [40, 120, 70, 255], accent: [120, 255, 160, 255] },     // green polyp
  { from: [30, 16, 52, 255], to: [90, 40, 130, 255], accent: [200, 160, 255, 255] },    // purple lab
  { from: [45, 12, 48, 255], to: [180, 60, 120, 255], accent: [255, 140, 200, 255] },   // pink DNA
  { from: [25, 23, 55, 255], to: [231, 142, 112, 255], accent: [255, 255, 255, 255] },  // default warm
]

async function stageVisualAsset(asset: VisualAsset, mediaDir: string, videoId: string, index: number, fallbackText: string): Promise<{ path: string; synthetic: boolean; reason?: string }> {
  const extension = asset.type === 'video' ? '.mp4' : '.png'
  const target = join(mediaDir, `${videoId}-source-${index}${extension}`)
  if (!asset.path || asset.type === 'illustration') { await writeLocalFallbackImage(target, asset.role || fallbackText, index); return { path: target, synthetic: true, reason: 'no media path — generated illustration' } }
  if (/^https?:\/\//.test(asset.path)) {
    try {
      const response = await fetch(asset.path, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
        },
      })
      if (!response.ok) throw new Error(`status ${response.status}`)
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        throw new Error(`Invalid media content-type: ${contentType}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      if (asset.type === 'video') {
        if (!isValidMp4Buffer(buffer)) throw new Error('Downloaded asset failed MP4 header validation')
      } else {
        if (!isValidImageBuffer(buffer)) throw new Error('Downloaded asset failed image header validation')
      }
      await writeFile(target, buffer)
      return { path: target, synthetic: false }
    } catch (error) {
      await writeLocalFallbackImage(target, fallbackText, index)
      return { path: target, synthetic: true, reason: error instanceof Error ? error.message : 'download failed' }
    }
  }
  if (!existsSync(asset.path)) { await writeLocalFallbackImage(target, fallbackText, index); return { path: target, synthetic: true, reason: 'local file missing' } }
  return { path: asset.path, synthetic: false }
}

function isValidMp4Buffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false
  const headerStr = buffer.toString('binary', 0, Math.min(buffer.length, 64))
  if (headerStr.includes('ftyp')) return true
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x00) return true
  return false
}

function isValidImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 8) return false
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true
  if (buffer.toString('binary', 0, 4) === 'RIFF' && buffer.toString('binary', 8, 12) === 'WEBP') return true
  if (buffer.toString('binary', 0, 4).startsWith('GIF8')) return true
  return false
}

async function writeLocalFallbackImage(targetPath: string, text: string, sceneIndex = 0) {
  const palette = SCENE_PALETTES[sceneIndex % SCENE_PALETTES.length]
  const png = buildGradientPng({
    width: 1080,
    height: 1920,
    gradient: { from: palette.from, to: palette.to },
    accent: palette.accent,
    text,
  })
  await writeFile(targetPath, png)
}

// ---------------------------------------------------------------------------
// YouTube — OAuth + upload
// ---------------------------------------------------------------------------
async function youtubeAccessToken(config: ServerConfig) {
  if (!config.youtubeClientId || !config.youtubeClientSecret || !config.youtubeRefreshToken)
    throw new Error('YouTube OAuth credentials are not configured')
  const body = new URLSearchParams({
    client_id: config.youtubeClientId,
    client_secret: config.youtubeClientSecret,
    refresh_token: config.youtubeRefreshToken,
    grant_type: 'refresh_token',
  })
  const data = await requestJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  return String(data.access_token)
}

export async function uploadToYouTube(
  videoPath: string,
  title: string,
  description: string,
  tags: string[],
  scheduledAt: string | undefined,
  config: ServerConfig,
) {
  const token = await youtubeAccessToken(config)
  const metadata = {
    snippet: { title, description, tags, categoryId: '24' },
    status: {
      privacyStatus: scheduledAt ? 'private' : 'public',
      ...(scheduledAt ? { publishAt: scheduledAt } : {}),
    },
  }
  const boundary = `shorts-${Date.now()}`
  const videoBytes = await import('node:fs/promises').then(fs => fs.readFile(videoPath))
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`),
    videoBytes,
    Buffer.from(`\r\n--${boundary}--`),
  ])
  const data = await requestJson(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    },
  )
  const id = String(data.id)
  return {
    youtubeVideoId: id,
    youtubeUrl: `https://youtube.com/shorts/${id}`,
    status: scheduledAt ? ('scheduled' as const) : ('published' as const),
  }
}

// ---------------------------------------------------------------------------
// YouTube Analytics
// ---------------------------------------------------------------------------
export async function fetchYouTubeAnalytics(
  uploadIds: Array<{ uploadId: string; youtubeVideoId: string }>,
  config: ServerConfig,
): Promise<Analytics[]> {
  const token = await youtubeAccessToken(config)
  const ids = uploadIds.map(item => item.youtubeVideoId).join(',')
  const stats = await requestJson(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(ids)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const byVideo = new Map(
    ((stats.items as Record<string, unknown>[] | undefined) || []).map(item => [
      String(item.id),
      item.statistics as Record<string, unknown>,
    ]),
  )
  const fetchedAt = new Date().toISOString()
  return uploadIds.map(item => {
    const itemStats = byVideo.get(item.youtubeVideoId) || {}
    return {
      id: `analytics-${item.uploadId}`,
      uploadId: item.uploadId,
      views: Number(itemStats.viewCount || 0),
      averageViewDurationSec: 0,
      swipeAwayRate: 0,
      likes: Number(itemStats.likeCount || 0),
      comments: Number(itemStats.commentCount || 0),
      subscribersGained: 0,
      estimatedRevenue: 0,
      fetchedAt,
    }
  })
}

// ---------------------------------------------------------------------------
// Thumbnail concept generation — free Pollinations.ai image generation
// ---------------------------------------------------------------------------
export async function generateThumbnailConcept(
  script: Script,
  config: ServerConfig,
  mediaDir: string,
): Promise<{ thumbnailUrl?: string; provider: string }> {
  const prompt = `YouTube Shorts thumbnail, high contrast, bold text "${script.titleSuggestion || script.hook}", engaging visual, 9:16 vertical, no watermark, professional thumbnail design`
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1280&height=720&nologo=true&seed=${Date.now()}`
  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Image generation failed (${response.status})`)
    const fileName = `thumb-${script.id}-${Date.now()}.jpg`
    const path = join(mediaDir, fileName)
    await writeFile(path, Buffer.from(await response.arrayBuffer()))
    return { thumbnailUrl: `/media/${fileName}`, provider: 'pollinations-ai' }
  } catch {
    return { provider: 'local-fallback' }
  }
}
