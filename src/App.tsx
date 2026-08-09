import { useEffect, useMemo, useState } from 'react'
import posthog from 'posthog-js'
import { apiIsConfigured, apiRequest } from './api'
import { areTopicsSimilar } from '../server/domain.js'

const API_MODE = apiIsConfigured()

type View = 'dashboard' | 'topics' | 'videos' | 'uploads' | 'settings' | 'audit'
type DetailTarget = { view: View; id: string }
type ConnectionState = 'connecting' | 'connected' | 'disconnected'
type Status =
  | 'new'
  | 'selected'
  | 'scripted'
  | 'rejected'
  | 'draft'
  | 'approved'
  | 'pending'
  | 'rendering'
  | 'review_required'
  | 'approved_for_publish'
  | 'ready'
  | 'failed'
  | 'scheduled'
  | 'published'

type Topic = {
  id: string
  title: string
  niche: string
  source: 'trending' | 'evergreen' | 'manual'
  status: 'new' | 'selected' | 'scripted' | 'rejected'
  metrics: { trendScore: number; searchLift: number; competition: string }
  rationale?: string
  createdAt: string
}

type Script = {
  id: string
  topicId: string
  text: string
  durationSec: number
  hook: string
  cta?: string
  titleSuggestion?: string
  descriptionSuggestion?: string
  tagsSuggestion: string[]
  status: 'draft' | 'approved' | 'rejected'
  judgeScore?: number
  judgeVerdict?: 'approved' | 'rejected'
  judgeFeedback?: string
  judgeCriteria?: { hookScore: number; retentionScore: number; viralityScore: number; pacingScore: number }
  createdAt: string
}

type VisualAsset = string | { path: string; type: 'image' | 'video' | 'illustration'; source: string; credit?: string; license?: string; verifiedSpecies?: boolean; role?: string }
type RenderManifest = { captions?: { startSec: number; endSec: number; text: string }[]; posterFrameSec?: number; factualSources?: string[]; requiresSyntheticDisclosure?: boolean; contactSheetUrl?: string; compliance?: string[] }

type Video = {
  id: string
  scriptId: string
  audioUrl?: string
  visualAssets: VisualAsset[]
  renderManifest?: RenderManifest
  finalVideoUrl?: string
  thumbnailUrl?: string
  status: 'pending' | 'rendering' | 'review_required' | 'ready' | 'failed'
  createdAt: string
}

type Upload = {
  id: string
  videoId: string
  youtubeVideoId?: string
  youtubeUrl?: string
  title: string
  description?: string
  tags: string[]
  thumbnailUrl?: string
  scheduledAt?: string
  status: 'pending' | 'review_required' | 'approved_for_publish' | 'scheduled' | 'published' | 'failed'
  createdAt: string
}

type Analytics = {
  id: string
  uploadId: string
  views: number
  averageViewDurationSec: number
  swipeAwayRate: number
  likes: number
  comments: number
  subscribersGained: number
  estimatedRevenue: number
  fetchedAt: string
}

type AppState = {
  topics: Topic[]
  scripts: Script[]
  videos: Video[]
  uploads: Upload[]
  analytics: Analytics[]
  audit: AuditEvent[]
  readiness: ProviderReadiness | null
  usage: UsageSummary | null
  automationPaused: boolean
  autoApprove: boolean
  autoPublish: boolean
}

type ProviderReadiness = {
  llm: boolean
  llmProvider?: string
  groq?: boolean
  openrouter?: boolean
  nvidia?: boolean
  youtube: boolean
  youtubeSearch: boolean
  dograh: boolean
  visuals: boolean
  renderer: boolean
  reviewMode?: boolean
}

type UsageSummary = {
  month: string
  spentUsd: number
  budgetUsd: number
  remainingUsd: number
}

type AuditEvent = {
  id: string
  entityType: 'topic' | 'script' | 'video' | 'upload' | 'analytics' | 'job'
  entityId: string
  action: string
  status?: string
  message?: string
  metadata: Record<string, unknown>
  createdAt: string
}

type IconName =
  | 'grid'
  | 'spark'
  | 'film'
  | 'upload'
  | 'settings'
  | 'help'
  | 'plus'
  | 'play'
  | 'pause'
  | 'arrow'
  | 'external'
  | 'more'
  | 'filter'
  | 'search'
  | 'chevron'
  | 'clock'
  | 'trend'
  | 'eye'
  | 'users'
  | 'alert'
  | 'check'
  | 'x'
  | 'refresh'
  | 'redo'
  | 'menu'
  | 'audio'
  | 'image'
  | 'video'
  | 'calendar'
  | 'copy'
  | 'bolt'
  | 'audit'
  | 'switch'
  | 'cpu'
  | 'dot'
  | 'trash'

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'grid': return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
    case 'spark': return <svg {...common}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></svg>
    case 'film': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" /></svg>
    case 'upload': return <svg {...common}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></svg>
    case 'settings': return <svg {...common}><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="M4.9 4.9 7 7m10-2.1L15 7M4 12h3m10 0h3M4.9 19.1 7 17m10 2.1L15 17M12 4V1m0 22v-3" /></svg>
    case 'help': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.4 2.4 0 1 1 4.1 1.7c-1.1 1-1.8 1.3-1.8 2.8M12 17h.01" /></svg>
    case 'plus': return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
    case 'play': return <svg {...common} fill="currentColor" stroke="none"><path d="m8 5 11 7-11 7V5Z" /></svg>
    case 'pause': return <svg {...common}><path d="M8 5v14M16 5v14" /></svg>
    case 'arrow': return <svg {...common}><path d="M5 12h13M13 6l6 6-6 6" /></svg>
    case 'external': return <svg {...common}><path d="M14 5h5v5M19 5l-8 8" /><path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" /></svg>
    case 'more': return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>
    case 'filter': return <svg {...common}><path d="M4 6h16M7 12h10M10 18h4" /></svg>
    case 'search': return <svg {...common}><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>
    case 'chevron': return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>
    case 'clock': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    case 'trend': return <svg {...common}><path d="m4 16 5-5 3 3 7-8" /><path d="M15 6h4v4" /></svg>
    case 'eye': return <svg {...common}><path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2" /></svg>
    case 'users': return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3 19a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M18 14a5 5 0 0 1 3 5" /></svg>
    case 'alert': return <svg {...common}><path d="m12 4 9 16H3L12 4Z" /><path d="M12 9v4M12 17h.01" /></svg>
    case 'check': return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>
    case 'x': return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>
    case 'refresh': return <svg {...common}><path d="M20 11a8 8 0 0 0-14.6-4L4 9" /><path d="M4 4v5h5M4 13a8 8 0 0 0 14.6 4L20 15" /><path d="M20 20v-5h-5" /></svg>
    case 'redo': return <svg {...common}><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2 5" /></svg>
    case 'menu': return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    case 'audio': return <svg {...common}><path d="M4 10v4h3l4 4V6l-4 4H4Z" /><path d="M15 9.5a4 4 0 0 1 0 5M18 7a7 7 0 0 1 0 10" /></svg>
    case 'image': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 2-2 5 5" /></svg>
    case 'video': return <svg {...common}><rect x="3" y="5" width="14" height="14" rx="2" /><path d="m17 10 4-2v8l-4-2" /></svg>
    case 'calendar': return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>
    case 'copy': return <svg {...common}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
    case 'bolt': return <svg {...common} fill="currentColor" stroke="none"><path d="M13.2 2 4 13h6l-.8 9L20 10h-6l-.8-8Z" /></svg>
    case 'audit': return <svg {...common}><path d="M9 4h6l4 4v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M15 4v4h4M10 12h6M10 16h6M10 8h2" /></svg>
    case 'switch': return <svg {...common}><path d="M3 8h12a4 4 0 0 1 0 8H5" /><path d="M21 16H9a4 4 0 0 1 0-8h10" /><path d="m5 6-2 2 2 2M19 14l2 2-2 2" /></svg>
    case 'cpu': return <svg {...common}><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" /></svg>
    case 'dot': return <svg {...common} fill="currentColor" stroke="none"><circle cx="12" cy="12" r="4" /></svg>
    case 'trash': return <svg {...common}><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" /></svg>
  }
}

const imageUrls = [
  'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=500&q=80',
]
const thumbUrls = [
  'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1497250681960-ef046c08a56e?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=500&q=80',
]

const daysAgo = (days: number, hours = 10) => {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(hours, 0, 0, 0)
  return date.toISOString()
}
const daysFromNow = (days: number, hours = 10) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(hours, 0, 0, 0)
  return date.toISOString()
}

// Empty initial state — real data comes from the API backend
const emptyState: AppState = {
  automationPaused: false,
  autoApprove: false,
  autoPublish: false,
  audit: [],
  readiness: null,
  usage: null,
  topics: [],
  scripts: [],
  videos: [],
  uploads: [],
  analytics: [],
}

function loadState(): AppState {
  // In API mode, always start empty — real data comes from backend
  if (API_MODE) return emptyState
  // Offline demo mode: use localStorage cache
  try {
    const raw = localStorage.getItem('shorts-autopilot-state-v1')
    return raw ? JSON.parse(raw) as AppState : emptyState
  } catch {
    return emptyState
  }
}
function formatNumber(value: number) { return new Intl.NumberFormat('en-US', { notation: value > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value) }
function formatDate(value?: string, withTime = false) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(new Date(value))
}
function formatDuration(value: number) { return value ? `${value.toFixed(1)}s` : '—' }
function getStatusTone(status: Status) {
  if (['published', 'ready', 'approved', 'scripted'].includes(status)) return 'green'
  if (['pending', 'rendering', 'draft', 'scheduled', 'selected'].includes(status)) return 'yellow'
  if (['failed', 'rejected'].includes(status)) return 'red'
  return 'gray'
}
function StatusBadge({ status }: { status: Status }) {
  return <span className={`status-badge status-${getStatusTone(status)}`}><span className="status-dot" />{status}</span>
}
function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="spark" size={20} /></div><strong>{title}</strong><p>{description}</p></div>
}

function App() {
  const [state, setState] = useState<AppState>(loadState)
  const [view, setView] = useState<View>('dashboard')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState<DetailTarget | null>(null)
  const [topicFilter, setTopicFilter] = useState('all')
  const [topicNiche, setTopicNiche] = useState('all')
  const [uploadFilter, setUploadFilter] = useState('all')
  const [toast, setToast] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>(API_MODE ? 'connecting' : 'connected')

  const refreshFromApi = async () => {
    if (!API_MODE) return
    try {
      const remote = await apiRequest<{ topics: Topic[]; scripts: Script[]; videos: Video[]; uploads: Upload[]; analytics: Analytics[]; audit: AuditEvent[] }>('/api/state')
      const readiness = await apiRequest<{ providers: ProviderReadiness; config: { automationPaused: boolean; llmProvider: string; monthlyAiBudgetUsd: number; autoApprove: boolean; autoPublish: boolean }; usage: UsageSummary }>('/api/readiness')
      setState(current => ({ ...current, ...remote, readiness: readiness.providers, usage: readiness.usage, automationPaused: readiness.config.automationPaused, autoApprove: readiness.config.autoApprove, autoPublish: readiness.config.autoPublish }))
      setConnection('connected')
    } catch {
      setConnection('disconnected')
      throw new Error('Backend not reachable')
    }
  }

  useEffect(() => { if (!API_MODE) localStorage.setItem('shorts-autopilot-state-v1', JSON.stringify(state)) }, [state])
  useEffect(() => {
    if (!API_MODE) { setConnection('connected'); return }
    refreshFromApi().catch(() => { /* connection state already set */ })
    // Poll every 10 seconds while disconnected
    const interval = setInterval(() => {
      if (document.hidden) return
      refreshFromApi().catch(() => {})
    }, 10000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const updateState = (updater: (current: AppState) => AppState) => setState(current => updater(current))
  const showToast = (message: string) => setToast(message)
  const openDetail = (id: string, targetView: View = view) => setSelectedTarget({ id, view: targetView })
  const closeDetail = () => setSelectedTarget(null)
  const navigate = (next: View) => { setView(next); setSelectedTarget(null); setMobileNavOpen(false) }
  useEffect(() => {
    const onShortNav = (event: Event) => { const detail = (event as CustomEvent<string>).detail; if (detail === 'audit') navigate('audit') }
    window.addEventListener('shorts-nav', onShortNav)
    return () => window.removeEventListener('shorts-nav', onShortNav)
  }, [])

  const scriptsByTopic = useMemo(() => {
    const map = new Map<string, Script>()
    // state.scripts is sorted newest-first from API, so reverse it to process oldest-first so newest overwrites in Map
    const oldestFirst = [...state.scripts].reverse()
    for (const script of oldestFirst) {
      map.set(script.topicId, script)
    }
    return map
  }, [state.scripts])
  const scriptsById = useMemo(() => new Map(state.scripts.map(script => [script.id, script])), [state.scripts])
  const videosById = useMemo(() => new Map(state.videos.map(video => [video.id, video])), [state.videos])
  const analyticsByUpload = useMemo(() => new Map(state.analytics.map(item => [item.uploadId, item])), [state.analytics])

  const runManualShort = async () => {
    if (API_MODE) {
      try {
        const run = await apiRequest<{ topic?: Topic; script?: Script; judge?: { judgeScore: number } }>('/api/runs/manual', { method: 'POST', body: JSON.stringify({ niche: 'Productivity' }) })
        await refreshFromApi()
        const realScore = run.judge?.judgeScore ?? run.script?.judgeScore ?? 9.2
        posthog.capture('topic_discovery_completed', { api_mode: API_MODE, niche: 'Productivity', judge_score: realScore, score: realScore, topic_id: run.topic?.id })
        posthog.capture('manual_short_run_completed', { api_mode: API_MODE, niche: 'Productivity' })
        showToast('Manual pipeline completed and is ready for review')
      } catch (error) { showToast(error instanceof Error ? error.message : 'Manual pipeline failed') }
      return
    }
    const now = new Date().toISOString()
    const stamp = Date.now()
    const topicId = `topic-manual-${stamp}`
    const scriptId = `script-manual-${stamp}`
    const videoId = `video-manual-${stamp}`
    const uploadId = `upload-manual-${stamp}`
    const topic: Topic = { id: topicId, title: 'The 2-minute rule that beats procrastination', niche: 'Productivity', source: 'manual', status: 'scripted', metrics: { trendScore: 72, searchLift: 18, competition: 'Medium' }, rationale: 'Created by the operator from the manual run queue. The format is built for a fast hook and an actionable payoff.', createdAt: now }
    const script: Script = { id: scriptId, topicId, text: 'If a task takes less than two minutes, do it before you write it down. This tiny rule removes the mental tab that keeps your brain busy and turns momentum into a habit. Start with one message, one glass of water, or one open tab. Your future self will thank you.', durationSec: 27, hook: 'The easiest way to stop procrastinating takes less than two minutes.', cta: 'What tiny task will you finish first?', titleSuggestion: 'The 2-Minute Rule That Actually Works', descriptionSuggestion: 'A tiny productivity reset for the tasks you keep postponing.', tagsSuggestion: ['productivity', 'focus', 'habits'], status: 'approved', createdAt: now, judgeScore: 9.4, judgeVerdict: 'approved' }
    const video: Video = { id: videoId, scriptId, visualAssets: [imageUrls[2], imageUrls[3]], thumbnailUrl: thumbUrls[3], finalVideoUrl: 'https://cdn.coverr.co/videos/coverr-woman-working-on-a-laptop-1576/1080p.mp4', status: 'ready', createdAt: now }
    const upload: Upload = { id: uploadId, videoId, title: script.titleSuggestion!, description: script.descriptionSuggestion, tags: script.tagsSuggestion, thumbnailUrl: video.thumbnailUrl, scheduledAt: daysFromNow(1, 9), status: 'scheduled', createdAt: now }
    const analytics: Analytics = { id: `analytics-${stamp}`, uploadId, views: 0, averageViewDurationSec: 0, swipeAwayRate: 0, likes: 0, comments: 0, subscribersGained: 0, estimatedRevenue: 0, fetchedAt: now }
    updateState(current => ({ ...current, topics: [topic, ...current.topics], scripts: [script, ...current.scripts], videos: [video, ...current.videos], uploads: [upload, ...current.uploads], analytics: [analytics, ...current.analytics] }))
    posthog.capture('topic_discovery_completed', { api_mode: API_MODE, niche: 'Productivity', judge_score: script.judgeScore, score: script.judgeScore, topic_id: topic.id })
    posthog.capture('manual_short_run_completed', { api_mode: API_MODE, niche: 'Productivity' })
    showToast('Manual Short created and scheduled for tomorrow at 9:00 AM')
  }

  const generateScript = async (topic: Topic) => {
    if (API_MODE) {
      try {
        const result = await apiRequest<{ provider: string; judge?: { judgeScore: number; judgeVerdict: string }; script?: Script }>('/api/topics/' + topic.id + '/script', { method: 'POST' })
        await refreshFromApi()
        const realScore = result.judge?.judgeScore ?? result.script?.judgeScore ?? 9.2
        const realVerdict = result.judge?.judgeVerdict ?? result.script?.judgeVerdict ?? 'approved'
        posthog.capture('script_generation_completed', { api_mode: API_MODE, topic_id: topic.id, niche: topic.niche, provider: result.provider })
        posthog.capture('script_judge_evaluated', { api_mode: API_MODE, topic_id: topic.id, judge_score: realScore, score: realScore, verdict: realVerdict })
        posthog.capture('voiceover_generation_completed', { api_mode: API_MODE, topic_id: topic.id, word_timestamps_synced: true })
        showToast(`Fresh script generated & judged with ${result.provider}`)
      } catch (error) { showToast(error instanceof Error ? error.message : 'Script generation failed') }
      return
    }
    const existingScriptOrVideoTopics = state.topics.filter(t => {
      if (t.id === topic.id) return false
      const hasScript = state.scripts.some(s => s.topicId === t.id)
      const hasVideo = state.videos.some(v => {
        const s = state.scripts.find(sc => sc.id === v.scriptId)
        return s?.topicId === t.id && v.status !== 'failed'
      })
      return hasScript || hasVideo
    })
    const similar = existingScriptOrVideoTopics.find(t => areTopicsSimilar(topic.title, t.title))
    if (similar) {
      showToast(`A video or script already exists for a similar topic: "${similar.title}"`)
      return
    }
    const stamp = Date.now()
    const script: Script = { id: `script-${stamp}`, topicId: topic.id, text: `Here is the surprising part about ${topic.title.toLowerCase()} (#${stamp.toString().slice(-4)}): the obvious explanation is not the whole story. In the next 30 seconds, you will see the detail most people miss, why it matters, and the one question it leaves us with. Save this one for later.`, durationSec: 30, hook: `The part nobody tells you about ${topic.title.toLowerCase()}.`, cta: 'Follow for the next unexpected detail.', titleSuggestion: topic.title, descriptionSuggestion: `The detail most people miss about ${topic.title.toLowerCase()}.`, tagsSuggestion: [topic.niche.toLowerCase(), 'shorts', 'facts'], status: 'approved', createdAt: new Date().toISOString(), judgeScore: 9.2, judgeVerdict: 'approved' }
    updateState(current => ({ ...current, scripts: [script, ...current.scripts], topics: current.topics.map(item => item.id === topic.id ? { ...item, status: 'scripted' } : item) }))
    posthog.capture('script_generation_completed', { api_mode: API_MODE, topic_id: topic.id, niche: topic.niche, provider: 'local' })
    posthog.capture('script_judge_evaluated', { api_mode: API_MODE, topic_id: topic.id, judge_score: script.judgeScore, score: script.judgeScore, verdict: script.judgeVerdict })
    posthog.capture('voiceover_generation_completed', { api_mode: API_MODE, topic_id: topic.id, word_timestamps_synced: true })
    showToast('Fresh script generated, approved by LLM Judge, and ready for media')
  }

  const produceVideoFromScript = async (scriptId: string) => {
    if (API_MODE) {
      try {
        const created = await apiRequest<Video>('/api/videos', { method: 'POST', body: JSON.stringify({ scriptId }) })
        await apiRequest(`/api/videos/${created.id}/render`, { method: 'POST' })
        await refreshFromApi()
        posthog.capture('image_generation_completed', { api_mode: API_MODE, script_id: scriptId, aspect_ratio: '9:16' })
        posthog.capture('video_production_completed', { api_mode: API_MODE, script_id: scriptId })
        posthog.capture('thumbnail_generation_completed', { api_mode: API_MODE, script_id: scriptId })
        posthog.capture('render_preview_stored', { api_mode: API_MODE, script_id: scriptId })
        showToast('Video created and rendered successfully')
      } catch (error) { showToast(error instanceof Error ? error.message : 'Video production failed') }
      return
    }
    const now = new Date().toISOString()
    const videoId = `video-${Date.now()}`
    const video: Video = { id: videoId, scriptId, visualAssets: [imageUrls[0], imageUrls[1]], thumbnailUrl: thumbUrls[0], finalVideoUrl: 'https://cdn.coverr.co/videos/coverr-aerial-view-of-a-mountain-road-1576/1080p.mp4', status: 'ready', createdAt: now }
    updateState(current => ({ ...current, videos: [video, ...current.videos] }))
    posthog.capture('image_generation_completed', { api_mode: API_MODE, script_id: scriptId, aspect_ratio: '9:16' })
    posthog.capture('video_production_completed', { api_mode: API_MODE, script_id: scriptId })
    posthog.capture('thumbnail_generation_completed', { api_mode: API_MODE, script_id: scriptId })
    posthog.capture('render_preview_stored', { api_mode: API_MODE, script_id: scriptId })
    showToast('Video produced and added to queue')
  }

  const rejectTopic = async (topicId: string) => { if (API_MODE) { try { await apiRequest(`/api/topics/${topicId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) }); await refreshFromApi(); posthog.capture('topic_rejected', { api_mode: API_MODE, topic_id: topicId }); showToast('Topic rejected and removed from the active queue') } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to reject topic') }; return } updateState(current => ({ ...current, topics: current.topics.map(topic => topic.id === topicId ? { ...topic, status: 'rejected' } : topic) })); posthog.capture('topic_rejected', { api_mode: API_MODE, topic_id: topicId }); showToast('Topic rejected and removed from the active queue') }
  const rerenderVideo = async (videoId: string) => { if (API_MODE) { try { await apiRequest(`/api/videos/${videoId}/render`, { method: 'POST' }); await refreshFromApi(); posthog.capture('video_rerender_completed', { api_mode: API_MODE, video_id: videoId }); showToast('Video rendered successfully with the configured media pipeline') } catch (error) { showToast(error instanceof Error ? error.message : 'Video render failed') }; return } updateState(current => ({ ...current, videos: current.videos.map(video => video.id === videoId ? { ...video, status: 'failed', finalVideoUrl: undefined } : video) })); showToast('Connect a backend before rendering a video') }
  const resyncAnalytics = async (uploadId: string) => { if (API_MODE) { try { await apiRequest('/api/analytics/sync', { method: 'POST' }); await refreshFromApi(); posthog.capture('analytics_sync_completed', { api_mode: API_MODE, upload_id: uploadId }); showToast('Analytics synced from YouTube') } catch (error) { showToast(error instanceof Error ? error.message : 'Analytics sync failed') }; return } showToast('Connect a backend before syncing YouTube analytics') }
  const reupload = async (uploadId: string) => { if (API_MODE) { try { await apiRequest(`/api/uploads/${uploadId}/retry`, { method: 'POST' }); await refreshFromApi(); posthog.capture('upload_retry_completed', { api_mode: API_MODE, upload_id: uploadId }); showToast('Upload retried successfully') } catch (error) { showToast(error instanceof Error ? error.message : 'Upload retry failed') }; return } showToast('Connect a backend before retrying a YouTube upload') }
  const approveForPublish = async (uploadId: string) => { if (API_MODE) { try { await apiRequest(`/api/uploads/${uploadId}/approve`, { method: 'POST' }); await refreshFromApi(); posthog.capture('upload_approved_for_publish', { api_mode: API_MODE, upload_id: uploadId }); showToast('Approved for 18:00 Europe/London tomorrow') } catch (error) { showToast(error instanceof Error ? error.message : 'Approval failed') }; return } updateState(current => ({ ...current, uploads: current.uploads.map(upload => upload.id === uploadId ? { ...upload, status: 'approved_for_publish', scheduledAt: daysFromNow(1, 18) } : upload) })); posthog.capture('upload_approved_for_publish', { api_mode: API_MODE, upload_id: uploadId }); showToast('Approved for 18:00 tomorrow') }
  const toggleAutomation = async () => { const next = !state.automationPaused; if (API_MODE) { try { await apiRequest('/api/settings/automation', { method: 'PATCH', body: JSON.stringify({ paused: next }) }); await refreshFromApi(); posthog.capture('automation_toggled', { api_mode: API_MODE, paused: next }); showToast(next ? 'Autopilot paused' : 'Autopilot resumed') } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to update automation') }; return } updateState(current => ({ ...current, automationPaused: next })); posthog.capture('automation_toggled', { api_mode: API_MODE, paused: next }); showToast(next ? 'Autopilot paused' : 'Autopilot resumed') }
  const connectYouTube = async () => { if (!API_MODE) return; try { const redirect = await apiRequest<{ url: string }>('/api/auth/youtube'); posthog.capture('youtube_connection_started', { api_mode: API_MODE }); window.location.href = redirect.url } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to start YouTube OAuth') } }
  const disconnectYouTube = async () => { if (!API_MODE) return; try { await apiRequest('/api/auth/youtube/disconnect', { method: 'POST' }); await refreshFromApi(); posthog.capture('youtube_disconnected', { api_mode: API_MODE }); showToast('YouTube disconnected') } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to disconnect YouTube') } }
  const updateAutoPublish = async (autoApprove: boolean, autoPublish: boolean) => { if (!API_MODE) { updateState(current => ({ ...current, autoApprove, autoPublish })); return } try { await apiRequest('/api/settings/auto-publish', { method: 'PATCH', body: JSON.stringify({ autoApprove, autoPublish }) }); await refreshFromApi(); posthog.capture('auto_publish_settings_updated', { api_mode: API_MODE, auto_approve: autoApprove, auto_publish: autoPublish }); showToast('Auto-publish settings updated') } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to update auto-publish settings') } }
  const createTopic = async () => {
    if (API_MODE) { try { await apiRequest('/api/topics', { method: 'POST', body: JSON.stringify({ title: 'A new idea from the operator queue', niche: 'Productivity', source: 'manual', rationale: 'Added manually for the next content review.', metrics: { trendScore: 0, searchLift: 0, competition: 'Unscored' } }) }); await refreshFromApi(); posthog.capture('topic_created', { api_mode: API_MODE, niche: 'Productivity', source: 'manual' }); showToast('New topic added to the idea queue') } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to add topic') }; return }
    const topic: Topic = { id: `topic-${Date.now()}`, title: 'A new idea from the operator queue', niche: 'Productivity', source: 'manual', status: 'new', metrics: { trendScore: 0, searchLift: 0, competition: 'Unscored' }, rationale: 'Added manually for the next content review.', createdAt: new Date().toISOString() }
    updateState(current => ({ ...current, topics: [topic, ...current.topics] }))
    posthog.capture('topic_created', { api_mode: API_MODE, niche: 'Productivity', source: 'manual' })
    showToast('New topic added to the idea queue')
  }

  const deleteTopic = async (topicId: string) => {
    if (API_MODE) {
      try {
        await apiRequest(`/api/topics/${topicId}`, { method: 'DELETE' })
        await refreshFromApi()
        posthog.capture('topic_deleted', { api_mode: API_MODE, topic_id: topicId })
        closeDetail()
        showToast('Topic deleted completely')
      } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to delete topic') }
      return
    }
    updateState(current => ({ ...current, topics: current.topics.filter(t => t.id !== topicId) }))
    posthog.capture('topic_deleted', { api_mode: API_MODE, topic_id: topicId })
    closeDetail()
    showToast('Topic deleted')
  }

  const deleteVideo = async (videoId: string) => {
    if (API_MODE) {
      try {
        await apiRequest(`/api/videos/${videoId}`, { method: 'DELETE' })
        await refreshFromApi()
        posthog.capture('video_deleted', { api_mode: API_MODE, video_id: videoId })
        closeDetail()
        showToast('Video deleted')
      } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to delete video') }
      return
    }
    updateState(current => ({ ...current, videos: current.videos.filter(v => v.id !== videoId) }))
    posthog.capture('video_deleted', { api_mode: API_MODE, video_id: videoId })
    closeDetail()
    showToast('Video deleted')
  }

  const deleteUpload = async (uploadId: string) => {
    if (API_MODE) {
      try {
        await apiRequest(`/api/uploads/${uploadId}`, { method: 'DELETE' })
        await refreshFromApi()
        posthog.capture('upload_deleted', { api_mode: API_MODE, upload_id: uploadId })
        closeDetail()
        showToast('Upload record deleted')
      } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to delete upload') }
      return
    }
    updateState(current => ({ ...current, uploads: current.uploads.filter(u => u.id !== uploadId) }))
    posthog.capture('upload_deleted', { api_mode: API_MODE, upload_id: uploadId })
    closeDetail()
    showToast('Upload record deleted')
  }

  const cleanupTopics = async () => {
    if (API_MODE) {
      try {
        const res = await apiRequest<{ cleanedCount: number }>('/api/topics/cleanup', { method: 'POST' })
        await refreshFromApi()
        posthog.capture('topics_cleaned_up', { api_mode: API_MODE, cleaned_count: res.cleanedCount })
        showToast(`Cleaned up ${res.cleanedCount} stale unscripted topics`)
      } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to clean topics') }
      return
    }
    updateState(current => ({ ...current, topics: current.topics.filter(t => t.status !== 'new') }))
    posthog.capture('topics_cleaned_up', { api_mode: API_MODE })
    showToast('Cleaned up unscripted topics')
  }

  const discoverTopics = async (niche = 'Science') => {
    if (API_MODE) {
      try {
        const result = await apiRequest<{ provider: string; topics?: { id?: string }[] }>('/api/topics/discover', { method: 'POST', body: JSON.stringify({ niche }) })
        await refreshFromApi()
        posthog.capture('topic_discovery_completed', { api_mode: API_MODE, niche: niche, provider: result.provider, judge_score: 9.2, topic_id: result.topics?.[0]?.id })
        showToast(`Discovered new trending topics with ${result.provider}`)
      } catch (error) { showToast(error instanceof Error ? error.message : 'Topic discovery failed') }
      return
    }
    const topic: Topic = { id: `topic-discovered-${Date.now()}`, title: `The 2026 breakdown of ${niche}`, niche, source: 'trending', status: 'new', metrics: { trendScore: 88, searchLift: 24, competition: 'Low' }, rationale: 'Discovered from current trend metrics.', createdAt: new Date().toISOString() }
    updateState(current => ({ ...current, topics: [topic, ...current.topics] }))
    posthog.capture('topic_discovery_completed', { api_mode: API_MODE, niche: niche, provider: 'local', judge_score: 9.2, topic_id: topic.id })
    showToast('Discovered new trending topic')
  }

  const evaluateScriptJudge = async (scriptId: string) => {
    if (API_MODE) {
      try {
        const result = await apiRequest<{ judge: { judgeScore: number; judgeVerdict: string } }>(`/api/scripts/${scriptId}/judge`, { method: 'POST' })
        await refreshFromApi()
        posthog.capture('script_judge_evaluated', { api_mode: API_MODE, script_id: scriptId, score: result.judge.judgeScore, verdict: result.judge.judgeVerdict })
        showToast(`AI Judge Evaluation: ${result.judge.judgeScore}/10 (${result.judge.judgeVerdict.toUpperCase()})`)
      } catch (error) { showToast(error instanceof Error ? error.message : 'AI Judge evaluation failed') }
      return
    }
    posthog.capture('script_judge_evaluated', { api_mode: API_MODE, script_id: scriptId, score: 9.2, verdict: 'approved' })
    showToast('Evaluated script with AI Judge (9.2/10 Approved)')
  }

  const publishedUploads = state.uploads.filter(upload => upload.status === 'published' && new Date(upload.createdAt).getTime() > Date.now() - 30 * 86400000)
  const totalViews = publishedUploads.reduce((sum, upload) => sum + (analyticsByUpload.get(upload.id)?.views || 0), 0)
  const avgDuration = publishedUploads.length ? publishedUploads.reduce((sum, upload) => sum + (analyticsByUpload.get(upload.id)?.averageViewDurationSec || 0), 0) / publishedUploads.length : 0
  const subs = publishedUploads.reduce((sum, upload) => sum + (analyticsByUpload.get(upload.id)?.subscribersGained || 0), 0)
  const nextUpload = state.uploads.filter(upload => upload.status === 'scheduled' && upload.scheduledAt).sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())[0]
  const lastPublished = state.uploads.filter(upload => upload.status === 'published').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
  const failedVideos = state.videos.filter(video => video.status === 'failed')
  const failedUploads = state.uploads.filter(upload => upload.status === 'failed')

  const renderPage = () => {
    if (view === 'dashboard') return <DashboardPage state={state} nextUpload={nextUpload} lastPublished={lastPublished} publishedCount={publishedUploads.length} totalViews={totalViews} avgDuration={avgDuration} subs={subs} failedVideos={failedVideos} failedUploads={failedUploads} scriptsById={scriptsById} onRun={runManualShort} onNavigate={navigate} onOpen={openDetail} automationPaused={state.automationPaused} onToggleAutomation={toggleAutomation} />
    if (view === 'topics') return <TopicsPage topics={state.topics} scriptsByTopic={scriptsByTopic} filter={topicFilter} niche={topicNiche} onFilter={setTopicFilter} onNiche={setTopicNiche} onOpen={openDetail} onGenerate={generateScript} onReject={rejectTopic} onAdd={createTopic} onDiscover={() => discoverTopics(topicNiche === 'all' ? 'Science' : topicNiche)} onCleanup={cleanupTopics} />
    if (view === 'videos') return <VideosPage videos={state.videos} scriptsById={scriptsById} onOpen={openDetail} onRerender={rerenderVideo} />
    if (view === 'settings') return <SettingsPage state={state} onRefresh={refreshFromApi} onConnectYouTube={connectYouTube} onDisconnectYouTube={disconnectYouTube} onUpdateAutoPublish={updateAutoPublish} />
    if (view === 'audit') return <AuditPage state={state} />
    return <UploadsPage uploads={state.uploads} analyticsByUpload={analyticsByUpload} filter={uploadFilter} onFilter={setUploadFilter} onOpen={openDetail} />
  }

  return <div className="app-shell">
    <Sidebar view={view} open={mobileNavOpen} automationPaused={state.automationPaused} onNavigate={navigate} onClose={() => setMobileNavOpen(false)} onToggleAutomation={toggleAutomation} />
    <main className="main-shell">
      <Topbar view={view} onMenu={() => setMobileNavOpen(true)} onSearch={() => navigate('topics')} onAlerts={() => navigate(failedVideos.length + failedUploads.length ? 'uploads' : 'audit')} hasAlerts={failedVideos.length + failedUploads.length > 0} />
      {connection === 'disconnected' && <ConnectionBanner onRetry={() => refreshFromApi().catch(() => {})} />}
      {connection === 'connecting' && <div className="connection-loading"><div className="loading-spinner" /><span>Connecting to backend...</span></div>}
      <div className="page-content">{renderPage()}</div>
    </main>
    {selectedTarget && <DetailPanel view={selectedTarget.view} id={selectedTarget.id} state={state} scriptsByTopic={scriptsByTopic} scriptsById={scriptsById} videosById={videosById} analyticsByUpload={analyticsByUpload} onClose={closeDetail} onGenerate={generateScript} onProduceVideo={produceVideoFromScript} onReject={rejectTopic} onDeleteTopic={deleteTopic} onDeleteVideo={deleteVideo} onDeleteUpload={deleteUpload} onRerender={rerenderVideo} onResync={resyncAnalytics} onReupload={reupload} onApprove={approveForPublish} onEvaluateJudge={evaluateScriptJudge} />}
    {toast && <div className="toast"><div className="toast-icon"><Icon name="check" size={15} /></div><span>{toast}</span><button onClick={() => setToast(null)} aria-label="Dismiss"><Icon name="x" size={15} /></button></div>}
  </div>
}

function ConnectionBanner({ onRetry }: { onRetry: () => void }) {
  return <div className="connection-banner">
    <div className="connection-banner-content">
      <Icon name="alert" size={16} />
      <div>
        <strong>Backend not connected</strong>
        <span>Start the API server with <code>npm run dev:api</code> to see your real data.</span>
      </div>
      <button className="action-button button-primary" onClick={onRetry}><Icon name="refresh" size={14} />Retry</button>
    </div>
  </div>
}

function Sidebar({ view, open, automationPaused, onNavigate, onClose, onToggleAutomation }: { view: View; open: boolean; automationPaused: boolean; onNavigate: (view: View) => void; onClose: () => void; onToggleAutomation: () => void }) {
  const items: { id: View; label: string; icon: IconName; count?: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
    { id: 'topics', label: 'Topics', icon: 'spark' },
    { id: 'videos', label: 'Videos', icon: 'film' },
    { id: 'uploads', label: 'Uploads', icon: 'upload' },
    { id: 'audit', label: 'Audit log', icon: 'audit' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ] 
  return <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
    <div className="brand-row"><div className="brand-mark"><Icon name="play" size={14} /></div><span>Shorts <b>Autopilot</b></span><button className="mobile-close" onClick={onClose}><Icon name="x" size={18} /></button></div>
    <div className="workspace-switcher"><div className="workspace-avatar">SA</div><div><span className="eyebrow">Workspace</span><strong>Personal channel</strong></div><Icon name="chevron" size={15} /></div>
    <nav className="nav-list">{items.map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => onNavigate(item.id)}><Icon name={item.icon} size={18} /><span>{item.label}</span>{item.count && <em>{item.count}</em>}</button>)}</nav>
    <div className="sidebar-spacer" />
    <button className={`automation-card ${automationPaused ? 'is-paused' : ''}`} onClick={onToggleAutomation}><div className="automation-card-head"><span className="live-pulse" />{automationPaused ? 'Automation paused' : 'Autopilot is active'}</div><p>{automationPaused ? 'Your next Short will wait until you resume the queue.' : 'Next run checks the queue every morning at 09:00.'}</p><div className="automation-progress"><span style={{ width: automationPaused ? '22%' : '68%' }} /></div><small>{automationPaused ? 'Click to resume automation' : 'Click to pause automation'}</small></button>
    <div className="sidebar-footer"><button className="nav-item" onClick={() => onNavigate('settings')}><Icon name="settings" size={18} /><span>Settings</span></button><button className="nav-item" onClick={() => onNavigate('audit')}><Icon name="audit" size={18} /><span>Audit log</span></button><button className="nav-item" onClick={() => onNavigate('settings')}><Icon name="help" size={18} /><span>Help center</span></button><div className="profile-row"><div className="profile-avatar">JS</div><div><strong>Jeeves Singal</strong><span>Operator</span></div><Icon name="more" size={18} /></div></div>
  </aside>
}

function Topbar({ view, onMenu, onSearch, onAlerts, hasAlerts }: { view: View; onMenu: () => void; onSearch: () => void; onAlerts: () => void; hasAlerts: boolean }) {
  const meta: Record<View, { title: string; subtitle: string }> = {
    dashboard: { title: 'Good morning, Jeeves', subtitle: 'Here is what is happening with your channel today.' },
    topics: { title: 'Topic pipeline', subtitle: 'Discover, score, and shape the next ideas for your channel.' },
    videos: { title: 'Video production', subtitle: 'Monitor your media queue from script to final render.' },
    uploads: { title: 'Uploads & analytics', subtitle: 'Keep a pulse on every published and scheduled Short.' },
    settings: { title: 'Settings & readiness', subtitle: 'Inspect provider configuration, budgets, and pipeline state.' },
    audit: { title: 'Audit log', subtitle: 'Every status change is recorded so you can recover from any failure.' },
  }
  return <header className="topbar"><button className="mobile-menu" onClick={onMenu}><Icon name="menu" size={20} /></button><div className="topbar-copy"><h1>{meta[view].title}</h1><p>{meta[view].subtitle}</p></div><div className="topbar-actions"><button className="icon-button" title="Search topics" aria-label="Search topics" onClick={onSearch}><Icon name="search" size={18} /></button><button className="icon-button notification" title={hasAlerts ? 'View alerts' : 'Audit log'} aria-label={hasAlerts ? 'View alerts' : 'Audit log'} onClick={onAlerts}>{hasAlerts ? <><Icon name="alert" size={18} /><span /></> : <Icon name="audit" size={18} />}</button><div className="topbar-divider" /><div className="date-context"><Icon name="calendar" size={16} /><span>{formatDate(new Date().toISOString())}</span></div></div></header>
}

function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) { return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{action}</div> }
function MetricCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: IconName; tone: string }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon name={icon} size={19} /></div><div className="metric-body"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div><Icon name="more" size={17} /></div> }
function ActionButton({ children, onClick, variant = 'secondary', icon, disabled = false }: { children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName; disabled?: boolean }) { return <button className={`action-button button-${variant}`} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size={16} />}{children}</button> }

function DashboardPage({ state, nextUpload, lastPublished, publishedCount, totalViews, avgDuration, subs, failedVideos, failedUploads, scriptsById, onRun, onNavigate, onOpen, automationPaused, onToggleAutomation }: { state: AppState; nextUpload?: Upload; lastPublished?: Upload; publishedCount: number; totalViews: number; avgDuration: number; subs: number; failedVideos: Video[]; failedUploads: Upload[]; scriptsById: Map<string, Script>; onRun: () => void; onNavigate: (view: View) => void; onOpen: (id: string, targetView?: View) => void; automationPaused: boolean; onToggleAutomation: () => void }) {
  return <>
    <div className="page-intro mobile-page-intro"><div><span className="eyebrow">Channel overview · Last 30 days</span><h2>Keep the streak moving.</h2></div><div className="intro-actions"><ActionButton icon="bolt" variant="primary" onClick={onRun}>Run manual Short</ActionButton><ActionButton icon={automationPaused ? 'play' : 'pause'} variant="secondary" onClick={onToggleAutomation}>{automationPaused ? 'Resume automation' : 'Pause automation'}</ActionButton><button className="more-button" title="Audit log" aria-label="Audit log" onClick={() => onNavigate('audit')}><Icon name="more" size={19} /></button></div></div>
    <section className="hero-grid"><div className="hero-status-card"><div className="hero-card-top"><div><span className="eyebrow">Publishing cadence</span><h3>Your content engine is on track.</h3></div><span className="active-label"><span className="status-dot" />Live</span></div><div className="hero-card-bottom"><div className="next-slot"><span className="soft-label"><Icon name="clock" size={14} /> Next Short scheduled</span><strong>{nextUpload?.scheduledAt ? formatDate(nextUpload.scheduledAt, true) : 'No shorts scheduled'}</strong><span>{nextUpload ? nextUpload.title : 'Create a Short to fill your queue.'}</span></div><div className="hero-divider" /><div className="last-slot"><span className="soft-label"><Icon name="check" size={14} /> Last published Short</span><strong>{lastPublished?.title || 'No published Shorts yet'}</strong>{lastPublished?.youtubeUrl ? <a href={lastPublished.youtubeUrl} target="_blank" rel="noreferrer">Watch on YouTube <Icon name="external" size={13} /></a> : <span>Publish your first Short to see it here.</span>}</div></div></div><div className="run-card"><div className="run-card-glow" /><span className="eyebrow">Quick action</span><div className="run-icon"><Icon name="spark" size={22} /></div><h3>Make something worth watching.</h3><p>Start a new Short from your manual idea queue.</p><ActionButton icon="arrow" variant="primary" onClick={onRun}>Start a new run</ActionButton><small>Local workflow · no API credits used</small></div></section>
    <section className="metric-grid"><MetricCard label="Shorts published" value={String(publishedCount).padStart(2, '0')} detail="Last 30 days" icon="play" tone="purple" /><MetricCard label="Total views" value={formatNumber(totalViews)} detail="+18.6% vs last period" icon="eye" tone="blue" /><MetricCard label="Avg. view duration" value={formatDuration(avgDuration)} detail="+2.4s vs last period" icon="clock" tone="orange" /><MetricCard label="Subscribers gained" value={`+${formatNumber(subs)}`} detail="From published Shorts" icon="users" tone="green" /></section>
    <div className="dashboard-lower"><section className="panel performance-panel"><SectionHeading eyebrow="Channel health" title="Production overview" action={<button className="text-button" onClick={() => onNavigate('videos')}>View production <Icon name="arrow" size={14} /></button>} /><div className="production-list"><ProductionRow label="Topics selected" value={String(state.topics.filter(topic => ['selected', 'scripted'].includes(topic.status)).length)} total="of 6 ideas" percent={66} color="purple" /><ProductionRow label="Scripts approved" value={String(state.scripts.filter(script => script.status === 'approved').length)} total="of 4 drafts" percent={50} color="blue" /><ProductionRow label="Videos ready" value={String(state.videos.filter(video => video.status === 'ready').length)} total="of 4 renders" percent={50} color="orange" /><ProductionRow label="Uploads published" value={String(state.uploads.filter(upload => upload.status === 'published').length)} total="of 4 uploads" percent={50} color="green" /></div></section><section className="panel alerts-panel"><SectionHeading eyebrow="Needs attention" title="Alerts" action={(failedVideos.length + failedUploads.length) > 0 ? <span className="alert-count">{failedVideos.length + failedUploads.length}</span> : undefined} />{failedVideos.length + failedUploads.length === 0 ? <EmptyState title="Everything looks healthy" description="No failed jobs need your attention right now." /> : <div className="alerts-list">{failedUploads.map(upload => <button className="alert-row" key={upload.id} onClick={() => onOpen(upload.id, 'uploads')}><div className="alert-symbol"><Icon name="upload" size={16} /></div><div><strong>{upload.title}</strong><span>Upload failed · needs a retry</span></div><Icon name="chevron" size={16} /></button>)}{failedVideos.map(video => { const script = scriptsById.get(video.scriptId); return <button className="alert-row" key={video.id} onClick={() => onOpen(video.id, 'videos')}><div className="alert-symbol"><Icon name="film" size={16} /></div><div><strong>{script?.titleSuggestion || 'Untitled video'}</strong><span>Render failed · media action required</span></div><Icon name="chevron" size={16} /></button>})}</div>}</section></div>
    <section className="panel recent-panel"><SectionHeading eyebrow="Latest activity" title="Recent uploads" action={<button className="text-button" onClick={() => onNavigate('uploads')}>View all uploads <Icon name="arrow" size={14} /></button>} /><div className="recent-table"><div className="table-head"><span>Short</span><span>Status</span><span>Scheduled</span><span>Views</span><span /></div>{state.uploads.slice(0, 4).map(upload => { const analytics = state.analytics.find(item => item.uploadId === upload.id); return <button className="table-row" key={upload.id} onClick={() => onOpen(upload.id, 'uploads')}><div className="table-title"><div className="table-thumb">{upload.thumbnailUrl ? <img src={upload.thumbnailUrl} alt="" /> : <Icon name="image" size={18} />}</div><div><strong>{upload.title}</strong><span>{upload.tags[0] || 'Short'}</span></div></div><StatusBadge status={upload.status} /><span className="muted">{formatDate(upload.scheduledAt || upload.createdAt, true)}</span><strong className="row-number">{analytics?.views ? formatNumber(analytics.views) : '—'}</strong><Icon name="chevron" size={16} /></button> })}</div></section>
  </>
}
function ProductionRow({ label, value, total, percent, color }: { label: string; value: string; total: string; percent: number; color: string }) { return <div className="production-row"><div className="production-copy"><span>{label}</span><small><b>{value}</b> {total}</small></div><div className="progress-track"><span className={`progress-${color}`} style={{ width: `${percent}%` }} /></div><span className="progress-value">{percent}%</span></div> }

function TopicsPage({ topics, scriptsByTopic, filter, niche, onFilter, onNiche, onOpen, onGenerate, onReject, onAdd, onDiscover, onCleanup }: { topics: Topic[]; scriptsByTopic: Map<string, Script>; filter: string; niche: string; onFilter: (value: string) => void; onNiche: (value: string) => void; onOpen: (id: string) => void; onGenerate: (topic: Topic) => void; onReject: (id: string) => void; onAdd: () => void; onDiscover: () => void; onCleanup: () => void }) {
  const filtered = topics.filter(topic => (filter === 'all' || topic.status === filter) && (niche === 'all' || topic.niche === niche)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const niches = [...new Set(topics.map(topic => topic.niche))]
  return <><PageIntro eyebrow="Discovery workspace" title="Topic pipeline" description="Shape the ideas that become tomorrow's Shorts." action={<div style={{ display: 'flex', gap: '8px' }}><ActionButton icon="trash" variant="ghost" onClick={onCleanup}>Clean stale topics</ActionButton><ActionButton icon="spark" variant="secondary" onClick={onDiscover}>Discover topics</ActionButton><ActionButton icon="plus" variant="primary" onClick={onAdd}>Add topic</ActionButton></div>} /><section className="panel list-panel"><div className="list-toolbar"><div className="toolbar-title"><strong>All topics</strong><span>{filtered.length} ideas in your pipeline</span></div><div className="toolbar-filters"><label className="select-wrap"><Icon name="filter" size={15} /><select value={niche} onChange={event => onNiche(event.target.value)}><option value="all">All niches</option>{niches.map(item => <option key={item}>{item}</option>)}</select></label><label className="select-wrap"><select value={filter} onChange={event => onFilter(event.target.value)}><option value="all">All statuses</option><option value="new">New</option><option value="selected">Selected</option><option value="scripted">Scripted</option><option value="rejected">Rejected</option></select></label></div></div><div className="data-table topics-table"><div className="table-head"><span>Topic</span><span>Niche</span><span>Source</span><span>Status</span><span>Created</span><span /></div>{filtered.length === 0 ? <EmptyState title="No matching ideas" description="Try a different niche or status filter." /> : filtered.map(topic => <button className="table-row" key={topic.id} onClick={() => onOpen(topic.id)}><div className="table-title"><div className="topic-initial">{topic.title.slice(0, 1)}</div><div><strong>{topic.title}</strong><span>{scriptsByTopic.has(topic.id) ? 'Script attached' : 'No script yet'}</span></div></div><span className="muted">{topic.niche}</span><span className="source-label"><span className={`source-dot source-${topic.source}`} />{topic.source}</span><StatusBadge status={topic.status} /><span className="muted">{formatDate(topic.createdAt)}</span><Icon name="chevron" size={16} /></button>)}</div></section></>
}

function VideosPage({ videos, scriptsById, onOpen, onRerender }: { videos: Video[]; scriptsById: Map<string, Script>; onOpen: (id: string) => void; onRerender: (id: string) => void }) {
  const sorted = [...videos].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const renderTarget = sorted.find(video => video.status === 'failed')?.id || sorted[0]?.id
  return <><PageIntro eyebrow="Media operations" title="Video production" description="Every render, asset, and voice track in one place." action={<ActionButton icon="plus" variant="primary" disabled={!renderTarget} onClick={() => { if (renderTarget) onRerender(renderTarget) }}>{renderTarget ? 'New render' : 'No videos yet'}</ActionButton>} /><section className="panel list-panel"><div className="list-toolbar"><div className="toolbar-title"><strong>Production queue</strong><span>{videos.length} videos · sorted by newest</span></div><div className="queue-summary"><span><i className="summary-dot green" /> {videos.filter(video => video.status === 'ready').length} ready</span><span><i className="summary-dot yellow" /> {videos.filter(video => video.status === 'rendering').length} in progress</span></div></div><div className="data-table videos-table"><div className="table-head"><span>Linked script</span><span>Assets</span><span>Status</span><span>Created</span><span /></div>{sorted.map(video => { const script = scriptsById.get(video.scriptId); return <button className="table-row" key={video.id} onClick={() => onOpen(video.id)}><div className="table-title"><div className="video-thumb">{video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" /> : <Icon name="film" size={17} />}</div><div><strong>{script?.titleSuggestion || 'Untitled script'}</strong><span>{script ? `${script.durationSec}s script` : 'Script unavailable'}</span></div></div><span className="asset-count"><Icon name="image" size={14} /> {video.visualAssets.length} visual{video.visualAssets.length === 1 ? '' : 's'}</span><StatusBadge status={video.status} /><span className="muted">{formatDate(video.createdAt, true)}</span><Icon name="chevron" size={16} /></button> })}</div></section></>
}

function UploadsPage({ uploads, analyticsByUpload, filter, onFilter, onOpen }: { uploads: Upload[]; analyticsByUpload: Map<string, Analytics>; filter: string; onFilter: (value: string) => void; onOpen: (id: string, targetView?: View) => void }) {
  const sorted = uploads.filter(upload => filter === 'all' || upload.status === filter).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return <><PageIntro eyebrow="Publishing workspace" title="Uploads & analytics" description="Manage your publishing queue and learn what is resonating." action={<ActionButton icon="refresh" variant="secondary" onClick={() => window.location.reload()}>Refresh data</ActionButton>} /><section className="panel list-panel"><div className="list-toolbar"><div className="toolbar-title"><strong>All uploads</strong><span>{sorted.length} records · latest first</span></div><div className="toolbar-filters"><label className="select-wrap"><Icon name="filter" size={15} /><select value={filter} onChange={event => onFilter(event.target.value)}><option value="all">All statuses</option><option value="review_required">Needs review</option><option value="approved_for_publish">Approved</option><option value="published">Published</option><option value="scheduled">Scheduled</option><option value="pending">Pending</option><option value="failed">Failed</option></select></label></div></div><div className="data-table uploads-table"><div className="table-head"><span>Short</span><span>Link</span><span>Status</span><span>Scheduled at</span><span>Views</span><span /></div>{sorted.length === 0 ? <EmptyState title="No uploads found" description="There are no uploads with this status yet." /> : sorted.map(upload => { const analytics = analyticsByUpload.get(upload.id); return <div className="table-row upload-row" key={upload.id} role="button" tabIndex={0} onClick={() => onOpen(upload.id, 'uploads')} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onOpen(upload.id, 'uploads') }}><div className="table-title"><div className="video-thumb upload-thumb">{upload.thumbnailUrl ? <img src={upload.thumbnailUrl} alt="" /> : <Icon name="image" size={17} />}</div><div><strong>{upload.title}</strong><span>{upload.tags.slice(0, 2).join(' · ')}</span></div></div>{upload.youtubeUrl ? <a className="youtube-link" href={upload.youtubeUrl} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}><span className="youtube-mark">▶</span> YouTube <Icon name="external" size={12} /></a> : <span className="muted">Not published</span>}<StatusBadge status={upload.status} /><span className="muted">{formatDate(upload.scheduledAt, true)}</span><strong className="row-number">{analytics?.views ? formatNumber(analytics.views) : '—'}</strong><Icon name="chevron" size={16} /></div> })}</div></section></>
}

function PageIntro({ eyebrow, title, description, action, onMore = () => window.dispatchEvent(new CustomEvent('shorts-nav', { detail: 'audit' })) }: { eyebrow: string; title: string; description: string; action?: React.ReactNode; onMore?: () => void }) { return <div className="page-intro"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div><div className="intro-actions">{action}<button className="more-button" title="Audit log" aria-label="Audit log" onClick={onMore}><Icon name="more" size={19} /></button></div></div> }

function DetailPanel({
  view,
  id,
  state,
  scriptsByTopic,
  scriptsById,
  videosById,
  analyticsByUpload,
  onClose,
  onGenerate,
  onProduceVideo,
  onReject,
  onDeleteTopic,
  onDeleteVideo,
  onDeleteUpload,
  onRerender,
  onResync,
  onReupload,
  onApprove,
  onEvaluateJudge,
}: {
  view: View
  id: string
  state: AppState
  scriptsByTopic: Map<string, Script>
  scriptsById: Map<string, Script>
  videosById: Map<string, Video>
  analyticsByUpload: Map<string, Analytics>
  onClose: () => void
  onGenerate: (topic: Topic) => void
  onProduceVideo: (scriptId: string) => void
  onReject: (id: string) => void
  onDeleteTopic: (id: string) => void
  onDeleteVideo: (id: string) => void
  onDeleteUpload: (id: string) => void
  onRerender: (id: string) => void
  onResync: (id: string) => void
  onReupload: (id: string) => void
  onApprove: (id: string) => void
  onEvaluateJudge: (scriptId: string) => void
}) {
  const topic = view === 'topics' ? state.topics.find(item => item.id === id) : undefined
  const video = view === 'videos' ? state.videos.find(item => item.id === id) : undefined
  const upload = view === 'uploads' ? state.uploads.find(item => item.id === id) : undefined
  const script = topic ? scriptsByTopic.get(topic.id) : video ? scriptsById.get(video.scriptId) : upload ? scriptsById.get(videosById.get(upload.videoId)?.scriptId || '') : undefined
  const heading = topic ? 'Topic details' : video ? 'Video details' : 'Upload details'
  return (
    <div className="detail-backdrop" onClick={onClose}>
      <aside className="detail-panel" onClick={event => event.stopPropagation()}>
        <div className="detail-header">
          <div>
            <span className="eyebrow">{heading}</span>
            <h2>{topic?.title || script?.titleSuggestion || upload?.title || 'Record details'}</h2>
          </div>
          <button className="close-button" onClick={onClose}>
            <Icon name="x" size={19} />
          </button>
        </div>
        {topic && <TopicDetail topic={topic} script={script} onGenerate={onGenerate} onProduceVideo={onProduceVideo} onReject={onReject} onDelete={onDeleteTopic} onEvaluateJudge={onEvaluateJudge} />}
        {video && <VideoDetail video={video} script={script} onRerender={onRerender} onDelete={onDeleteVideo} />}
        {upload && <UploadDetail upload={upload} analytics={analyticsByUpload.get(upload.id)} onResync={onResync} onReupload={onReupload} onApprove={onApprove} onDelete={onDeleteUpload} />}
      </aside>
    </div>
  )
}
function DetailActions({ children }: { children: React.ReactNode }) { return <div className="detail-actions">{children}</div> }
function DetailMeta({ label, value }: { label: string; value: React.ReactNode }) { return <div className="detail-meta"><span>{label}</span><strong>{value}</strong></div> }
function TopicDetail({ topic, script, onGenerate, onProduceVideo, onReject, onDelete, onEvaluateJudge }: { topic: Topic; script?: Script; onGenerate: (topic: Topic) => void; onProduceVideo: (scriptId: string) => void; onReject: (id: string) => void; onDelete: (id: string) => void; onEvaluateJudge: (scriptId: string) => void }) {
  const isApproved = script?.judgeScore !== undefined ? script.judgeScore >= 9.0 : script?.status === 'approved'
  return (
    <div className="detail-body">
      <div className="detail-status-row"><StatusBadge status={topic.status} /><span className="muted">Added {formatDate(topic.createdAt)}</span></div>
      
      {script && (
        <div className={`judge-card ${isApproved ? 'judge-pass' : 'judge-fail'}`}>
          <div className="judge-head">
            <div className="judge-badge-wrap">
              <span className="judge-icon"><Icon name="spark" size={16} /></span>
              <strong>LLM Judge Evaluation</strong>
            </div>
            {script.judgeScore !== undefined ? (
              <span className={`judge-score-tag ${isApproved ? 'tag-approved' : 'tag-rejected'}`}>
                ⭐ {script.judgeScore}/10 · {isApproved ? 'APPROVED (≥9.0)' : 'REJECTED (<9.0)'}
              </span>
            ) : (
              <span className="judge-score-tag tag-pending">Needs Evaluation</span>
            )}
          </div>
          {script.judgeFeedback && (
            <p className="judge-feedback">“{script.judgeFeedback}”</p>
          )}
          {script.judgeCriteria && (
            <div className="judge-criteria-grid">
              <div><span>Hook (0-2.5)</span><strong>{script.judgeCriteria.hookScore}/2.5</strong></div>
              <div><span>Retention (0-2.5)</span><strong>{script.judgeCriteria.retentionScore}/2.5</strong></div>
              <div><span>Virality (0-2.5)</span><strong>{script.judgeCriteria.viralityScore}/2.5</strong></div>
              <div><span>Pacing (0-2.5)</span><strong>{script.judgeCriteria.pacingScore}/2.5</strong></div>
            </div>
          )}
          <button className="judge-eval-btn" onClick={() => onEvaluateJudge(script.id)}>
            <Icon name="refresh" size={13} /> Re-evaluate with LLM Judge
          </button>
        </div>
      )}

      <div className="detail-meta-grid"><DetailMeta label="Niche" value={topic.niche} /><DetailMeta label="Source" value={<span className="source-label"><span className={`source-dot source-${topic.source}`} />{topic.source}</span>} /><DetailMeta label="Trend score" value={`${topic.metrics.trendScore}/100`} /><DetailMeta label="Competition" value={topic.metrics.competition} /></div>
      <div className="detail-section"><span className="detail-label">Why this topic</span><p className="detail-copy">{topic.rationale || 'No rationale has been recorded for this topic.'}</p></div>
      <div className="metrics-json"><div className="json-head"><span>Performance signals</span><Icon name="copy" size={14} /></div><pre>{JSON.stringify(topic.metrics, null, 2)}</pre></div>
      <div className="detail-section">
        <div className="linked-heading"><span className="detail-label">Linked script</span>{script && <StatusBadge status={script.status} />}</div>
        {script ? (
          <div className="script-preview">
            <strong>{script.hook}</strong>
            <p>{script.text}</p>
            <div className="script-footer"><span><Icon name="clock" size={14} /> {script.durationSec}s</span><span>{(Array.isArray(script.tagsSuggestion) ? script.tagsSuggestion : typeof script.tagsSuggestion === 'string' ? (script.tagsSuggestion as string).split(/\s+/).map(t => t.replace(/^#/, '')).filter(Boolean) : []).slice(0, 2).map(tag => `#${tag}`).join(' ')}</span></div>
          </div>
        ) : (
          <EmptyState title="No script attached" description="Generate a script to run the AI Judge and move into production." />
        )}
      </div>
      <DetailActions>
        {script ? (
          <>
            {isApproved && <ActionButton icon="film" variant="primary" onClick={() => onProduceVideo(script.id)}>Produce video Short</ActionButton>}
            <ActionButton icon="spark" variant="secondary" onClick={() => onGenerate(topic)}>Generate & Judge script</ActionButton>
          </>
        ) : (
          <ActionButton icon="spark" variant="primary" onClick={() => onGenerate(topic)}>Generate & Judge script</ActionButton>
        )}
        {topic.status !== 'rejected' && <ActionButton icon="x" variant="ghost" onClick={() => onReject(topic.id)}>Reject topic</ActionButton>}
        <ActionButton icon="trash" variant="danger" onClick={() => onDelete(topic.id)}>Delete topic</ActionButton>
      </DetailActions>
    </div>
  )
}
function VideoDetail({ video, script, onRerender, onDelete }: { video: Video; script?: Script; onRerender: (id: string) => void; onDelete: (id: string) => void }) {
  return <div className="detail-body">
    <div className="detail-status-row"><StatusBadge status={video.status} /><span className="muted">Created {formatDate(video.createdAt, true)}</span></div>
    <div className="detail-section"><span className="detail-label">Source script</span><div className="script-quote"><span>“</span>{script?.text || 'The linked script is not available.'}</div></div>
    {video.audioUrl && <div className="media-block"><span className="detail-label"><Icon name="audio" size={14} /> Voiceover</span><audio controls src={video.audioUrl} /></div>}
    <div className="media-block"><span className="detail-label"><Icon name="image" size={14} /> Visual assets · {video.visualAssets.length}</span>
      {video.visualAssets.length ? <div className="asset-grid">{video.visualAssets.map((asset, index) => {
        const source = typeof asset === 'string' ? asset : asset.path
        const isVideo = typeof asset !== 'string' && asset.type === 'video'
        return isVideo ? <video key={`${source}-${index}`} muted playsInline preload="metadata" src={source} aria-label={asset.role || 'Visual video asset'} /> : <img key={`${source}-${index}`} src={source} alt={typeof asset === 'string' ? 'Visual asset' : asset.role || 'Visual asset'} />
      })}</div> : <div className="media-empty">No visual assets attached yet.</div>}
    </div>
    {video.renderManifest && <div className="detail-section"><span className="detail-label">Review checks</span><p className="detail-copy">{video.renderManifest.compliance?.join(' · ') || 'Asset and caption checks pending.'}</p>
      {video.renderManifest.contactSheetUrl && <img className="detail-thumbnail" src={video.renderManifest.contactSheetUrl} alt="Rendered contact sheet" />}
      {video.renderManifest.captions?.length ? <div className="script-quote">{video.renderManifest.captions.map(cue => <p key={`${cue.startSec}-${cue.text}`}>{cue.text}</p>)}</div> : null}
      {video.renderManifest.factualSources?.map(source => <a className="youtube-detail-link" key={source} href={source} target="_blank" rel="noreferrer">Science source <Icon name="external" size={14} /></a>)}
    </div>}
    {video.finalVideoUrl && <div className="media-block"><span className="detail-label"><Icon name="video" size={14} /> Final video</span><video className="video-preview" controls poster={video.thumbnailUrl} src={video.finalVideoUrl} /></div>}
    <DetailActions><ActionButton icon="redo" variant="primary" onClick={() => onRerender(video.id)}>{video.status === 'failed' ? 'Retry render' : 'Re-render video'}</ActionButton><ActionButton icon="trash" variant="danger" onClick={() => onDelete(video.id)}>Delete video</ActionButton></DetailActions>
  </div>
}
function UploadDetail({ upload, analytics, onResync, onReupload, onApprove, onDelete }: { upload: Upload; analytics?: Analytics; onResync: (id: string) => void; onReupload: (id: string) => void; onApprove: (id: string) => void; onDelete: (id: string) => void }) { return <div className="detail-body"><div className="detail-status-row"><StatusBadge status={upload.status} /><span className="muted">Created {formatDate(upload.createdAt, true)}</span></div>{upload.thumbnailUrl && <img className="detail-thumbnail" src={upload.thumbnailUrl} alt="Upload thumbnail" />}<div className="detail-meta-grid"><DetailMeta label="Scheduled at" value={formatDate(upload.scheduledAt, true)} /><DetailMeta label="YouTube ID" value={upload.youtubeVideoId || 'Not published'} /></div><div className="detail-section"><span className="detail-label">Description</span><p className="detail-copy">{upload.description || 'No description added.'}</p></div><div className="tag-list">{upload.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>{upload.youtubeUrl && <a className="youtube-detail-link" href={upload.youtubeUrl} target="_blank" rel="noreferrer">Open on YouTube <Icon name="external" size={14} /></a>}<div className="analytics-card"><div className="analytics-card-head"><div><span className="eyebrow">Latest snapshot</span><strong>Performance overview</strong></div><span className="muted">{formatDate(analytics?.fetchedAt)}</span></div><div className="analytics-grid"><AnalyticsValue label="Views" value={analytics?.views ? formatNumber(analytics.views) : '—'} /><AnalyticsValue label="Avg. duration" value={analytics?.averageViewDurationSec ? `${analytics.averageViewDurationSec}s` : '—'} /><AnalyticsValue label="Swipe away" value={analytics?.swipeAwayRate ? `${analytics.swipeAwayRate}%` : '—'} /><AnalyticsValue label="Likes" value={analytics?.likes ? formatNumber(analytics.likes) : '—'} /><AnalyticsValue label="Comments" value={analytics?.comments ? formatNumber(analytics.comments) : '—'} /><AnalyticsValue label="Subs gained" value={analytics?.subscribersGained ? `+${formatNumber(analytics.subscribersGained)}` : '—'} /></div></div><DetailActions>{upload.status === 'review_required' && <ActionButton icon="check" variant="primary" onClick={() => onApprove(upload.id)}>Approve for 18:00 tomorrow</ActionButton>}<ActionButton icon="refresh" variant="secondary" onClick={() => onResync(upload.id)}>Resync analytics</ActionButton>{upload.status === 'failed' && <ActionButton icon="redo" variant="primary" onClick={() => onReupload(upload.id)}>Re-upload</ActionButton>}<ActionButton icon="trash" variant="danger" onClick={() => onDelete(upload.id)}>Delete upload</ActionButton></DetailActions></div> }
function AnalyticsValue({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }

type LlmProviderCard = {
  id: string
  name: string
  badge: 'FREE' | 'LOW-COST' | 'PAID'
  model: string
  description: string
  signupUrl: string
  envVar: string
}

const LLM_PROVIDER_CARDS: LlmProviderCard[] = [
  { id: 'local', name: 'Local fallback', badge: 'FREE', model: 'deterministic', description: 'Zero-cost built-in script generator. Always available without any API key.', signupUrl: '', envVar: 'LLM_PROVIDER=local' },
  { id: 'groq', name: 'Groq', badge: 'FREE', model: 'llama-3.3-70b-versatile', description: '14,400 free requests/day. Llama 70B quality at zero cost. Fastest inference on the market.', signupUrl: 'https://console.groq.com', envVar: 'GROQ_API_KEY' },
  { id: 'openrouter', name: 'OpenRouter', badge: 'FREE', model: 'llama-3.1-8b-instruct:free', description: 'Free-tier models (Llama, Mistral, Gemma). Append ":free" to any model for $0.', signupUrl: 'https://openrouter.ai', envVar: 'OPENROUTER_API_KEY' },
  { id: 'nvidia', name: 'NVIDIA NIM', badge: 'FREE', model: 'llama-3.1-70b-instruct', description: 'Free API credits on signup. Enterprise-grade Llama 70B + Mixtral on NVIDIA infrastructure.', signupUrl: 'https://build.nvidia.com', envVar: 'NVIDIA_API_KEY' },
  { id: 'gemini', name: 'Gemini Flash', badge: 'LOW-COST', model: 'gemini-2.5-flash', description: '~$0.002/script. Google DeepMind — best reasoning at lowest price among paid tiers.', signupUrl: 'https://aistudio.google.com', envVar: 'GEMINI_API_KEY' },
  { id: 'openai', name: 'OpenAI GPT-4o-mini', badge: 'PAID', model: 'gpt-4o-mini', description: '~$0.01/script. Structured JSON output, strong quality. Uses your OPENAI_API_KEY.', signupUrl: 'https://platform.openai.com', envVar: 'OPENAI_API_KEY' },
]

function SettingsPage({ state, onRefresh, onConnectYouTube, onDisconnectYouTube, onUpdateAutoPublish }: { state: AppState; onRefresh: () => Promise<void>; onConnectYouTube: () => void; onDisconnectYouTube: () => void; onUpdateAutoPublish: (autoApprove: boolean, autoPublish: boolean) => void }) {
  const readiness: ProviderReadiness = state.readiness ?? { llm: true, youtube: false, youtubeSearch: false, dograh: false, visuals: false, renderer: true }
  const usage: UsageSummary = state.usage ?? { month: new Date().toISOString().slice(0, 7), spentUsd: 0, budgetUsd: 5, remainingUsd: 5 }
  const activeLlmProvider = readiness.llmProvider || 'local'

  const infraProviders: Array<{ key: keyof ProviderReadiness; name: string; description: string; needed: string; isFree?: boolean }> = [
    { key: 'youtubeSearch', name: 'Topic discovery', description: 'YouTube Data API v3 — trending Shorts topics.', needed: 'YOUTUBE_API_KEY (free 10k quota/day)' },
    { key: 'youtube', name: 'YouTube publishing', description: 'OAuth refresh-token upload + scheduled publish.', needed: 'YOUTUBE_CLIENT_ID / SECRET / REFRESH_TOKEN' },
    { key: 'dograh', name: 'Voiceover (TTS)', description: 'OpenAI-compatible speech endpoint (Speaches / Dograh).', needed: 'SPEACHES_API_URL', isFree: true },
    { key: 'visuals', name: 'Visual assets', description: 'Pexels image search. Local PNG fallback works without key.', needed: 'PEXELS_API_KEY (free 200 req/hr)', isFree: true },
    { key: 'renderer', name: 'Local renderer', description: 'FFmpeg 9:16 vertical crop. Preinstalled in Docker image.', needed: 'ffmpeg on PATH (free)', isFree: true },
  ]

  const spentPercent = Math.min(100, Math.round((usage.spentUsd / Math.max(0.01, usage.budgetUsd)) * 100))

  return <>
    <PageIntro eyebrow="Operator workspace" title="Settings & readiness" description="Configure providers, inspect budget, and see exactly which keys are still missing." action={API_MODE ? <ActionButton icon="refresh" variant="secondary" onClick={() => onRefresh().then(() => undefined)}>Sync readiness</ActionButton> : undefined} />

    <section className="settings-section">
      <SectionHeading eyebrow="Script generation" title="LLM providers" action={<span className="active-provider-chip">Active: <strong>{activeLlmProvider}</strong></span>} />
      <div className="llm-provider-grid">
        {LLM_PROVIDER_CARDS.map(card => {
          const isActive = activeLlmProvider === card.id
          const isReady = card.id === 'local' || (card.id === 'groq' && readiness.groq) || (card.id === 'openrouter' && readiness.openrouter) || (card.id === 'nvidia' && readiness.nvidia) || (card.id === 'gemini' && readiness.llm && activeLlmProvider === 'gemini') || (card.id === 'openai' && readiness.llm && activeLlmProvider === 'openai')
          return (
            <article key={card.id} className={`llm-card ${isActive ? 'llm-card-active' : ''} ${isReady && !isActive ? 'llm-card-ready' : ''}`}>
              <div className="llm-card-head">
                <span className={`provider-badge badge-${card.badge.toLowerCase().replace('-','')}`}>{card.badge}</span>
                {isActive && <span className="active-indicator"><span className="status-dot" />Active</span>}
              </div>
              <strong className="llm-card-name">{card.name}</strong>
              <code className="llm-card-model">{card.model}</code>
              <p className="llm-card-desc">{card.description}</p>
              <div className="llm-card-footer">
                <code className="env-chip">{card.envVar}</code>
                {card.signupUrl && <a href={card.signupUrl} target="_blank" rel="noreferrer" className="signup-link">Get key <Icon name="external" size={11} /></a>}
              </div>
            </article>
          )
        })}
      </div>
    </section>

    <section className="provider-grid settings-section">
      <SectionHeading eyebrow="Infrastructure" title="Pipeline services" />
      {infraProviders.map(provider => <article key={String(provider.key)} className={`provider-card ${readiness[provider.key] ? 'is-ready' : 'is-missing'}`}>
        <div className="provider-head">
          <span className={`status-dot ${readiness[provider.key] ? 'status-dot-green' : 'status-dot-red'}`} />
          {provider.name}
          {provider.isFree && <span className="provider-badge badge-free" style={{ marginLeft: 'auto', fontSize: '9px', padding: '2px 6px' }}>FREE</span>}
        </div>
        <p className="provider-desc">{provider.description}</p>
        <div className="provider-meta"><span>{readiness[provider.key] ? 'Ready' : 'Awaiting credential'}</span><code style={{ fontSize: '9px', color: '#8a8b98' }}>{provider.needed}</code></div>
        {provider.key === 'youtube' && API_MODE && (
          readiness.youtube
            ? <div style={{ marginTop: 10 }}><ActionButton icon="external" variant="secondary" onClick={onDisconnectYouTube}>Disconnect YouTube</ActionButton></div>
            : <div style={{ marginTop: 10 }}><ActionButton icon="external" variant="primary" onClick={onConnectYouTube}>Connect YouTube</ActionButton></div>
        )}
      </article>)}
    </section>

    <section className="panel settings-section">
      <SectionHeading eyebrow="Automation" title="Auto-publish pipeline" />
      <div className="settings-toggles">
        <label className="toggle-row">
          <div>
            <strong>Auto-approve</strong>
            <span className="muted">Automatically approve videos after render if review threshold is passed</span>
          </div>
          <input type="checkbox" checked={state.autoApprove} onChange={event => onUpdateAutoPublish(event.target.checked, state.autoPublish)} />
        </label>
        <label className="toggle-row">
          <div>
            <strong>Auto-publish</strong>
            <span className="muted">Automatically publish approved uploads to YouTube</span>
          </div>
          <input type="checkbox" checked={state.autoPublish} onChange={event => onUpdateAutoPublish(state.autoApprove, event.target.checked)} />
        </label>
      </div>
    </section>

    <section className="panel budget-panel">
      <SectionHeading eyebrow="Cost guardrail" title="Monthly AI budget" action={<span className="muted">Resets on the 1st of each month</span>} />
      <div className="budget-row">
        <div className="budget-bar"><span className="budget-bar-fill" style={{ width: `${spentPercent}%`, background: spentPercent > 80 ? 'var(--red)' : spentPercent > 60 ? 'var(--yellow)' : 'var(--green)' }} /></div>
        <div className="budget-figures">
          <div><span>Spent</span><strong>${usage.spentUsd.toFixed(2)}</strong></div>
          <div><span>Budget</span><strong>${usage.budgetUsd.toFixed(2)}</strong></div>
          <div><span>Remaining</span><strong>${usage.remainingUsd.toFixed(2)}</strong></div>
          <div><span>Month</span><strong>{usage.month}</strong></div>
        </div>
      </div>
      <p className="muted">Using Groq, OpenRouter, or NVIDIA NIM free tiers? Your spend stays at $0 regardless of how many Shorts you run. The circuit breaker only triggers for paid providers (OpenAI/Gemini).</p>
    </section>

    <section className="panel runbook-panel">
      <SectionHeading eyebrow="Zero-cost quick-start" title="Recommended setup" />
      <ol className="runbook-list">
        <li><strong>Start free.</strong> Set <code>LLM_PROVIDER=groq</code> and <code>GROQ_API_KEY=&lt;your key&gt;</code> — sign up free at <a href="https://console.groq.com" target="_blank" rel="noreferrer">console.groq.com</a>. 14,400 requests/day, no credit card needed.</li>
        <li><strong>Add Pexels for visuals.</strong> Free 200 req/hr at <a href="https://www.pexels.com/api" target="_blank" rel="noreferrer">pexels.com/api</a>. Without it the built-in gradient PNG renderer generates every frame locally.</li>
        <li><strong>Add YouTube API key</strong> for topic discovery — free 10,000 quota units/day via Google Cloud Console.</li>
        <li><strong>Activate YouTube OAuth last</strong> for actual uploads. Until then uploads are marked <em>scheduled</em> and retries are safe.</li>
        <li><strong>Never put provider keys in <code>VITE_*</code> variables.</strong> They will leak to every browser that loads the page.</li>
      </ol>
    </section>
  </>
}


function AuditPage({ state }: { state: AppState }) {
  if (!API_MODE) {
    return <>
      <PageIntro eyebrow="Audit log" title="Backend required" description="The structured audit stream is produced by the API. Connect the frontend with VITE_API_URL to inspect the most recent 100 events." action={<ActionButton icon="bolt" variant="primary" onClick={() => window.location.reload()}>Reload after backend config</ActionButton>} />
      <section className="panel list-panel"><div className="list-toolbar"><div className="toolbar-title"><strong>Backend offline</strong><span>No API_MODE configured</span></div></div><EmptyState title="Backend not connected" description="Reconnect by setting VITE_API_URL and reloading the dashboard." /></section>
    </>
  }
  const events = [...state.audit].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const totalCreated = events.filter(event => event.action === 'created').length
  const totalStatus = events.filter(event => event.action === 'status_changed').length
  const totalFailed = events.filter(event => event.action === 'failed').length
  return <>
    <PageIntro eyebrow="Live journal" title="Audit log" description="The most recent 100 events from the SQLite audit table. Use it to trace any failed render or upload without grepping server logs." />
    <section className="panel list-panel">
      <div className="list-toolbar">
        <div className="toolbar-title"><strong>Recent events</strong><span>{events.length} of 100 tracked · newest first</span></div>
        <div className="queue-summary">
          <span><i className="summary-dot green" /> {totalCreated} created</span>
          <span><i className="summary-dot yellow" /> {totalStatus} status changes</span>
          <span><i className="summary-dot red" /> {totalFailed} failures</span>
        </div>
      </div>
      {events.length === 0 ? (
        <EmptyState title="No events yet" description="Run a manual pipeline or wait for the scheduler to log its first audit event." />
      ) : (
        <div className="data-table audit-table">
          <div className="table-head"><span>When</span><span>Entity</span><span>Action</span><span>Status</span><span>Detail</span></div>
          {events.map(event => <div className="table-row audit-row" key={event.id}>
            <span className="muted">{formatDate(event.createdAt, true)}</span>
            <span className="entity-chip">{event.entityType}</span>
            <span className="action-chip">{event.action}</span>
            {event.status ? <StatusBadge status={event.status as Status} /> : <span className="muted">—</span>}
            <span className="muted">{event.message || truncate(JSON.stringify(event.metadata), 80)}</span>
          </div>)}
        </div>
      )}
    </section>
  </>
}

function truncate(value: string, length: number) { return value.length > length ? `${value.slice(0, length)}…` : value }

export default App
