import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Analytics, AuditEvent, Script, Topic, Upload, Video } from './domain.js'
import { assertNonEmpty, assertStatusTransition, nowIso, safeJsonParse } from './domain.js'

export type DbOptions = { filename?: string; seed?: boolean }

export function stableIdempotencyKey(parts: string[]) {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40)
}

export class ShortsDatabase {
  readonly db: Database.Database
  constructor(options: DbOptions = {}) {
    const filename = options.filename || process.env.SHORTS_DB_PATH || resolve(process.cwd(), 'data/shorts-autopilot.sqlite')
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
    if (options.seed) this.seedIfEmpty()
  }

  close() { this.db.close() }

  private migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    const migration = this.db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get() as { version: number } | undefined
    if (!migration) {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, niche TEXT NOT NULL, source TEXT NOT NULL,
        status TEXT NOT NULL, metrics_json TEXT NOT NULL DEFAULT '{}', rationale TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scripts (
        id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        text TEXT NOT NULL, duration_sec REAL NOT NULL DEFAULT 30, hook TEXT NOT NULL,
        cta TEXT, title_suggestion TEXT, description_suggestion TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY, script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
        audio_url TEXT, visual_assets_json TEXT NOT NULL DEFAULT '[]', final_video_url TEXT,
        thumbnail_url TEXT, render_manifest_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        youtube_video_id TEXT, youtube_url TEXT, title TEXT NOT NULL, description TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]', thumbnail_url TEXT, scheduled_at TEXT,
        status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analytics (
        id TEXT PRIMARY KEY, upload_id TEXT NOT NULL UNIQUE REFERENCES uploads(id) ON DELETE CASCADE,
        views INTEGER NOT NULL DEFAULT 0, average_view_duration_sec REAL NOT NULL DEFAULT 0,
        swipe_away_rate REAL NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0,
        comments INTEGER NOT NULL DEFAULT 0, subscribers_gained INTEGER NOT NULL DEFAULT 0,
        estimated_revenue REAL NOT NULL DEFAULT 0, fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
        action TEXT NOT NULL, status TEXT, message TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_topics_created ON topics(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scripts_topic ON scripts(topic_id);
      CREATE INDEX IF NOT EXISTS idx_videos_script ON videos(script_id);
      CREATE INDEX IF NOT EXISTS idx_uploads_created ON uploads(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
    `)
      this.db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(nowIso())
    }
    const manifestMigration = this.db.prepare('SELECT version FROM schema_migrations WHERE version = 2').get() as { version: number } | undefined
    if (!manifestMigration) {
      try { this.db.exec("ALTER TABLE videos ADD COLUMN render_manifest_json TEXT NOT NULL DEFAULT '{}'") } catch (error) { if (!(error instanceof Error) || !error.message.includes('duplicate column')) throw error }
      this.db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?)').run(nowIso())
    }
    const judgeMigration = this.db.prepare('SELECT version FROM schema_migrations WHERE version = 3').get() as { version: number } | undefined
    if (!judgeMigration) {
      try { this.db.exec("ALTER TABLE scripts ADD COLUMN judge_score REAL; ALTER TABLE scripts ADD COLUMN judge_verdict TEXT; ALTER TABLE scripts ADD COLUMN judge_feedback TEXT; ALTER TABLE scripts ADD COLUMN judge_criteria_json TEXT NOT NULL DEFAULT '{}';") } catch (error) { if (!(error instanceof Error) || !error.message.includes('duplicate column')) throw error }
      this.db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (3, ?)').run(nowIso())
    }
  }

  private seedIfEmpty() {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM topics').get() as { count: number }
    if (count.count > 0) return
    const createdAt = nowIso()
    this.createTopic({ id: randomUUID(), title: 'How to make a Short with a zero-dollar toolchain', niche: 'Productivity', source: 'manual', status: 'new', metrics: { trendScore: 70 }, rationale: 'Seed record for backend smoke tests.', createdAt, updatedAt: createdAt })
    this.setSetting('automation_paused', 'false')
  }

  createTopic(topic: Topic) {
    assertNonEmpty(topic.title, 'Topic title'); assertNonEmpty(topic.niche, 'Topic niche')
    this.db.prepare(`INSERT INTO topics (id,title,niche,source,status,metrics_json,rationale,created_at,updated_at) VALUES (@id,@title,@niche,@source,@status,@metrics,@rationale,@createdAt,@updatedAt)`).run({ ...topic, rationale: topic.rationale || null, metrics: JSON.stringify(topic.metrics) })
    this.audit('topic', topic.id, 'created', topic.status, 'Topic created', { source: topic.source })
    return topic
  }
  listTopics(): Topic[] { return (this.db.prepare('SELECT * FROM topics ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(row => this.mapTopic(row)) }
  getTopic(id: string) { const row = this.db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as Record<string, unknown> | undefined; return row ? this.mapTopic(row) : undefined }
  updateTopicStatus(id: string, status: Topic['status']) { const current = this.getTopic(id); if (!current) return undefined; assertStatusTransition('topic', current.status, status); const updatedAt = nowIso(); this.db.prepare('UPDATE topics SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, id); this.audit('topic', id, 'status_changed', status, `Topic status changed to ${status}`, { from: current.status }); return this.getTopic(id) }

  createScript(script: Script) {
    if (!this.getTopic(script.topicId)) throw new Error(`Topic ${script.topicId} does not exist`)
    assertNonEmpty(script.text, 'Script text'); assertNonEmpty(script.hook, 'Script hook')
    this.db.prepare(`INSERT INTO scripts (id,topic_id,text,duration_sec,hook,cta,title_suggestion,description_suggestion,tags_json,status,judge_score,judge_verdict,judge_feedback,judge_criteria_json,created_at,updated_at) VALUES (@id,@topicId,@text,@durationSec,@hook,@cta,@titleSuggestion,@descriptionSuggestion,@tags,@status,@judgeScore,@judgeVerdict,@judgeFeedback,@judgeCriteria,@createdAt,@updatedAt)`).run({ ...script, cta: script.cta || null, titleSuggestion: script.titleSuggestion || null, descriptionSuggestion: script.descriptionSuggestion || null, tags: JSON.stringify(script.tagsSuggestion), judgeScore: script.judgeScore ?? null, judgeVerdict: script.judgeVerdict || null, judgeFeedback: script.judgeFeedback || null, judgeCriteria: JSON.stringify(script.judgeCriteria || {}) })
    this.audit('script', script.id, 'created', script.status, 'Script created', { topicId: script.topicId, judgeScore: script.judgeScore })
    return script
  }
  listScripts(): Script[] { return (this.db.prepare('SELECT * FROM scripts ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(row => this.mapScript(row)) }
  getScript(id: string) { const row = this.db.prepare('SELECT * FROM scripts WHERE id = ?').get(id) as Record<string, unknown> | undefined; return row ? this.mapScript(row) : undefined }
  getScriptForTopic(topicId: string) { const row = this.db.prepare('SELECT * FROM scripts WHERE topic_id = ? ORDER BY created_at DESC LIMIT 1').get(topicId) as Record<string, unknown> | undefined; return row ? this.mapScript(row) : undefined }
  updateScriptStatus(id: string, status: Script['status']) { const current = this.getScript(id); if (!current) return undefined; assertStatusTransition('script', current.status, status); const updatedAt = nowIso(); this.db.prepare('UPDATE scripts SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, id); this.audit('script', id, 'status_changed', status, `Script status changed to ${status}`, { from: current.status }); return this.getScript(id) }
  updateScriptJudge(id: string, judge: { judgeScore: number; judgeVerdict: 'approved' | 'rejected'; judgeFeedback: string; criteria?: Script['judgeCriteria'] }) { const current = this.getScript(id); if (!current) return undefined; const updatedAt = nowIso(); this.db.prepare('UPDATE scripts SET judge_score = ?, judge_verdict = ?, judge_feedback = ?, judge_criteria_json = ?, updated_at = ? WHERE id = ?').run(judge.judgeScore, judge.judgeVerdict, judge.judgeFeedback, JSON.stringify(judge.criteria || {}), updatedAt, id); this.audit('script', id, 'judged', judge.judgeVerdict, `Script evaluated by LLM Judge: ${judge.judgeScore}/10 (${judge.judgeVerdict})`, { judgeScore: judge.judgeScore }); return this.getScript(id) }

  createVideo(video: Video) {
    if (!this.getScript(video.scriptId)) throw new Error(`Script ${video.scriptId} does not exist`)
    this.db.prepare(`INSERT INTO videos (id,script_id,audio_url,visual_assets_json,final_video_url,thumbnail_url,render_manifest_json,status,created_at,updated_at) VALUES (@id,@scriptId,@audioUrl,@visualAssets,@finalVideoUrl,@thumbnailUrl,@renderManifest,@status,@createdAt,@updatedAt)`).run({ ...video, audioUrl: video.audioUrl || null, finalVideoUrl: video.finalVideoUrl || null, thumbnailUrl: video.thumbnailUrl || null, visualAssets: JSON.stringify(video.visualAssets), renderManifest: JSON.stringify(video.renderManifest || {}) })
    this.audit('video', video.id, 'created', video.status, 'Video record created', { scriptId: video.scriptId })
    return video
  }
  listVideos(): Video[] { return (this.db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(row => this.mapVideo(row)) }
  getVideo(id: string) { const row = this.db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as Record<string, unknown> | undefined; return row ? this.mapVideo(row) : undefined }
  updateVideo(id: string, patch: Partial<Pick<Video, 'status' | 'audioUrl' | 'visualAssets' | 'renderManifest' | 'finalVideoUrl' | 'thumbnailUrl'>>) { const current = this.getVideo(id); if (!current) return undefined; if (patch.status) assertStatusTransition('video', current.status, patch.status); const next = { ...current, ...patch, updatedAt: nowIso() }; this.db.prepare(`UPDATE videos SET audio_url=@audioUrl,visual_assets_json=@visualAssets,final_video_url=@finalVideoUrl,thumbnail_url=@thumbnailUrl,render_manifest_json=@renderManifest,status=@status,updated_at=@updatedAt WHERE id=@id`).run({ id, audioUrl: next.audioUrl || null, visualAssets: JSON.stringify(next.visualAssets), finalVideoUrl: next.finalVideoUrl || null, thumbnailUrl: next.thumbnailUrl || null, renderManifest: JSON.stringify(next.renderManifest || {}), status: next.status, updatedAt: next.updatedAt }); if (patch.status) this.audit('video', id, 'status_changed', patch.status, `Video status changed to ${patch.status}`, { from: current.status }); return this.getVideo(id) }

  createUpload(upload: Upload) {
    if (!this.getVideo(upload.videoId)) throw new Error(`Video ${upload.videoId} does not exist`)
    const existing = this.db.prepare('SELECT * FROM uploads WHERE idempotency_key = ?').get(upload.idempotencyKey) as Record<string, unknown> | undefined
    if (existing) return this.mapUpload(existing)
    this.db.prepare(`INSERT INTO uploads (id,video_id,youtube_video_id,youtube_url,title,description,tags_json,thumbnail_url,scheduled_at,status,idempotency_key,created_at,updated_at) VALUES (@id,@videoId,@youtubeVideoId,@youtubeUrl,@title,@description,@tags,@thumbnailUrl,@scheduledAt,@status,@idempotencyKey,@createdAt,@updatedAt)`).run({ ...upload, youtubeVideoId: upload.youtubeVideoId || null, youtubeUrl: upload.youtubeUrl || null, description: upload.description || null, thumbnailUrl: upload.thumbnailUrl || null, scheduledAt: upload.scheduledAt || null, tags: JSON.stringify(upload.tags) })
    this.audit('upload', upload.id, 'created', upload.status, 'Upload record created', { videoId: upload.videoId, idempotencyKey: upload.idempotencyKey })
    return upload
  }
  listUploads(): Upload[] { return (this.db.prepare('SELECT * FROM uploads ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(row => this.mapUpload(row)) }
  getUpload(id: string) { const row = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as Record<string, unknown> | undefined; return row ? this.mapUpload(row) : undefined }
  getUploadByKey(key: string) { const row = this.db.prepare('SELECT * FROM uploads WHERE idempotency_key = ?').get(key) as Record<string, unknown> | undefined; return row ? this.mapUpload(row) : undefined }
  updateUpload(id: string, patch: Partial<Pick<Upload, 'status' | 'youtubeVideoId' | 'youtubeUrl' | 'scheduledAt'>>) { const current = this.getUpload(id); if (!current) return undefined; if (patch.status) assertStatusTransition('upload', current.status, patch.status); const next = { ...current, ...patch, updatedAt: nowIso() }; this.db.prepare(`UPDATE uploads SET youtube_video_id=@youtubeVideoId,youtube_url=@youtubeUrl,scheduled_at=@scheduledAt,status=@status,updated_at=@updatedAt WHERE id=@id`).run({ id, youtubeVideoId: next.youtubeVideoId || null, youtubeUrl: next.youtubeUrl || null, scheduledAt: next.scheduledAt || null, status: next.status, updatedAt: next.updatedAt }); if (patch.status) this.audit('upload', id, 'status_changed', patch.status, `Upload status changed to ${patch.status}`, { from: current.status }); return this.getUpload(id) }

  upsertAnalytics(analytics: Analytics) { this.db.prepare(`INSERT INTO analytics (id,upload_id,views,average_view_duration_sec,swipe_away_rate,likes,comments,subscribers_gained,estimated_revenue,fetched_at) VALUES (@id,@uploadId,@views,@averageViewDurationSec,@swipeAwayRate,@likes,@comments,@subscribersGained,@estimatedRevenue,@fetchedAt) ON CONFLICT(upload_id) DO UPDATE SET views=excluded.views,average_view_duration_sec=excluded.average_view_duration_sec,swipe_away_rate=excluded.swipe_away_rate,likes=excluded.likes,comments=excluded.comments,subscribers_gained=excluded.subscribers_gained,estimated_revenue=excluded.estimated_revenue,fetched_at=excluded.fetched_at`).run(analytics); this.audit('analytics', analytics.id, 'synced', undefined, 'Analytics snapshot synced', { uploadId: analytics.uploadId }); return analytics }
  listAnalytics(): Analytics[] { return (this.db.prepare('SELECT * FROM analytics ORDER BY fetched_at DESC').all() as Record<string, unknown>[]).map(row => this.mapAnalytics(row)) }
  getAnalyticsForUpload(uploadId: string) { const row = this.db.prepare('SELECT * FROM analytics WHERE upload_id = ?').get(uploadId) as Record<string, unknown> | undefined; return row ? this.mapAnalytics(row) : undefined }

  audit(entityType: AuditEvent['entityType'], entityId: string, action: string, status?: string, message?: string, metadata: Record<string, unknown> = {}) { const event: AuditEvent = { id: randomUUID(), entityType, entityId, action, status, message, metadata, createdAt: nowIso() }; this.db.prepare('INSERT INTO audit_events (id,entity_type,entity_id,action,status,message,metadata_json,created_at) VALUES (@id,@entityType,@entityId,@action,@status,@message,@metadata,@createdAt)').run({ ...event, status: status || null, message: message || null, metadata: JSON.stringify(metadata) }); return event }
  listAudit(limit = 100): AuditEvent[] { return (this.db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?').all(limit) as Record<string, unknown>[]).map(row => ({ id: String(row.id), entityType: row.entity_type as AuditEvent['entityType'], entityId: String(row.entity_id), action: String(row.action), status: row.status ? String(row.status) : undefined, message: row.message ? String(row.message) : undefined, metadata: safeJsonParse(row.metadata_json as string, {}), createdAt: String(row.created_at) })) }
  deleteTopic(id: string) {
    const scripts = this.listScripts().filter(s => s.topicId === id)
    for (const script of scripts) this.deleteScript(script.id)
    this.db.prepare('DELETE FROM topics WHERE id = ?').run(id)
    this.audit('topic', id, 'deleted', undefined, 'Topic deleted')
    return { deleted: true }
  }
  deleteScript(id: string) {
    const videos = this.listVideos().filter(v => v.scriptId === id)
    for (const video of videos) this.deleteVideo(video.id)
    this.db.prepare('DELETE FROM scripts WHERE id = ?').run(id)
    this.audit('script', id, 'deleted', undefined, 'Script deleted')
    return { deleted: true }
  }
  deleteVideo(id: string) {
    const uploads = this.listUploads().filter(u => u.videoId === id)
    for (const upload of uploads) this.deleteUpload(upload.id)
    this.db.prepare('DELETE FROM videos WHERE id = ?').run(id)
    this.audit('video', id, 'deleted', undefined, 'Video deleted')
    return { deleted: true }
  }
  deleteUpload(id: string) {
    this.db.prepare('DELETE FROM analytics WHERE upload_id = ?').run(id)
    this.db.prepare('DELETE FROM uploads WHERE id = ?').run(id)
    this.audit('upload', id, 'deleted', undefined, 'Upload deleted')
    return { deleted: true }
  }

  getSetting(key: string) { return (this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value }
  setSetting(key: string, value: string) { this.db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value) }

  exportState() { return { topics: this.listTopics(), scripts: this.listScripts(), videos: this.listVideos(), uploads: this.listUploads(), analytics: this.listAnalytics(), audit: this.listAudit() } }
  private mapTopic(row: Record<string, unknown>): Topic { return { id: String(row.id), title: String(row.title), niche: String(row.niche), source: row.source as Topic['source'], status: row.status as Topic['status'], metrics: safeJsonParse(row.metrics_json as string, {}), rationale: row.rationale ? String(row.rationale) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at) } }
  private mapScript(row: Record<string, unknown>): Script { return { id: String(row.id), topicId: String(row.topic_id), text: String(row.text), durationSec: Number(row.duration_sec), hook: String(row.hook), cta: row.cta ? String(row.cta) : undefined, titleSuggestion: row.title_suggestion ? String(row.title_suggestion) : undefined, descriptionSuggestion: row.description_suggestion ? String(row.description_suggestion) : undefined, tagsSuggestion: safeJsonParse(row.tags_json as string, []), status: row.status as Script['status'], judgeScore: row.judge_score !== null && row.judge_score !== undefined ? Number(row.judge_score) : undefined, judgeVerdict: row.judge_verdict ? (row.judge_verdict as Script['judgeVerdict']) : undefined, judgeFeedback: row.judge_feedback ? String(row.judge_feedback) : undefined, judgeCriteria: safeJsonParse(row.judge_criteria_json as string, undefined), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } }
  private mapVideo(row: Record<string, unknown>): Video { const stored = safeJsonParse<unknown[]>(row.visual_assets_json as string, []); const visualAssets = stored.map(asset => typeof asset === 'string' ? { path: asset, type: 'image' as const, source: 'legacy' } : asset).filter((asset): asset is Video['visualAssets'][number] => Boolean(asset && typeof asset === 'object' && 'path' in asset)); const manifest = safeJsonParse<Partial<Video['renderManifest']>>(row.render_manifest_json as string, {}); const renderManifest = manifest && Array.isArray(manifest.captions) && typeof manifest.posterFrameSec === 'number' && Array.isArray(manifest.factualSources) && typeof manifest.requiresSyntheticDisclosure === 'boolean' && Array.isArray(manifest.compliance) ? manifest as Video['renderManifest'] : undefined; return { id: String(row.id), scriptId: String(row.script_id), audioUrl: row.audio_url ? String(row.audio_url) : undefined, visualAssets, renderManifest, finalVideoUrl: row.final_video_url ? String(row.final_video_url) : undefined, thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : undefined, status: row.status as Video['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at) } }
  private mapUpload(row: Record<string, unknown>): Upload { return { id: String(row.id), videoId: String(row.video_id), youtubeVideoId: row.youtube_video_id ? String(row.youtube_video_id) : undefined, youtubeUrl: row.youtube_url ? String(row.youtube_url) : undefined, title: String(row.title), description: row.description ? String(row.description) : undefined, tags: safeJsonParse(row.tags_json as string, []), thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : undefined, scheduledAt: row.scheduled_at ? String(row.scheduled_at) : undefined, status: row.status as Upload['status'], idempotencyKey: String(row.idempotency_key), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } }
  private mapAnalytics(row: Record<string, unknown>): Analytics { return { id: String(row.id), uploadId: String(row.upload_id), views: Number(row.views), averageViewDurationSec: Number(row.average_view_duration_sec), swipeAwayRate: Number(row.swipe_away_rate), likes: Number(row.likes), comments: Number(row.comments), subscribersGained: Number(row.subscribers_gained), estimatedRevenue: Number(row.estimated_revenue), fetchedAt: String(row.fetched_at) } }
}
