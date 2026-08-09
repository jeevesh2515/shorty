import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerConfig } from './config.js'
import { ShortsDatabase, stableIdempotencyKey } from './db.js'
import { DomainError, areTopicsSimilar, nowIso } from './domain.js'
import type { Upload, VisualAsset } from './domain.js'
import { UsageLedger } from './usage.js'
import { discoverTopics, generateScript, generateThumbnailConcept, generateVoiceover, judgeScript, renderVideo, searchVisuals, uploadToYouTube, fetchYouTubeAnalytics } from './providers.js'

export class ShortsWorkflow {
  private readonly usage: UsageLedger
  constructor(private readonly db: ShortsDatabase, private readonly config: ServerConfig) { this.usage = new UsageLedger(db, config.monthlyAiBudgetUsd) }

  async createTopic(input: { title: string; niche: string; source?: 'trending' | 'evergreen' | 'manual'; rationale?: string; metrics?: Record<string, unknown> }) {
    const existingTopics = this.db.listTopics()
    const similar = existingTopics.find(t => areTopicsSimilar(t.title, input.title))
    if (similar) {
      if (similar.status === 'new') return similar
      throw new DomainError('SIMILAR_TOPIC_EXISTS', `A similar topic already exists: "${similar.title}"`, 409)
    }
    const now = nowIso()
    return this.db.createTopic({ id: randomUUID(), title: input.title, niche: input.niche, source: input.source || 'manual', status: 'new', rationale: input.rationale, metrics: input.metrics || {}, createdAt: now, updatedAt: now })
  }

  async discoverAndStore(niche: string) {
    const result = await discoverTopics(niche, this.config)
    const existingTopics = this.db.listTopics()
    const candidateTopics = result.topics.filter(item => !existingTopics.some(t => areTopicsSimilar(t.title, item.title)))
    const topics = candidateTopics.map((item) => {
      return this.db.createTopic({ id: randomUUID(), ...item, title: item.title, status: 'new', createdAt: nowIso(), updatedAt: nowIso() })
    })
    return { provider: result.provider, topics }
  }

  async generateScript(topicId: string, maxAttempts = 3, minScore = 9.0) {
    const topic = this.db.getTopic(topicId)
    if (!topic) throw new DomainError('NOT_FOUND', `Topic ${topicId} was not found`, 404)

    const allTopics = this.db.listTopics()
    const allScripts = this.db.listScripts()
    const allVideos = this.db.listVideos().filter(v => v.status !== 'failed')

    const topicsWithContent = allTopics.filter(t => {
      if (t.id === topicId) return false
      const hasScript = allScripts.some(s => s.topicId === t.id && (s.status === 'approved' || s.status === 'draft'))
      const hasVideo = allVideos.some(v => {
        const s = allScripts.find(scr => scr.id === v.scriptId)
        return s?.topicId === t.id
      })
      return hasScript || hasVideo
    })

    const similarTopic = topicsWithContent.find(t => areTopicsSimilar(topic.title, t.title))
    if (similarTopic) {
      throw new DomainError('SIMILAR_TOPIC_EXISTS', `A script or video has already been generated for a similar topic: "${similarTopic.title}". Script generation is prevented to avoid duplicate videos.`, 409)
    }

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

      // Research quality gate: when enabled, an approved-quality script still cannot proceed
      // without at least one authoritative source URL backing its factual claim.
      const sourcesMissing = this.config.requireResearch && !result.draft.factualSources?.length
      if (judge.judgeScore >= minScore && !sourcesMissing) {
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

      const sourceNote = sourcesMissing ? ' The draft must include a factualSources array with at least one authoritative http(s) URL (e.g. pubmed/doi/university).' : ''
      feedbackPrompt = `Attempt #${attempt} scored ${judge.judgeScore}/10. Feedback: ${judge.judgeFeedback}${sourceNote}`
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
      if (assets.length > 8) {
        const videos = assets.filter(a => a.type === 'video')
        const images = assets.filter(a => a.type === 'image')
        const cappedVideos = videos.slice(0, 6)
        const cappedImages = images.slice(0, Math.max(0, 8 - cappedVideos.length))
        assets = [...cappedVideos, ...cappedImages]
      }
      // Authentic-footage quality gate: when enabled, a topic that needs real moving footage
      // must never ship with generated illustration cards instead.
      if (this.config.requireVideoFootage && !assets.some(asset => asset.type === 'video')) {
        throw new DomainError('FOOTAGE_REQUIRED', 'Authentic video footage is required, but only images or generated illustrations were found', 422)
      }
      const videoAssets = assets.filter(asset => asset.type === 'video')
      const imageAssets = assets.filter(asset => asset.type === 'image')
      const visualsProvider = !assets.length ? 'local-illustrated-fallback' : videoAssets.length ? `${videoAssets[0].source}-video` : imageAssets.length ? `${imageAssets[0].source}-images` : 'local-illustrated-fallback'
      this.db.audit('video', videoId, 'visuals_acquired', 'acquired', 'Visual assets acquired with provenance', {
        count: assets.length,
        provider: visualsProvider,
        assets: assets.map(a => ({ source: a.source, license: a.license, credit: a.credit, sourcePageUrl: a.sourcePageUrl, type: a.type, role: a.role })),
      })
      // An empty asset list is intentional: the renderer creates a deterministic SVG fallback.
      this.db.updateVideo(videoId, { visualAssets: assets })
      const voice = await generateVoiceover(script.text, this.config, this.config.mediaDir)
      if (!voice.audioUrl && !this.config.allowSilentAudio) {
        throw new DomainError('VOICEOVER_REQUIRED', 'A TTS provider must return an audio file before this video can be reviewed or published', 412)
      }
      if (voice.audioUrl) this.db.updateVideo(videoId, { audioUrl: voice.audioUrl })
      const updated = this.db.getVideo(videoId)
      if (!updated) throw new Error('Video disappeared during render')
      const result = await renderVideo(updated, script, this.config, this.config.mediaDir)
      const thumbnailConcept = await generateThumbnailConcept(script, this.config, this.config.mediaDir)
      const thumbnailUrl = thumbnailConcept.thumbnailUrl || result.thumbnailUrl
      const status = this.reviewModeActive() ? 'review_required' : 'ready'
      const ready = this.db.updateVideo(videoId, { status, finalVideoUrl: result.finalVideoUrl, thumbnailUrl, renderManifest: result.renderManifest })
      return { video: ready, providers: { visuals: visualsProvider, voice: voice.provider, renderer: result.provider, thumbnail: thumbnailConcept.provider } }
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
    if (this.youtubeConfigured()) return this.publishUpload(uploadId)
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
    if (!generated.approved) {
      throw new DomainError('SCRIPT_REJECTED', generated.judge?.judgeFeedback || 'The script did not meet the quality threshold', 422)
    }
    const video = await this.createVideo(script.id)
    const produced = await this.produceVideo(video.id)
    const created = await this.createUpload(video.id, { title: script.titleSuggestion || topic.title, description: script.descriptionSuggestion, tags: script.tagsSuggestion, thumbnailUrl: produced.video?.thumbnailUrl })
    const upload = await this.finishUpload(created)
    return { topic, script, video: produced.video, upload, providers: generated.provider }
  }

  /**
   * The daily unattended run.
   *
   * `force` exists because the London-hour gate cannot survive an external cron. GitHub
   * Actions schedules are UTC-only and routinely run late, so a fixed UTC time drifts out
   * of the one-hour window whenever the clocks change — and any delayed run misses it
   * entirely. With `force`, the caller owns the schedule and the per-day key below still
   * guarantees at most one publish per day.
   */
  async runScheduled(options: { force?: boolean } = {}) {
    if (this.config.automationPaused || this.db.getSetting('automation_paused') === 'true') return { skipped: true, reason: 'automation_paused' }
    const london = londonParts(new Date())
    const day = `${london.year}-${String(london.month).padStart(2, '0')}-${String(london.day).padStart(2, '0')}`
    const key = `scheduled:${day}`
    if (this.db.getSetting(key) === 'complete') return { skipped: true, reason: 'already_completed', day }
    if (!options.force && london.hour !== this.config.reviewHourLondon) return { skipped: true, reason: 'outside_review_window', hour: london.hour }
    this.db.setSetting(key, 'running')
    try {
      // runManual already applies auto-approve and auto-publish via finishUpload().
      const result = await this.runManual({ niche: pickNiche(this.config.defaultNiche) })
      this.db.setSetting(key, 'complete')
      return result
    } catch (error) { this.db.setSetting(key, 'failed'); throw error }
  }

  /**
   * Attach externally-produced visual assets to a video.
   *
   * produceVideo() already prefers `video.visualAssets` when non-empty and only falls back
   * to stock search when it is empty — there was simply no way to set them. This lets
   * bespoke footage (Veo, Higgsfield, anything else) render through the same pipeline,
   * with the same captions and the same upload path, instead of a parallel one.
   */
  async setVisualAssets(videoId: string, assets: VisualAsset[]) {
    const video = this.db.getVideo(videoId)
    if (!video) throw new DomainError('NOT_FOUND', `Video ${videoId} was not found`, 404)
    if (!assets.length) throw new DomainError('INVALID_INPUT', 'At least one visual asset is required', 400)
    for (const asset of assets) {
      if (!/^https:\/\//i.test(asset.path)) {
        throw new DomainError('INVALID_INPUT', `Asset paths must be https URLs: ${asset.path}`, 400)
      }
    }
    this.db.updateVideo(videoId, { visualAssets: assets })
    this.db.audit('video', videoId, 'visuals_attached', 'attached', 'Externally supplied visual assets attached', {
      count: assets.length,
      sources: assets.map(asset => asset.source),
    })
    return this.db.getVideo(videoId)
  }

  /**
   * Ingest a finished MP4 rendered outside the container.
   *
   * The filename is derived from the video id, never from the request, so a caller cannot
   * choose a write path. Size and content type are both checked before anything is written.
   */
  async attachRenderedMedia(videoId: string, sourceUrl: string, maxBytes = 300 * 1024 * 1024) {
    const video = this.db.getVideo(videoId)
    if (!video) throw new DomainError('NOT_FOUND', `Video ${videoId} was not found`, 404)
    if (!/^https:\/\//i.test(sourceUrl)) throw new DomainError('INVALID_INPUT', 'sourceUrl must be an https URL', 400)

    const response = await fetch(sourceUrl)
    if (!response.ok) throw new DomainError('FETCH_FAILED', `Could not fetch media (${response.status})`, 502)

    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength && declaredLength > maxBytes) {
      throw new DomainError('MEDIA_TOO_LARGE', `Media is ${declaredLength} bytes, limit is ${maxBytes}`, 413)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw new DomainError('MEDIA_TOO_LARGE', `Media exceeds ${maxBytes} bytes`, 413)
    // ftyp box at offset 4 — cheap structural check that this is really an MP4.
    if (buffer.length < 12 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') {
      throw new DomainError('INVALID_MEDIA', 'Fetched file is not a valid MP4', 415)
    }

    mkdirSync(this.config.mediaDir, { recursive: true })
    const fileName = `${videoId}-final.mp4`
    await writeFile(join(this.config.mediaDir, fileName), buffer)

    const status = this.reviewModeActive() ? 'review_required' : 'ready'
    const updated = this.db.updateVideo(videoId, { status, finalVideoUrl: `/media/${fileName}` })
    this.db.audit('video', videoId, 'media_attached', status, 'Externally rendered media attached', {
      bytes: buffer.length,
      sourceUrl,
    })
    return updated
  }

  async deleteTopic(topicId: string) { return this.db.deleteTopic(topicId) }
  async cleanupTopics() { return this.db.cleanupUnscriptedTopics() }
  async deleteVideo(videoId: string) { return this.db.deleteVideo(videoId) }
  async deleteUpload(uploadId: string) { return this.db.deleteUpload(uploadId) }

  usageSummary() { return this.usage.summary() }

  autoApproveEnabled() { return this.config.autoApprove || this.db.getSetting('auto_approve') === 'true' }
  autoPublishEnabled() { return this.config.autoPublish || this.db.getSetting('auto_publish') === 'true' }

  /**
   * Whether new videos and uploads should land in `review_required`.
   *
   * The count-based rule on its own is why AUTO_APPROVE appeared to do nothing: until
   * `reviewLimit` (default 10) uploads reached an approved/published state, every new item
   * was forced into review — and nothing could reach that state without being approved
   * first. A deadlock. An explicit auto-approve now short-circuits it.
   */
  private reviewModeActive() {
    if (this.autoApproveEnabled()) return false
    return this.db.listUploads().filter(upload => ['approved_for_publish', 'scheduled', 'published'].includes(upload.status)).length < this.config.reviewLimit
  }

  /**
   * Apply auto-approve / auto-publish to a freshly created upload.
   *
   * Shared by every trigger route. This logic used to live only inside runScheduled(), so
   * a run started via /api/runs/manual left its upload in review forever — exactly what an
   * external cron hitting that route would have produced.
   */
  private async finishUpload(upload: Upload): Promise<Upload> {
    let current = upload
    if (this.autoApproveEnabled() && current.status === 'review_required') {
      const approved = await this.approveForPublish(current.id)
      if (!approved) throw new Error('Approval did not return an upload')
      current = approved
    }
    if (this.autoPublishEnabled() && (current.status === 'approved_for_publish' || current.status === 'scheduled')) {
      const published = await this.publishUpload(current.id)
      if (published) current = published
    }
    return current
  }
  private youtubeConfigured() { const youtube = this.youtubeConfig(); return Boolean(youtube.youtubeClientId && youtube.youtubeClientSecret && youtube.youtubeRefreshToken) }
  private youtubeConfig() { const dbToken = this.db.getSetting('youtube_refresh_token'); return dbToken ? { ...this.config, youtubeRefreshToken: dbToken } : this.config }
}

/**
 * Resolve the niche for today's run.
 *
 * `DEFAULT_NICHE` accepts a comma-separated list and rotates through it by day. Publishing
 * the same niche in the same format every single day is the pattern YouTube's
 * inauthentic-content policy singles out — rotation is cheap insurance against a channel
 * that "feels interchangeable from video to video".
 */
export function pickNiche(spec: string, date = new Date()): string {
  const niches = spec.split(',').map(value => value.trim()).filter(Boolean)
  if (niches.length <= 1) return niches[0] || 'Productivity'
  const dayNumber = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000)
  return niches[dayNumber % niches.length]
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
