import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { rmSync } from 'node:fs'
import { loadConfig } from '../server/config.js'
import { ShortsDatabase } from '../server/db.js'
import { ShortsWorkflow } from '../server/workflow.js'

const tempRoot = resolve(process.cwd(), 'data/workflow-test')

afterEach(() => {
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
    expect(video?.status).toBe('ready')
    expect(video?.finalVideoUrl).toMatch(/^\/media\//)
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
})

describe('workflow.runScheduled', () => {
  it('skips when the run for the day has already completed', async () => {
    const db = new ShortsDatabase({ filename: ':memory:' })
    const config = { ...loadConfig({}), dbPath: ':memory:', mediaDir: join(tempRoot, 'media3'), automationPaused: false }
    const workflow = new ShortsWorkflow(db, config)
    db.setSetting(`scheduled:${new Date().toISOString().slice(0, 10)}`, 'complete')
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
