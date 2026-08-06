export type TopicSource = 'trending' | 'evergreen' | 'manual'
export type TopicStatus = 'new' | 'selected' | 'scripted' | 'rejected'
export type ScriptStatus = 'draft' | 'approved' | 'rejected'
export type VideoStatus = 'pending' | 'rendering' | 'ready' | 'failed'
export type UploadStatus = 'pending' | 'scheduled' | 'published' | 'failed'

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
  status: ScriptStatus
  createdAt: string
  updatedAt: string
}

export type Video = {
  id: string
  scriptId: string
  audioUrl?: string
  visualAssets: string[]
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
    video: { pending: ['rendering', 'failed'], rendering: ['ready', 'failed', 'pending'], ready: ['rendering', 'failed'], failed: ['pending', 'rendering'] },
    upload: { pending: ['scheduled', 'published', 'failed'], scheduled: ['published', 'failed', 'pending'], published: ['failed'], failed: ['pending', 'scheduled'] },
  }
  if (from === to) return
  if (!transitions[entity]?.[from]?.includes(to)) throw new DomainError('INVALID_TRANSITION', `Cannot transition ${entity} from ${from} to ${to}`)
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function nowIso() { return new Date().toISOString() }
