import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 180000, hookTimeout: 180000 })
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { rmSync } from 'node:fs'
import { loadConfig } from '../server/config.js'
import { ShortsDatabase } from '../server/db.js'
import { ShortsWorkflow } from '../server/workflow.js'

// Mock ONLY uploadToYouTube; every other provider (renderVideo, generateVoiceover, ...)
// stays real so the full render tests above keep exercising the actual pipeline.
const youtubeMocks = vi.hoisted(() => ({ uploadToYouTube: vi.fn() }))
vi.mock('../server/providers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/providers.js')>()
  return { ...actual, uploadToYouTube: youtubeMocks.uploadToYouTube }
})

const tempRoot = resolve(process.cwd(), 'data/workflow-test')

beforeEach(() => { youtubeMocks.uploadToYouTube.mockReset() })

afterAll(() => {
  if (existsSyncForTests(tempRoot)) rmSync(tempRoot, { recursive: true, force: true })
})

function existsSyncForTests(path: string) { try { return statSync(path) ? true : false } catch { return false } }

describe('workflow.localFallbackPipeline', () => {
  it('creates topic, script, video, and upload with a real rendered MP4', async () => {
    const mediaDir = join(tempRoot, 'media')
    mkdirSync(mediaDir, { recursive: true })
    const db = new ShortsDatabase({ filename: ':memory:' })
    const config = { ...loadConfig({}), dbPath: ':memory:', mediaDir }
    const workflow = new ShortsWorkflow(db, config)

    const result = await workflow.runManual({ niche: 'Science', topicTitle: 'Why octopuses edit their own genes' })
    if (!result.video || !result.script || !result.upload) throw new Error('runManual did not return expected entities')
    const topic = db.getTopic(result.topic.id)
    const script = db.getScript(result.script.id)
    const video = db.getVideo(result.video.id)
    const upload = db.getUpload(result.upload.id)

    expect(topic?.status).toBe('scripted')
    expect(script?.titleSuggestion).toBeTruthy()
    expect(script?.durationSec).toBeGreaterThanOrEqual(15)
    expect(video?.status).toBe('review_required')
    expect(video?.finalVideoUrl).toMatch(/^\/media\//)
    expect(video?.renderManifest?.captions.length).toBeGreaterThan(0)
    expect(video?.renderManifest?.contactSheetUrl).toMatch(/^\/media\//)
    // Truthful manifest: the local-fallback visuals are disclosed as generated, not authentic footage.
    expect(video?.renderManifest?.requiresSyntheticDisclosure).toBe(true)
    expect(video?.renderManifest?.compliance.join(' ')).toMatch(/not authentic footage/)
    expect(upload?.status).toBe('review_required')
    expect(upload?.idempotencyKey.length).toBeGreaterThan(20)

    const files = readdirSync(mediaDir)
    const mp4 = files.find(file => file.endsWith('.mp4'))
    expect(mp4).toBeTruthy()
    const size = statSync(join(mediaDir, mp4!)).size
    expect(size).toBeGreaterThan(8_000)

    const audit = db.listAudit(50).filter(event => event.entityType === 'topic' || event.entityType === 'script' || event.entityType === 'video' || event.entityType === 'upload')
    expect(audit.length).toBeGreaterThanOrEqual(8)
    expect(workflow.usageSummary().spentUsd).toBe(0)

    db.close()
  })

  it('returns the same upload on idempotent re-creates', async () => {
    const mediaDir = join(tempRoot, 'media2')
    mkdirSync(mediaDir, { recursive: true })
    const db = new ShortsDatabase({ filename: ':memory:' })
    const config = { ...loadConfig({}), dbPath: ':memory:', mediaDir }
    const workflow = new ShortsWorkflow(db, config)

    const firstRun = await workflow.runManual({ niche: 'Travel', topicTitle: 'Hidden cities' })
    if (!firstRun.video || !firstRun.upload) throw new Error('runManual did not return expected entities')
    const firstUpload = db.getUpload(firstRun.upload.id)
    const secondUpload = await workflow.createUpload(firstRun.video.id, {
      title: firstUpload!.title,
      scheduledAt: undefined,
      tags: firstUpload!.tags,
      description: firstUpload!.description,
    })
    expect(secondUpload.id).toBe(firstUpload!.id)
    db.close()
  })

  it('keeps a reviewed upload local until YouTube OAuth is configured', async () => {
    const mediaDir = join(tempRoot, 'media-approval')
    mkdirSync(mediaDir, { recursive: true })
    const db = new ShortsDatabase({ filename: ':memory:' })
    const config = { ...loadConfig({}), dbPath: ':memory:', mediaDir }
    const workflow = new ShortsWorkflow(db, config)
    const result = await workflow.runManual({ niche: 'Science', topicTitle: 'Why leaves change colour' })
    const approved = await workflow.approveForPublish(result.upload.id)
    expect(approved.status).toBe('approved_for_publish')
    expect(approved.scheduledAt).toBeTruthy()
    expect(approved.youtubeVideoId).toBeUndefined()
    expect(youtubeMocks.uploadToYouTube).not.toHaveBeenCalled()
    db.close()
  })

  it('schedules to YouTube at the next 18:00 Europe/London when OAuth is configured, idempotently', async () => {
    const mediaDir = join(tempRoot, 'media-youtube')
    mkdirSync(mediaDir, { recursive: true })
    const db = new ShortsDatabase({ filename: ':memory:' })
    const config = {
      ...loadConfig({}),
      dbPath: ':memory:',
      mediaDir,
      youtubeClientId: 'test-client-id',
      youtubeClientSecret: 'test-client-secret',
      youtubeRefreshToken: 'test-refresh-token',
    }
    const workflow = new ShortsWorkflow(db, config)
    const topic = await workflow.createTopic({ title: 'Why auroras are caused by solar wind', niche: 'Science' })
    const generated = await workflow.generateScript(topic.id)
    if (!generated.approved) throw new Error('local judge should approve this script')
    const video = await workflow.createVideo(generated.script.id)
    await writeFile(join(mediaDir, 'fake.mp4'), Buffer.from('fake render bytes'))
    db.updateVideo(video.id, { status: 'rendering' })
    db.updateVideo(video.id, { status: 'review_required', finalVideoUrl: '/media/fake.mp4' })
    const upload = await workflow.createUpload(video.id, { title: 'Aurora test short' })
    expect(upload.status).toBe('review_required')

    youtubeMocks.uploadToYouTube.mockResolvedValue({
      youtubeVideoId: 'vid-123',
      youtubeUrl: 'https://youtube.com/shorts/vid-123',
      status: 'scheduled',
    })
    const approved = await workflow.approveForPublish(upload.id)

    expect(youtubeMocks.uploadToYouTube).toHaveBeenCalledTimes(1)
    expect(approved.youtubeVideoId).toBe('vid-123')
    expect(approved.status).toBe('scheduled')

    // scheduledAt must be the next 18:00 Europe/London — within the next 48h, hour 18, minute 00 London time.
    const scheduledAt = approved.scheduledAt
    expect(scheduledAt).toBeTruthy()
    const scheduledMs = new Date(scheduledAt!).getTime()
    expect(scheduledMs).toBeGreaterThan(Date.now())
    expect(scheduledMs).toBeLessThan(Date.now() + 48 * 3600 * 1000)
    const london = (type: Intl.DateTimeFormatPartTypes) => new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit',
    }).formatToParts(new Date(scheduledAt!)).find(part => part.type === type)?.value
    expect(london('hour')).toBe('18')
    expect(london('minute')).toBe('00')

    // The mocked upload received the same scheduledAt and the rendered file path.
    const [, , , , passedScheduledAt] = youtubeMocks.uploadToYouTube.mock.calls[0]
    expect(passedScheduledAt).toBe(scheduledAt)

    // Retrying after a successful schedule must NOT call YouTube again (idempotent).
    const retried = await workflow.publishUpload(upload.id)
    expect(retried.youtubeVideoId).toBe('vid-123')
    expect(youtubeMocks.uploadToYouTube).toHaveBeenCalledTimes(1)

    const audit = db.listAudit(50).find(event => event.action === 'approved_for_publish' && event.entityType === 'upload' && event.entityId === upload.id)
    expect(audit).toBeTruthy()
    db.close()
  })

  it('fails fast with FOOTAGE_REQUIRED when authentic video footage is mandatory but absent', async () => {
    const mediaDir = join(tempRoot, 'media-footage-gate')
    mkdirSync(mediaDir, { recursive: true })
    const db = new ShortsDatabase({ filename: ':memory:' })
    const config = { ...loadConfig({}), dbPath: ':memory:', mediaDir, requireVideoFootage: true }
    const workflow = new ShortsWorkflow(db, config)
    const topic = await workflow.createTopic({ title: 'Deep sea vents support life without sun', niche: 'Science' })
    const generated = await workflow.generateScript(topic.id)
    if (!generated.approved) throw new Error('local judge should approve this script')
    const video = await workflow.createVideo(generated.script.id)
    await expect(workflow.produceVideo(video.id)).rejects.toMatchObject({ code: 'FOOTAGE_REQUIRED', statusCode: 422 })
    expect(db.getVideo(video.id)?.status).toBe('failed')
    const audit = db.listAudit(50).find(event => event.action === 'failed' && event.entityType === 'job' && event.entityId === video.id)
    expect(audit?.message).toMatch(/Authentic video footage/)
    db.close()
  })

  it('rejects scripts without factual sources when REQUIRE_RESEARCH is enabled', async () => {
    const db = new ShortsDatabase({ filename: ':memory:' })
    const config = { ...loadConfig({}), dbPath: ':memory:', mediaDir: join(tempRoot, 'media-research-gate'), requireResearch: true }
    const workflow = new ShortsWorkflow(db, config)
    const topic = await workflow.createTopic({ title: 'Why auroras are caused by solar wind', niche: 'Science' })
    const generated = await workflow.generateScript(topic.id)
    expect(generated.approved).toBe(false)
    expect(generated.attempts).toBe(3)
    const script = db.getScript(generated.script.id)
    expect(script?.status).toBe('draft')
    expect(script?.judgeVerdict).toBe('rejected')
    expect(script?.factualSources ?? []).toHaveLength(0)
    db.close()
  })

  it('round-trips factual sources through the database', async () => {
    const db = new ShortsDatabase({ filename: ':memory:' })
    const topic = await db.createTopic({ id: 'src-topic', title: 'Jellyfish ageing research', niche: 'Science', source: 'manual', status: 'new', metrics: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    const now = new Date().toISOString()
    const created = db.createScript({ id: 'src-script', topicId: topic.id, text: 'Some script text that is long enough to be valid.', durationSec: 30, hook: 'A hook', cta: 'Follow', titleSuggestion: 'Title', descriptionSuggestion: 'Desc', tagsSuggestion: ['science'], factualSources: ['https://pubmed.ncbi.nlm.nih.gov/31619459/'], status: 'approved', judgeScore: 9.2, judgeVerdict: 'approved', judgeFeedback: 'ok', judgeCriteria: { hookScore: 2.3, retentionScore: 2.3, viralityScore: 2.3, pacingScore: 2.3 }, createdAt: now, updatedAt: now })
    expect(created.factualSources).toEqual(['https://pubmed.ncbi.nlm.nih.gov/31619459/'])
    expect(db.getScript('src-script')?.factualSources).toEqual(['https://pubmed.ncbi.nlm.nih.gov/31619459/'])
    expect(db.getScript('src-script')?.judgeVerdict).toBe('approved')
    db.close()
  })
})

describe('workflow.runScheduled', () => {
  it('skips when the run for the day has already completed', async () => {
    const db = new ShortsDatabase({ filename: ':memory:' })
    const config = { ...loadConfig({}), dbPath: ':memory:', mediaDir: join(tempRoot, 'media3'), automationPaused: false }
    const workflow = new ShortsWorkflow(db, config)
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
    const year = parts.find(p => p.type === 'year')?.value
    const month = parts.find(p => p.type === 'month')?.value
    const day = parts.find(p => p.type === 'day')?.value
    db.setSetting(`scheduled:${year}-${month}-${day}`, 'complete')
    const result = await workflow.runScheduled()
    if (!('skipped' in result)) throw new Error('runScheduled should report a skipped result')
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('already_completed')
    db.close()
  })

  it('honors the automation_paused setting', async () => {
    const db = new ShortsDatabase({ filename: ':memory:' })
    const config = { ...loadConfig({}), dbPath: ':memory:', mediaDir: join(tempRoot, 'media4'), automationPaused: false }
    const workflow = new ShortsWorkflow(db, config)
    db.setSetting('automation_paused', 'true')
    const result = await workflow.runScheduled()
    if (!('skipped' in result)) throw new Error('runScheduled should report a skipped result')
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('automation_paused')
    db.close()
  })
})
