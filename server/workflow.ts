import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerConfig } from './config.js'
import { ShortsDatabase, stableIdempotencyKey } from './db.js'
import { DomainError, nowIso } from './domain.js'
import { UsageLedger } from './usage.js'
import { discoverTopics, generateScript, generateVoiceover, renderVideo, searchVisuals, uploadToYouTube, fetchYouTubeAnalytics } from './providers.js'

export class ShortsWorkflow {
  private readonly usage: UsageLedger
  constructor(private readonly db: ShortsDatabase, private readonly config: ServerConfig) { this.usage = new UsageLedger(db, config.monthlyAiBudgetUsd) }

  async createTopic(input: { title: string; niche: string; source?: 'trending' | 'evergreen' | 'manual'; rationale?: string; metrics?: Record<string, unknown> }) {
    const now = nowIso()
    return this.db.createTopic({ id: randomUUID(), title: input.title, niche: input.niche, source: input.source || 'manual', status: 'new', rationale: input.rationale, metrics: input.metrics || {}, createdAt: now, updatedAt: now })
  }

  async discoverAndStore(niche: string) {
    const result = await discoverTopics(niche, this.config)
    const topics = result.topics.map(item => this.db.createTopic({ id: randomUUID(), ...item, status: 'new', createdAt: nowIso(), updatedAt: nowIso() }))
    return { provider: result.provider, topics }
  }

  async generateScript(topicId: string) {
    const topic = this.db.getTopic(topicId)
    if (!topic) throw new DomainError('NOT_FOUND', `Topic ${topicId} was not found`, 404)
    const result = await generateScript(topic, this.config)
    this.usage.record(result.provider, 'generate_script', result.estimatedCostUsd)
    const now = nowIso()
    const existing = this.db.getScriptForTopic(topicId)
    if (existing) {
      this.db.updateScriptStatus(existing.id, 'draft')
      return { script: this.db.getScript(existing.id), provider: result.provider, estimatedCostUsd: result.estimatedCostUsd, reused: true }
    }
    const script = this.db.createScript({ id: randomUUID(), topicId, ...result.draft, createdAt: now, updatedAt: now })
    // Walk the documented state machine: new → selected → scripted.
    const currentTopic = this.db.getTopic(topicId)
    if (currentTopic?.status === 'new') this.db.updateTopicStatus(topicId, 'selected')
    this.db.updateTopicStatus(topicId, 'scripted')
    return { script: this.db.getScript(script.id), provider: result.provider, estimatedCostUsd: result.estimatedCostUsd, reused: false }
  }

  async approveScript(scriptId: string) {
    const script = this.db.updateScriptStatus(scriptId, 'approved')
    if (!script) throw new DomainError('NOT_FOUND', `Script ${scriptId} was not found`, 404)
    return script
  }

  async createVideo(scriptId: string) {
    const script = this.db.getScript(scriptId)
    if (!script) throw new DomainError('NOT_FOUND', `Script ${scriptId} was not found`, 404)
    const existing = this.db.listVideos().find(video => video.scriptId === scriptId && video.status !== 'failed')
    if (existing) return existing
    return this.db.createVideo({ id: randomUUID(), scriptId, visualAssets: [], status: 'pending', createdAt: nowIso(), updatedAt: nowIso() })
  }

  async produceVideo(videoId: string) {
    const video = this.db.getVideo(videoId)
    if (!video) throw new DomainError('NOT_FOUND', `Video ${videoId} was not found`, 404)
    const script = this.db.getScript(video.scriptId)
    if (!script) throw new DomainError('DATA_INTEGRITY', `Script ${video.scriptId} was not found`, 500)
    this.db.updateVideo(videoId, { status: 'rendering' })
    try {
      let assets = video.visualAssets
      if (!assets.length) {
        const result = await searchVisuals(script.titleSuggestion || script.hook, this.config)
        assets = result.assets.map(asset => asset.url)
      }
      // An empty asset list is intentional: the renderer creates a deterministic SVG fallback.
      this.db.updateVideo(videoId, { visualAssets: assets })
      const voice = await generateVoiceover(script.text, this.config, this.config.mediaDir)
      if (voice.audioUrl) this.db.updateVideo(videoId, { audioUrl: voice.audioUrl })
      const updated = this.db.getVideo(videoId)
      if (!updated) throw new Error('Video disappeared during render')
      const result = await renderVideo(updated, script, this.config, this.config.mediaDir)
      const ready = this.db.updateVideo(videoId, { status: 'ready', finalVideoUrl: result.finalVideoUrl, thumbnailUrl: result.thumbnailUrl })
      return { video: ready, providers: { visuals: 'configured-or-local', voice: voice.provider, renderer: result.provider } }
    } catch (error) {
      this.db.updateVideo(videoId, { status: 'failed' })
      this.db.audit('job', videoId, 'failed', 'failed', error instanceof Error ? error.message : 'Video production failed')
      throw error
    }
  }

  async createUpload(videoId: string, input: { title: string; description?: string; tags?: string[]; scheduledAt?: string }) {
    const video = this.db.getVideo(videoId)
    if (!video) throw new DomainError('NOT_FOUND', `Video ${videoId} was not found`, 404)
    const key = stableIdempotencyKey([videoId, input.title, input.scheduledAt || 'now'])
    const existing = this.db.getUploadByKey(key)
    if (existing) return existing
    return this.db.createUpload({ id: randomUUID(), videoId, title: input.title, description: input.description, tags: input.tags || [], scheduledAt: input.scheduledAt, status: input.scheduledAt ? 'scheduled' : 'pending', idempotencyKey: key, createdAt: nowIso(), updatedAt: nowIso() })
  }

  async publishUpload(uploadId: string) {
    const upload = this.db.getUpload(uploadId)
    if (!upload) throw new DomainError('NOT_FOUND', `Upload ${uploadId} was not found`, 404)
    if (upload.youtubeVideoId) return upload
    const video = this.db.getVideo(upload.videoId)
    if (!video?.finalVideoUrl) throw new DomainError('PRECONDITION_FAILED', 'Video must be rendered before upload', 412)
    const fileName = video.finalVideoUrl.replace(/^.*\//, '')
    const path = join(this.config.mediaDir, fileName)
    if (!existsSync(path)) throw new DomainError('MEDIA_NOT_FOUND', `Rendered file is missing: ${path}`, 409)
    try {
      const result = await uploadToYouTube(path, upload.title, upload.description || '', upload.tags, upload.scheduledAt, this.config)
      return this.db.updateUpload(uploadId, result)
    } catch (error) {
      this.db.updateUpload(uploadId, { status: 'failed' })
      this.db.audit('job', uploadId, 'failed', 'failed', error instanceof Error ? error.message : 'Upload failed')
      throw error
    }
  }

  async syncAnalytics() {
    const published = this.db.listUploads().filter(upload => upload.youtubeVideoId).map(upload => ({ uploadId: upload.id, youtubeVideoId: upload.youtubeVideoId! }))
    if (!published.length) return []
    const records = await fetchYouTubeAnalytics(published, this.config)
    records.forEach(record => this.db.upsertAnalytics(record))
    return records
  }

  async runManual(input: { niche: string; topicTitle?: string }) {
    const topic = input.topicTitle ? await this.createTopic({ title: input.topicTitle, niche: input.niche }) : (await this.discoverAndStore(input.niche)).topics[0]
    const generated = await this.generateScript(topic.id)
    const script = generated.script
    if (!script) throw new Error('Script generation returned no script')
    const approved = await this.approveScript(script.id)
    const video = await this.createVideo(approved.id)
    const produced = await this.produceVideo(video.id)
    const upload = await this.createUpload(video.id, { title: approved.titleSuggestion || topic.title, description: approved.descriptionSuggestion, tags: approved.tagsSuggestion })
    return { topic, script: approved, video: produced.video, upload, providers: generated.provider }
  }

  async runScheduled() {
    if (this.config.automationPaused || this.db.getSetting('automation_paused') === 'true') return { skipped: true, reason: 'automation_paused' }
    const day = new Date().toISOString().slice(0, 10)
    const key = `scheduled:${day}`
    if (this.db.getSetting(key) === 'complete') return { skipped: true, reason: 'already_completed', day }
    this.db.setSetting(key, 'running')
    try { const result = await this.runManual({ niche: process.env.DEFAULT_NICHE || 'Productivity' }); this.db.setSetting(key, 'complete'); return result } catch (error) { this.db.setSetting(key, 'failed'); throw error }
  }

  usageSummary() { return this.usage.summary() }
}
