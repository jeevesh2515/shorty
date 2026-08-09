import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ShortsDatabase, stableIdempotencyKey } from '../server/db.js'
import { DomainError, areTopicsSimilar } from '../server/domain.js'

let db: ShortsDatabase

afterEach(() => db?.close())

describe('ShortsDatabase', () => {
  it('persists the complete relational chain and audit events', () => {
    db = new ShortsDatabase({ filename: ':memory:' })
    const now = new Date().toISOString()
    const topicId = randomUUID()
    db.createTopic({ id: topicId, title: 'Test topic', niche: 'Science', source: 'manual', status: 'new', metrics: {}, createdAt: now, updatedAt: now })
    const scriptId = randomUUID()
    db.createScript({ id: scriptId, topicId, text: 'A short script with a useful payoff.', durationSec: 20, hook: 'Here is the hook.', tagsSuggestion: ['science'], status: 'draft', createdAt: now, updatedAt: now })
    const videoId = randomUUID()
    db.createVideo({ id: videoId, scriptId, visualAssets: [{ path: 'local-gradient', type: 'illustration', source: 'test' }], status: 'pending', createdAt: now, updatedAt: now })
    const key = stableIdempotencyKey([videoId, 'Title', 'now'])
    const upload = db.createUpload({ id: randomUUID(), videoId, title: 'Title', tags: ['science'], status: 'pending', idempotencyKey: key, createdAt: now, updatedAt: now })
    const duplicate = db.createUpload({ ...upload, id: randomUUID() })
    expect(duplicate.id).toBe(upload.id)
    expect(db.getTopic(topicId)?.title).toBe('Test topic')
    expect(db.getScript(scriptId)?.topicId).toBe(topicId)
    expect(db.getVideo(videoId)?.scriptId).toBe(scriptId)
    expect(db.getUpload(upload.id)?.videoId).toBe(videoId)
    expect(db.listAudit().length).toBeGreaterThanOrEqual(4)
  })

  it('rejects invalid status transitions', () => {
    db = new ShortsDatabase({ filename: ':memory:' })
    const now = new Date().toISOString()
    const topic = db.createTopic({ id: randomUUID(), title: 'Test', niche: 'Science', source: 'manual', status: 'new', metrics: {}, createdAt: now, updatedAt: now })
    expect(() => db.updateTopicStatus(topic.id, 'scripted')).toThrowError(DomainError)
    expect(db.updateTopicStatus(topic.id, 'selected')?.status).toBe('selected')
    expect(db.updateTopicStatus(topic.id, 'rejected')?.status).toBe('rejected')
  })

  it('detects similar topics and cleans up redundant duplicates', () => {
    expect(areTopicsSimilar('The Amazing Octopus Intelligence', 'The Amazing Octopus Intelligence #2')).toBe(true)
    expect(areTopicsSimilar('This Jellyfish Can Rewind Its Life 🪼', 'The Immortal Jellyfish')).toBe(true)
    expect(areTopicsSimilar('Why Some Animals Never Age', 'The creature that reverses its own age')).toBe(true)
    expect(areTopicsSimilar('How to make a Short with a zero-dollar toolchain', 'The Amazing Octopus Intelligence')).toBe(false)

    db = new ShortsDatabase({ filename: ':memory:' })
    const now = new Date().toISOString()
    const t1 = db.createTopic({ id: randomUUID(), title: 'The Immortal Jellyfish', niche: 'Science', source: 'manual', status: 'new', metrics: {}, createdAt: now, updatedAt: now })
    const t2 = db.createTopic({ id: randomUUID(), title: 'This Jellyfish Can Rewind Its Life 🪼', niche: 'Science', source: 'manual', status: 'new', metrics: {}, createdAt: now, updatedAt: now })

    const result = db.cleanupUnscriptedTopics()
    expect(result.cleanedCount).toBe(2)
    expect(db.listTopics().length).toBe(0)
  })
})
