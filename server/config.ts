import { resolve } from 'node:path'

export type LlmProvider = 'openai' | 'gemini' | 'groq' | 'openrouter' | 'nvidia' | 'local'

export type ServerConfig = {
  port: number
  dbPath: string
  mediaDir: string
  staticDir: string
  appOrigin: string
  apiToken?: string
  maxBodyBytes: number

  // LLM / script generation
  llmProvider: LlmProvider
  openaiApiKey?: string
  openaiModel: string
  geminiApiKey?: string
  geminiModel: string
  // --- FREE providers ---
  groqApiKey?: string
  groqModel: string
  openrouterApiKey?: string
  openrouterModel: string
  nvidiaApiKey?: string
  nvidiaModel: string

  // YouTube
  youtubeApiKey?: string
  youtubeClientId?: string
  youtubeClientSecret?: string
  youtubeRefreshToken?: string
  youtubeOAuthRedirectUri?: string

  // TTS
  dograhApiUrl?: string
  dograhApiKey?: string
  speachesApiUrl?: string

  // Visuals
  pexelsApiKey?: string

  // Budget / scheduler
  automationPaused: boolean
  monthlyAiBudgetUsd: number
  reviewHourLondon: number
  publishHourLondon: number
  reviewLimit: number
  autoApprove: boolean
  autoPublish: boolean
}

const VALID_PROVIDERS: LlmProvider[] = ['openai', 'gemini', 'groq', 'openrouter', 'nvidia', 'local']

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const raw = String(env.LLM_PROVIDER || 'local')
  const llmProvider: LlmProvider = (VALID_PROVIDERS as string[]).includes(raw)
    ? (raw as LlmProvider)
    : 'local'

  const dataDir = env.DATA_DIR || resolve(process.cwd(), 'data')

  return {
    port: Number(env.PORT || 8787),
    dbPath: env.SHORTS_DB_PATH || resolve(dataDir, 'shorts-autopilot.sqlite'),
    mediaDir: env.MEDIA_DIR || resolve(dataDir, 'media'),
    staticDir: env.STATIC_DIR || resolve(process.cwd(), 'dist'),
    appOrigin: env.APP_ORIGIN || '*',
    apiToken: env.API_TOKEN,
    maxBodyBytes: Number(env.MAX_BODY_BYTES || 1_000_000),

    llmProvider,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL || 'gpt-4o-mini',
    geminiApiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
    geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
    // Free providers
    groqApiKey: env.GROQ_API_KEY,
    groqModel: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    openrouterApiKey: env.OPENROUTER_API_KEY,
    openrouterModel: env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free',
    nvidiaApiKey: env.NVIDIA_API_KEY,
    nvidiaModel: env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',

    youtubeApiKey: env.YOUTUBE_API_KEY,
    youtubeClientId: env.YOUTUBE_CLIENT_ID,
    youtubeClientSecret: env.YOUTUBE_CLIENT_SECRET,
    youtubeRefreshToken: env.YOUTUBE_REFRESH_TOKEN,
    youtubeOAuthRedirectUri: env.YOUTUBE_OAUTH_REDIRECT_URI,

    dograhApiUrl: env.DOGRAH_API_URL,
    dograhApiKey: env.DOGRAH_API_KEY,
    speachesApiUrl: env.SPEACHES_API_URL,
    pexelsApiKey: env.PEXELS_API_KEY,

    automationPaused: env.AUTOMATION_PAUSED === 'true',
    monthlyAiBudgetUsd: Number(env.MONTHLY_AI_BUDGET_USD || 5),
    reviewHourLondon: Number(env.REVIEW_HOUR_LONDON || 9),
    publishHourLondon: Number(env.PUBLISH_HOUR_LONDON || 18),
    reviewLimit: Number(env.REVIEW_LIMIT || 10),
    autoApprove: env.AUTO_APPROVE === 'true',
    autoPublish: env.AUTO_PUBLISH === 'true',
  }
}

export function providerReadiness(config: ServerConfig) {
  const llmReady =
    config.llmProvider === 'local' ||
    (config.llmProvider === 'openai' && Boolean(config.openaiApiKey)) ||
    (config.llmProvider === 'gemini' && Boolean(config.geminiApiKey)) ||
    (config.llmProvider === 'groq' && Boolean(config.groqApiKey)) ||
    (config.llmProvider === 'openrouter' && Boolean(config.openrouterApiKey)) ||
    (config.llmProvider === 'nvidia' && Boolean(config.nvidiaApiKey))

  return {
    llm: llmReady,
    llmProvider: config.llmProvider,
    groq: Boolean(config.groqApiKey),
    openrouter: Boolean(config.openrouterApiKey),
    nvidia: Boolean(config.nvidiaApiKey),
    youtube: Boolean(config.youtubeClientId && config.youtubeClientSecret && config.youtubeRefreshToken),
    youtubeSearch: Boolean(config.youtubeApiKey),
    dograh: Boolean(config.dograhApiUrl || config.speachesApiUrl),
    visuals: Boolean(config.pexelsApiKey),
    renderer: true,
    reviewMode: true,
  }
}
