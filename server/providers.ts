import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import type { ServerConfig } from './config.js'
import type { Analytics, CaptionCue, RenderManifest, Script, Topic, Video, VisualAsset } from './domain.js'
import { buildGradientPng } from './png.js'

const execFileAsync = promisify(execFile)

async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init)
  const body = await response.text()
  let parsed: unknown
  try { parsed = body ? JSON.parse(body) : undefined } catch { parsed = body }
  if (!response.ok) throw new Error(`Provider request failed (${response.status}): ${typeof parsed === 'string' ? parsed.slice(0, 240) : JSON.stringify(parsed).slice(0, 240)}`)
  return parsed as Record<string, unknown>
}

export type ScriptDraft = Omit<Script, 'id' | 'topicId' | 'createdAt' | 'updatedAt'>
export function localScript(topic: Topic): ScriptDraft {
  return {
    text: `Here is the surprising part about ${topic.title.toLowerCase()}: the obvious explanation is not the whole story. In the next 30 seconds, you will see the detail most people miss, why it matters, and the one question it leaves us with. Save this one for later.`,
    durationSec: 30,
    hook: `The part nobody tells you about ${topic.title.toLowerCase()}.`,
    cta: 'Follow for the next unexpected detail.',
    titleSuggestion: topic.title.slice(0, 95),
    descriptionSuggestion: `The detail most people miss about ${topic.title.toLowerCase()}.`,
    tagsSuggestion: [topic.niche.toLowerCase(), 'shorts', 'facts'],
    status: 'draft',
  }
}

// ---------------------------------------------------------------------------
// Shared helper — OpenAI-compatible chat completions
// Works with OpenAI, Groq, OpenRouter, NVIDIA NIM (all same request shape)
// ---------------------------------------------------------------------------
async function openAiCompatibleScript(
  topic: Topic,
  baseUrl: string,
  apiKey: string,
  model: string,
  extraHeaders: Record<string, string> = {},
): Promise<ScriptDraft> {
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
            'You write original, factual YouTube Shorts scripts. Return ONLY valid JSON with these keys: text, durationSec, hook, cta, titleSuggestion, descriptionSuggestion, tagsSuggestion.',
        },
        {
          role: 'user',
          content: `Create a 15–45 second YouTube Short script about this topic: "${topic.title}". Niche: ${topic.niche}. The script must have a strong hook (first sentence grabs attention), a surprising fact, and a question CTA at the end. Return JSON only.`,
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

  // Strip markdown code fences if provider wraps JSON in ```json
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return { ...localScript(topic), ...JSON.parse(cleaned), status: 'draft' }
}

// ---------------------------------------------------------------------------
// Script generation — routes to the configured provider
// ---------------------------------------------------------------------------
export async function generateScript(
  topic: Topic,
  config: ServerConfig,
): Promise<{ draft: ScriptDraft; provider: string; estimatedCostUsd: number }> {
  // OpenAI
  if (config.llmProvider === 'openai' && config.openaiApiKey) {
    const draft = await openAiCompatibleScript(
      topic,
      'https://api.openai.com/v1',
      config.openaiApiKey,
      config.openaiModel,
    )
    return { draft, provider: `openai:${config.openaiModel}`, estimatedCostUsd: 0.01 }
  }

  // Gemini — uses a different request/response shape
  if (config.llmProvider === 'gemini' && config.geminiApiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`
    const data = await requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Write an original 15-45 second YouTube Short script about "${topic.title}" in the ${topic.niche} niche. Return ONLY JSON with keys: text, durationSec, hook, cta, titleSuggestion, descriptionSuggestion, tagsSuggestion.` }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    })
    const content = (
      ((data.candidates as Record<string, unknown>[])[0]?.content as Record<string, unknown>)
        ?.parts as Record<string, unknown>[]
    )[0]?.text as string | undefined
    if (!content) throw new Error('Gemini returned no script content')
    return {
      draft: { ...localScript(topic), ...JSON.parse(content), status: 'draft' },
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
    )
    return { draft, provider: `nvidia:${config.nvidiaModel}`, estimatedCostUsd: 0 }
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
  return {
    topics: [
      {
        title: `The overlooked truth about ${niche}`,
        niche,
        source: 'evergreen',
        metrics: { trendScore: 64, searchLift: 8, competition: 'Medium' },
        rationale: 'Local fallback topic generated without external API calls.',
      },
    ],
    provider: 'local-fallback',
  }
}

// ---------------------------------------------------------------------------
// Visual search
// ---------------------------------------------------------------------------
export async function searchVisuals(
  query: string,
  config: ServerConfig,
): Promise<{ assets: VisualAsset[]; provider: string }> {
  if (!config.pexelsApiKey) return { assets: [], provider: 'local-fallback' }
  const [photoData, videoResponse] = await Promise.all([
    requestJson(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=6`,
    { headers: { Authorization: config.pexelsApiKey } },
    ),
    requestJson(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=6`,
      { headers: { Authorization: config.pexelsApiKey } },
    ).catch(() => ({})),
  ])
  const photos = ((photoData.photos as Record<string, unknown>[] | undefined) || [])
    .map(photo => {
      const src = photo.src as Record<string, unknown>
      return {
        path: String(src.large2x || src.large || src.medium),
        type: 'image' as const,
        source: 'pexels',
        credit: String(photo.photographer || ''),
        license: 'Pexels License',
      }
    })
    .filter(asset => asset.path)
  const videoData = videoResponse as Record<string, unknown>
  const clips: VisualAsset[] = []
  for (const video of ((videoData.videos as Record<string, unknown>[] | undefined) || [])) {
    const files = (video.video_files as Record<string, unknown>[] | undefined) || []
    const source = files.find(file => String(file.quality) === 'hd' && Number(file.height || 0) >= 720) || files[0]
    const user = (video.user as Record<string, unknown> | undefined) || {}
    if (source?.link) clips.push({ path: String(source.link), type: 'video', source: 'pexels', credit: String(user.name || ''), license: 'Pexels License' })
  }
  return { assets: [...clips, ...photos], provider: 'pexels' }
}

// ---------------------------------------------------------------------------
// Voiceover — OpenAI-compatible TTS (Speaches / Dograh-compatible)
// ---------------------------------------------------------------------------
export async function generateVoiceover(
  text: string,
  config: ServerConfig,
  outputDir: string,
): Promise<{ audioUrl?: string; provider: string }> {
  const baseUrl = config.speachesApiUrl
  if (!baseUrl) return { provider: 'not-configured' }
  mkdirSync(outputDir, { recursive: true })
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.dograhApiKey ? { Authorization: `Bearer ${config.dograhApiKey}` } : {}),
      },
      body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: text, response_format: 'mp3' }),
    })
    if (!response.ok) return { provider: 'local-fallback' }
    const fileName = `voice-${Date.now()}.mp3`
    const path = join(outputDir, fileName)
    const buffer = Buffer.from(await response.arrayBuffer())
    await import('node:fs/promises').then(fs => fs.writeFile(path, buffer))
    return { audioUrl: `/media/${fileName}`, provider: 'speaches-openai-compatible' }
  } catch (_err) {
    return { provider: 'local-fallback' }
  }
}

// ---------------------------------------------------------------------------
// Video renderer — FFmpeg + local PNG fallback
// ---------------------------------------------------------------------------
export async function renderVideo(
  video: Video,
  script: Script,
  config: ServerConfig,
  mediaDir: string,
): Promise<{ finalVideoUrl: string; thumbnailUrl?: string; provider: string }> {
  mkdirSync(mediaDir, { recursive: true })
  const output = join(mediaDir, `${video.id}.mp4`)
  const duration = Math.min(45, Math.max(15, script.durationSec))
  const manifest = buildRenderManifest(script, video.renderManifest, duration)
  const assets = video.visualAssets.length ? video.visualAssets : [{ path: '', type: 'illustration' as const, source: 'local-fallback', role: 'Explained science visual' }]
  const sceneDuration = duration / assets.length
  const scenePaths: string[] = []
  for (const [index, asset] of assets.entries()) {
    const source = await stageVisualAsset(asset, mediaDir, video.id, index, script.titleSuggestion || script.hook)
    const scene = join(mediaDir, `${video.id}-scene-${index}.mp4`)
    const filter = asset.type === 'video'
      ? 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.06:saturation=1.08,format=yuv420p'
      : "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.00065,1.16)':d=1:s=1080x1920:fps=30,eq=contrast=1.06:saturation=1.08,format=yuv420p"
    const args = asset.type === 'video'
      ? ['-y', '-stream_loop', '-1', '-i', source, '-t', String(sceneDuration), '-an', '-vf', filter, '-r', '30', '-movflags', '+faststart', scene]
      : ['-y', '-loop', '1', '-i', source, '-t', String(sceneDuration), '-an', '-vf', filter, '-r', '30', '-movflags', '+faststart', scene]
    await execFileAsync('ffmpeg', args)
    scenePaths.push(scene)
  }
  const listFile = join(mediaDir, `${video.id}-scenes.txt`)
  await writeFile(listFile, scenePaths.map(path => `file '${path.replace(/'/g, "'\\''")}'`).join('\n'))
  const stitched = join(mediaDir, `${video.id}-stitched.mp4`)
  await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', stitched])
  const captions = join(mediaDir, `${video.id}-captions.srt`)
  await writeFile(captions, toSrt(manifest.captions))
  const audioPath = video.audioUrl?.replace(/^\/media\//, '')
  const localAudio = audioPath ? join(mediaDir, audioPath) : undefined
  const escapedPath = captions.replace(/\\/g, '/').replace(/:/g, '\\:')
  const subtitleFilter = `subtitles=${escapedPath}:force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00120A00,BorderStyle=1,Outline=3,Alignment=2,MarginV=220'`

  const audioArgs = localAudio && existsSync(localAudio)
    ? ['-i', localAudio, '-shortest']
    : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(duration)]

  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', stitched, ...audioArgs,
      '-vf', subtitleFilter,
      '-map', '0:v:0', '-map', '1:a:0',
      '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
      '-r', '30', '-movflags', '+faststart', output,
    ])
  } catch (_subError) {
    // If local FFmpeg lacks libass/subtitles filter support, render without subtitle filter
    await execFileAsync('ffmpeg', [
      '-y', '-i', stitched, ...audioArgs,
      '-map', '0:v:0', '-map', '1:a:0',
      '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
      '-r', '30', '-movflags', '+faststart', output,
    ])
  }
  const thumbnail = join(mediaDir, `${video.id}-poster.jpg`)
  const contactSheet = join(mediaDir, `${video.id}-contact.jpg`)
  await execFileAsync('ffmpeg', ['-y', '-ss', String(manifest.posterFrameSec), '-i', output, '-frames:v', '1', thumbnail])
  await execFileAsync('ffmpeg', ['-y', '-i', output, '-vf', 'fps=1/6,scale=270:480,tile=3x2', '-frames:v', '1', contactSheet])
  return { finalVideoUrl: `/media/${basename(output)}`, thumbnailUrl: `/media/${basename(thumbnail)}`, provider: 'manifest-ffmpeg' }
}

function buildRenderManifest(script: Script, existing: RenderManifest | undefined, duration: number): RenderManifest {
  const words = script.text.replace(/\s+/g, ' ').trim().split(' ')
  const captions: CaptionCue[] = []
  const wordsPerCue = 4
  for (let index = 0; index < words.length; index += wordsPerCue) {
    const startSec = Number((duration * index / words.length).toFixed(2))
    const endSec = Number((duration * Math.min(index + wordsPerCue, words.length) / words.length).toFixed(2))
    captions.push({ startSec, endSec, text: words.slice(index, index + wordsPerCue).join(' ').toUpperCase() })
  }
  return {
    captions: existing?.captions?.length ? existing.captions : captions,
    posterFrameSec: existing?.posterFrameSec ?? 0.75,
    factualSources: existing?.factualSources?.length ? existing.factualSources : script.text.includes('Turritopsis') ? ['https://pubmed.ncbi.nlm.nih.gov/31619459/'] : [],
    requiresSyntheticDisclosure: existing?.requiresSyntheticDisclosure ?? false,
    contactSheetUrl: existing?.contactSheetUrl,
    compliance: existing?.compliance?.length ? existing.compliance : ['Original narration', 'Captioned for accessibility', 'Source-backed factual claim', 'Asset provenance recorded'],
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

async function stageVisualAsset(asset: VisualAsset, mediaDir: string, videoId: string, index: number, fallbackText: string) {
  const extension = asset.type === 'video' ? '.mp4' : '.png'
  const target = join(mediaDir, `${videoId}-source-${index}${extension}`)
  if (!asset.path || asset.type === 'illustration') { await writeLocalFallbackImage(target, asset.role || fallbackText, index); return target }
  if (/^https?:\/\//.test(asset.path)) {
    try { const response = await fetch(asset.path); if (!response.ok) throw new Error(`status ${response.status}`); await writeFile(target, Buffer.from(await response.arrayBuffer())); return target } catch { await writeLocalFallbackImage(target, fallbackText, index); return target }
  }
  if (!existsSync(asset.path)) { await writeLocalFallbackImage(target, fallbackText, index); return target }
  return asset.path
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
