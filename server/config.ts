import { resolve } from 'node:path'

export type ServerConfig = {
  port: number
  dbPath: string
  mediaDir: string
  staticDir: string
  appOrigin: string
  apiToken?: string
  maxBodyBytes: number
  llmProvider: 'openai' | 'gemini' | 'local'
  openaiApiKey?: string
  openaiModel: string
  geminiApiKey?: string
  geminiModel: string
  youtubeApiKey?: string
  youtubeClientId?: string
  youtubeClientSecret?: string
  youtubeRefreshToken?: string
  dograhApiUrl?: string
  dograhApiKey?: string
  speachesApiUrl?: string
  pexelsApiKey?: string
  automationPaused: boolean
  monthlyAiBudgetUsd: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const llmProvider = env.LLM_PROVIDER === 'openai' || env.LLM_PROVIDER === 'gemini' ? env.LLM_PROVIDER : 'local'
  return {
    port: Number(env.PORT || 8787),
    dbPath: env.SHORTS_DB_PATH || resolve(process.cwd(), 'data/shorts-autopilot.sqlite'),
    mediaDir: env.MEDIA_DIR || resolve(process.cwd(), 'data/media'),
    staticDir: env.STATIC_DIR || resolve(process.cwd(), 'dist'),
    appOrigin: env.APP_ORIGIN || 'http://localhost:5173',
    apiToken: env.API_TOKEN,
    maxBodyBytes: Number(env.MAX_BODY_BYTES || 1_000_000),
    llmProvider,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL || 'gpt-4o-mini',
    geminiApiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
    geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
    youtubeApiKey: env.YOUTUBE_API_KEY,
    youtubeClientId: env.YOUTUBE_CLIENT_ID,
    youtubeClientSecret: env.YOUTUBE_CLIENT_SECRET,
    youtubeRefreshToken: env.YOUTUBE_REFRESH_TOKEN,
    dograhApiUrl: env.DOGRAH_API_URL,
    dograhApiKey: env.DOGRAH_API_KEY,
    speachesApiUrl: env.SPEACHES_API_URL,
    pexelsApiKey: env.PEXELS_API_KEY,
    automationPaused: env.AUTOMATION_PAUSED === 'true',
    monthlyAiBudgetUsd: Number(env.MONTHLY_AI_BUDGET_USD || 5),
  }
}

export function providerReadiness(config: ServerConfig) {
  return {
    llm: config.llmProvider === 'local' || (config.llmProvider === 'openai' ? Boolean(config.openaiApiKey) : Boolean(config.geminiApiKey)),
    youtube: Boolean(config.youtubeClientId && config.youtubeClientSecret && config.youtubeRefreshToken),
    youtubeSearch: Boolean(config.youtubeApiKey),
    dograh: Boolean(config.dograhApiUrl || config.speachesApiUrl),
    visuals: Boolean(config.pexelsApiKey),
    renderer: true,
  }
}
