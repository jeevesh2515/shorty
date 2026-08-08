import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerConfig } from './config.js'
import { ShortsDatabase, stableIdempotencyKey } from './db.js'
import { DomainError, nowIso } from './domain.js'
import { UsageLedger } from './usage.js'
import { discoverTopics, generateScript, generateThumbnailConcept, generateVoiceover, judgeScript, renderVideo, searchVisuals, uploadToYouTube, fetchYouTubeAnalytics } from './providers.js'

export class ShortsWorkflow {
  private readonly usage: UsageLedger
  constructor(private readonly db: ShortsDatabase, private readonly config: ServerConfig) { this.usage = new UsageLedger(db, config.monthlyAiBudgetUsd) }

  async createTopic(input: { title: string; niche: string; source?: 'trending' | 'evergreen' | 'manual'; rationale?: string; metrics?: Record<string, unknown> }) {
    const now = nowIso()
    return this.db.createTopic({ id: randomUUID(), title: input.title, niche: input.niche, source: input.source || 'manual', status: 'new', rationale: input.rationale, metrics: input.metrics || {}, createdAt: now, updatedAt: now })
  }

  async discoverAndStore(niche: string) {
    const result = await discoverTopics(niche, this.config)
    const existingTitles = new Set(this.db.listTopics().map(t => t.title.toLowerCase()))
    const topics = result.topics.map((item, index) => {
      let uniqueTitle = item.title
      if (existingTitles.has(uniqueTitle.toLowerCase())) {
        const count = Array.from(existingTitles).filter(t => t.startsWith(uniqueTitle.toLowerCase())).length + 1
        uniqueTitle = `${item.title} #${count}`
      }
      existingTitles.add(uniqueTitle.toLowerCase())
      return this.db.createTopic({ id: randomUUID(), ...item, title: uniqueTitle, status: 'new', createdAt: nowIso(), updatedAt: nowIso() })
    })
    return { provider: result.provider, topics }
  }

  async generateScript(topicId: string, maxAttempts = 3, minScore = 9.0) {
    const topic = this.db.getTopic(topicId)
    if (!topic) throw new DomainError('NOT_FOUND', `Topic ${topicId} was not found`, 404)
    
    let lastDraft: any
    let lastJudge: any
    let lastProvider = 'local-fallback'
    let totalCost = 0
    let feedbackPrompt: string | undefined

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await generateScript(topic, this.config, feedbackPrompt)
      this.usage.record(result.provider, 'generate_script', result.estimatedCostUsd)
      totalCost += result.estimatedCostUsd
      lastProvider = result.provider
      lastDraft = result.draft

      const judge = await judgeScript(topic, result.draft, this.config)
      lastJudge = judge

      if (judge.judgeScore >= minScore) {
        const now = nowIso()
        const script = this.db.createScript({
          id: randomUUID(),
          topicId,
          ...result.draft,
          status: 'approved',
          judgeScore: judge.judgeScore,
          judgeVerdict: 'approved',
          judgeFeedback: judge.judgeFeedback,
          judgeCriteria: judge.criteria,
          createdAt: now,
          updatedAt: now,
        })
        const currentTopic = this.db.getTopic(topicId)
        if (currentTopic?.status === 'new') this.db.updateTopicStatus(topicId, 'selected')
        this.db.updateTopicStatus(topicId, 'scripted')
        return { script: this.db.getScript(script.id), judge, attempts: attempt, provider: result.provider, estimatedCostUsd: totalCost, approved: true }
      }

      feedbackPrompt = `Attempt #${attempt} scored ${judge.judgeScore}/10. Feedback: ${judge.judgeFeedback}`
    }

    const now = nowIso()
    const script = this.db.createScript({
      id: randomUUID(),
      topicId,
      ...lastDraft,
      status: 'draft',
      judgeScore: lastJudge?.judgeScore,
      judgeVerdict: 'rejected',
      judgeFeedback: lastJudge?.judgeFeedback,
      judgeCriteria: lastJudge?.criteria,
      createdAt: now,
      updatedAt: now,
    })
    const currentTopic = this.db.getTopic(topicId)
    if (currentTopic?.status === 'new') this.db.updateTopicStatus(topicId, 'selected')
    this.db.updateTopicStatus(topicId, 'scripted')
    return { script: this.db.getScript(script.id), judge: lastJudge, attempts: maxAttempts, provider: lastProvider, estimatedCostUsd: totalCost, approved: false }
  }

  async evaluateScriptWithJudge(scriptId: string) {
    const script = this.db.getScript(scriptId)
    if (!script) throw new DomainError('NOT_FOUND', `Script ${scriptId} was not found`, 404)
    const topic = this.db.getTopic(script.topicId)
    if (!topic) throw new DomainError('NOT_FOUND', `Topic ${script.topicId} was not found`, 404)

    const judge = await judgeScript(topic, script, this.config)
    this.db.updateScriptJudge(scriptId, judge)
    if (judge.judgeScore >= 9.0 && script.status !== 'approved') {
      this.db.updateScriptStatus(scriptId, 'approved')
    }
    return { script: this.db.getScript(scriptId), judge }
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
        assets = result.assets
      }
      // An empty asset list is intentional: the renderer creates a deterministic SVG fallback.
      this.db.updateVideo(videoId, { visualAssets: assets })
      const voice = await generateVoiceover(script.text, this.config, this.config.mediaDir)
      if (voice.audioUrl) this.db.updateVideo(videoId, { audioUrl: voice.audioUrl })
      const updated = this.db.getVideo(videoId)
      if (!updated) throw new Error('Video disappeared during render')
      const result = await renderVideo(updated, script, this.config, this.config.mediaDir)
      const thumbnailConcept = await generateThumbnailConcept(script, this.config, this.config.mediaDir)
      const thumbnailUrl = thumbnailConcept.thumbnailUrl || result.thumbnailUrl
      const status = this.reviewModeActive() ? 'review_required' : 'ready'
      const ready = this.db.updateVideo(videoId, { status, finalVideoUrl: result.finalVideoUrl, thumbnailUrl })
      return { video: ready, providers: { visuals: 'configured-or-local', voice: voice.provider, renderer: result.provider, thumbnail: thumbnailConcept.provider } }
    } catch (error) {
      this.db.updateVideo(videoId, { status: 'failed' })
      this.db.audit('job', videoId, 'failed', 'failed', error instanceof Error ? error.message : 'Video production failed')
      throw error
    }
  }

  async createUpload(videoId: string, input: { title: string; description?: string; tags?: string[]; scheduledAt?: string; thumbnailUrl?: string }) {
    const video = this.db.getVideo(videoId)
    if (!video) throw new DomainError('NOT_FOUND', `Video ${videoId} was not found`, 404)
    const key = stableIdempotencyKey([videoId, input.title, input.scheduledAt || 'now'])
    const existing = this.db.getUploadByKey(key)
    if (existing) return existing
    const needsReview = this.reviewModeActive()
    return this.db.createUpload({ id: randomUUID(), videoId, title: input.title, description: input.description, tags: input.tags || [], scheduledAt: input.scheduledAt, status: needsReview ? 'review_required' : input.scheduledAt ? 'scheduled' : 'pending', thumbnailUrl: input.thumbnailUrl, idempotencyKey: key, createdAt: nowIso(), updatedAt: nowIso() })
  }

  async approveForPublish(uploadId: string) {
    const upload = this.db.getUpload(uploadId)
    if (!upload) throw new DomainError('NOT_FOUND', `Upload ${uploadId} was not found`, 404)
    if (upload.status !== 'review_required') throw new DomainError('PRECONDITION_FAILED', 'Upload is not awaiting review', 412)
    const video = this.db.getVideo(upload.videoId)
    if (!video?.finalVideoUrl) throw new DomainError('PRECONDITION_FAILED', 'Video must be rendered before approval', 412)
    if (video.status === 'review_required') this.db.updateVideo(video.id, { status: 'ready' })
    const scheduledAt = nextLondonTime(this.config.publishHourLondon)
    const approved = this.db.updateUpload(uploadId, { status: 'approved_for_publish', scheduledAt })
    this.db.audit('upload', uploadId, 'approved_for_publish', 'approved_for_publish', 'Approved for the next London publishing slot', { scheduledAt })
    return approved
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
      const result = await uploadToYouTube(path, upload.title, upload.description || '', upload.tags, upload.scheduledAt, this.youtubeConfig())
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
    const records = await fetchYouTubeAnalytics(published, this.youtubeConfig())
    records.forEach(record => this.db.upsertAnalytics(record))
    return records
  }

  async runManual(input: { niche: string; topicTitle?: string }) {
    const topic = input.topicTitle ? await this.createTopic({ title: input.topicTitle, niche: input.niche }) : (await this.discoverAndStore(input.niche)).topics[0]
    const generated = await this.generateScript(topic.id)
    const script = generated.script
    if (!script) throw new Error('Script generation returned no script')
    const video = await this.createVideo(script.id)
    const produced = await this.produceVideo(video.id)
    const upload = await this.createUpload(video.id, { title: script.titleSuggestion || topic.title, description: script.descriptionSuggestion, tags: script.tagsSuggestion, thumbnailUrl: produced.video?.thumbnailUrl })
    return { topic, script, video: produced.video, upload, providers: generated.provider }
  }

  async runScheduled() {
    if (this.config.automationPaused || this.db.getSetting('automation_paused') === 'true') return { skipped: true, reason: 'automation_paused' }
    const london = londonParts(new Date())
    const day = `${london.year}-${String(london.month).padStart(2, '0')}-${String(london.day).padStart(2, '0')}`
    const key = `scheduled:${day}`
    if (this.db.getSetting(key) === 'complete') return { skipped: true, reason: 'already_completed', day }
    if (london.hour !== this.config.reviewHourLondon) return { skipped: true, reason: 'outside_review_window', hour: london.hour }
    this.db.setSetting(key, 'running')
    try {
      const result = await this.runManual({ niche: process.env.DEFAULT_NICHE || 'Productivity' })
      const upload = result.upload
      const autoApprove = this.config.autoApprove || this.db.getSetting('auto_approve') === 'true'
      const autoPublish = this.config.autoPublish || this.db.getSetting('auto_publish') === 'true'
      if (autoApprove && upload.status === 'review_required') {
        await this.approveForPublish(upload.id)
      }
      if (autoPublish && (upload.status === 'approved_for_publish' || upload.status === 'scheduled')) {
        await this.publishUpload(upload.id)
      }
      this.db.setSetting(key, 'complete')
      return result
    } catch (error) { this.db.setSetting(key, 'failed'); throw error }
  }

  async deleteTopic(topicId: string) { return this.db.deleteTopic(topicId) }
  async cleanupTopics() { return this.db.cleanupUnscriptedTopics() }
  async deleteVideo(videoId: string) { return this.db.deleteVideo(videoId) }
  async deleteUpload(uploadId: string) { return this.db.deleteUpload(uploadId) }

  usageSummary() { return this.usage.summary() }
  private reviewModeActive() { return this.db.listUploads().filter(upload => ['approved_for_publish', 'scheduled', 'published'].includes(upload.status)).length < this.config.reviewLimit }
  private youtubeConfig() { const dbToken = this.db.getSetting('youtube_refresh_token'); return dbToken ? { ...this.config, youtubeRefreshToken: dbToken } : this.config }
}

function londonParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value || 0)
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour') }
}

function nextLondonTime(hour: number) {
  const london = londonParts(new Date())
  const candidate = new Date(Date.UTC(london.year, london.month - 1, london.day + 1, hour, 0, 0))
  const observed = londonParts(candidate)
  const observedUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour)
  const offset = observedUtc - candidate.getTime()
  return new Date(candidate.getTime() - offset).toISOString()
}
