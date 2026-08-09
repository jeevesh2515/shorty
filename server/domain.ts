export type TopicSource = 'trending' | 'evergreen' | 'manual'
export type TopicStatus = 'new' | 'selected' | 'scripted' | 'rejected'
export type ScriptStatus = 'draft' | 'approved' | 'rejected'
export type VideoStatus = 'pending' | 'rendering' | 'review_required' | 'ready' | 'failed'
export type UploadStatus = 'pending' | 'review_required' | 'approved_for_publish' | 'scheduled' | 'published' | 'failed'

export type VisualAsset = {
  path: string
  type: 'image' | 'video' | 'illustration'
  source: string
  credit?: string
  license?: string
  sourcePageUrl?: string
  verifiedSpecies?: boolean
  role?: string
  startSec?: number
  endSec?: number
}

export type CaptionCue = { startSec: number; endSec: number; text: string }

export type RenderManifest = {
  captions: CaptionCue[]
  posterFrameSec: number
  factualSources: string[]
  requiresSyntheticDisclosure: boolean
  contactSheetUrl?: string
  compliance: string[]
}

export type Topic = {
  id: string
  title: string
  niche: string
  source: TopicSource
  status: TopicStatus
  metrics: Record<string, unknown>
  rationale?: string
  createdAt: string
  updatedAt: string
}

export type JudgeCriteria = {
  hookScore: number
  retentionScore: number
  viralityScore: number
  pacingScore: number
}

export type Script = {
  id: string
  topicId: string
  text: string
  durationSec: number
  hook: string
  cta?: string
  titleSuggestion?: string
  descriptionSuggestion?: string
  tagsSuggestion: string[]
  factualSources?: string[]
  status: ScriptStatus
  judgeScore?: number
  judgeVerdict?: 'approved' | 'rejected'
  judgeFeedback?: string
  judgeCriteria?: JudgeCriteria
  createdAt: string
  updatedAt: string
}

export type Video = {
  id: string
  scriptId: string
  audioUrl?: string
  visualAssets: VisualAsset[]
  renderManifest?: RenderManifest
  finalVideoUrl?: string
  thumbnailUrl?: string
  status: VideoStatus
  createdAt: string
  updatedAt: string
}

export type Upload = {
  id: string
  videoId: string
  youtubeVideoId?: string
  youtubeUrl?: string
  title: string
  description?: string
  tags: string[]
  thumbnailUrl?: string
  scheduledAt?: string
  status: UploadStatus
  idempotencyKey: string
  createdAt: string
  updatedAt: string
}

export type Analytics = {
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

export type AuditEvent = {
  id: string
  entityType: 'topic' | 'script' | 'video' | 'upload' | 'analytics' | 'job'
  entityId: string
  action: string
  status?: string
  message?: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type EntityType = AuditEvent['entityType']

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message)
    this.name = 'DomainError'
  }
}

export function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DomainError('VALIDATION_ERROR', `${field} is required`)
}

export function assertStatusTransition(entity: 'topic' | 'script' | 'video' | 'upload', from: string, to: string) {
  const transitions: Record<string, Record<string, string[]>> = {
    topic: { new: ['selected', 'rejected'], selected: ['scripted', 'rejected'], scripted: ['rejected'], rejected: ['new'] },
    script: { draft: ['approved', 'rejected'], approved: ['rejected', 'draft'], rejected: ['draft'] },
    video: { pending: ['rendering', 'failed'], rendering: ['review_required', 'ready', 'failed', 'pending'], review_required: ['ready', 'rendering', 'failed'], ready: ['rendering', 'failed'], failed: ['pending', 'rendering'] },
    upload: { pending: ['review_required', 'scheduled', 'published', 'failed'], review_required: ['approved_for_publish', 'failed', 'pending'], approved_for_publish: ['scheduled', 'published', 'failed'], scheduled: ['published', 'failed', 'pending'], published: ['failed'], failed: ['pending', 'scheduled'] },
  }
  if (from === to) return
  if (!transitions[entity]?.[from]?.includes(to)) throw new DomainError('INVALID_TRANSITION', `Cannot transition ${entity} from ${from} to ${to}`)
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function nowIso() { return new Date().toISOString() }

export function normalizeTitle(title: string): string[] {
  const cleaned = title
    .toLowerCase()
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/#[0-9]+/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()

  const stopWords = new Set([
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could',
    'would', 'should', 'will', 'won', 't', 's', 'its', 'own', 'about', 'how', 'to',
    'make', 'of', 'and', 'or', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as',
    'into', 'like', 'through', 'after', 'over', 'between', 'out', 'up', 'down', 'why',
    'some', 'what', 'who', 'which', 'where', 'when', 'here', 'there', 'very', 'just',
    'truth', 'secret', 'breakthrough', 'overlooked', 'surprising', 'part', 'fact', 'facts',
    'creature', 'animal', 'animals', 'thing', 'things'
  ])

  return cleaned
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w))
}

export function areTopicsSimilar(titleA: string, titleB: string): boolean {
  if (titleA.trim().toLowerCase() === titleB.trim().toLowerCase()) return true
  const wordsA = normalizeTitle(titleA)
  const wordsB = normalizeTitle(titleB)
  if (!wordsA.length || !wordsB.length) return false

  const setA = new Set(wordsA)
  const setB = new Set(wordsB)

  const normA = wordsA.join(' ')
  const normB = wordsB.join(' ')
  if (normA === normB || normA.includes(normB) || normB.includes(normA)) return true

  let common = 0
  for (const w of setA) {
    for (const w2 of setB) {
      if (w === w2 || (w.length > 3 && w2.length > 3 && (w.startsWith(w2) || w2.startsWith(w)))) {
        common++
        break
      }
    }
  }

  const minLen = Math.min(setA.size, setB.size)
  const ratio = common / Math.max(1, minLen)
  if (ratio >= 0.5 && common >= 1) return true

  // Specific domain key subject match (e.g., jellyfish, octopus, bioluminescence, turritopsis)
  const keySubjects = ['jellyfish', 'octopus', 'bioluminescence', 'turritopsis', 'transdifferentiation']
  for (const ks of keySubjects) {
    const matchA = setA.has(ks) || normA.includes(ks)
    const matchB = setB.has(ks) || normB.includes(ks)
    if (matchA && matchB) return true
  }

  // General concept check for aging / age / reset / rewind life
  const ageConceptA = (setA.has('age') || setA.has('aging') || setA.has('immortal') || setA.has('rewind') || setA.has('reset') || setA.has('reverses') || setA.has('younger'))
  const ageConceptB = (setB.has('age') || setB.has('aging') || setB.has('immortal') || setB.has('rewind') || setB.has('reset') || setB.has('reverses') || setB.has('younger'))
  if (ageConceptA && ageConceptB) return true

  return false
}
