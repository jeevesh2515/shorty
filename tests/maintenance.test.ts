import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupRenderIntermediates } from '../server/providers.js'
import { pickNiche } from '../server/workflow.js'

describe('pickNiche', () => {
  it('returns the single niche when no list is given', () => {
    expect(pickNiche('Science')).toBe('Science')
    expect(pickNiche('  Science  ')).toBe('Science')
  })

  it('falls back when the value is empty', () => {
    expect(pickNiche('')).toBe('Productivity')
    expect(pickNiche('   ,  ,')).toBe('Productivity')
  })

  it('rotates through a comma-separated list by day', () => {
    const spec = 'Science,Space,Psychology'
    const day1 = pickNiche(spec, new Date('2026-08-09T09:00:00Z'))
    const day2 = pickNiche(spec, new Date('2026-08-10T09:00:00Z'))
    const day3 = pickNiche(spec, new Date('2026-08-11T09:00:00Z'))
    const day4 = pickNiche(spec, new Date('2026-08-12T09:00:00Z'))
    expect(new Set([day1, day2, day3]).size).toBe(3)
    // Publishing the same niche in the same format daily is the pattern YouTube's
    // inauthentic-content policy targets, so rotation must actually advance.
    expect(day4).toBe(day1)
  })

  it('is stable across times within the same day', () => {
    const spec = 'Science,Space,Psychology'
    expect(pickNiche(spec, new Date('2026-08-09T00:30:00Z')))
      .toBe(pickNiche(spec, new Date('2026-08-09T23:30:00Z')))
  })
})

describe('cleanupRenderIntermediates', () => {
  const created: string[] = []
  const makeMediaDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'shorts-media-'))
    created.push(dir)
    return dir
  }

  afterEach(() => { delete process.env.KEEP_RENDER_INTERMEDIATES })

  const seed = (dir: string, id: string) => {
    const files = [
      // disposable scaffolding
      `${id}-scene-0.mp4`, `${id}-scene-1.mp4`, `${id}-scenes.txt`,
      `${id}-stitched.mp4`, `${id}-captions.txt`, `${id}-captions.mov`,
      `${id}-caption-0.png`, `${id}-caption-1.png`,
      // deliverables and reusable inputs
      `${id}.mp4`, `${id}-poster.jpg`, `${id}-contact.jpg`,
      `${id}-captions.srt`, `${id}-captions.ass`,
      'voice-123.mp3', 'voice-123.words.json',
    ]
    for (const name of files) writeFileSync(join(dir, name), 'x'.repeat(64))
    return files
  }

  it('removes scaffolding and keeps everything that is served or reused', () => {
    const dir = makeMediaDir()
    seed(dir, 'vid1')
    const result = cleanupRenderIntermediates(dir, 'vid1')

    expect(result.removed).toBe(8)
    const left = readdirSync(dir).sort()
    expect(left).toEqual([
      'vid1-captions.ass',
      'vid1-captions.srt',
      'vid1-contact.jpg',
      'vid1-poster.jpg',
      'vid1.mp4',
      'voice-123.mp3',
      'voice-123.words.json',
    ])
  })

  it("never touches another video's files", () => {
    const dir = makeMediaDir()
    seed(dir, 'vid1')
    seed(dir, 'vid2')
    cleanupRenderIntermediates(dir, 'vid1')
    const left = readdirSync(dir)
    // 12 hyphen-prefixed files per seeded video (vid2.mp4 has no hyphen, and the two
    // voice-* files are shared between both seeds).
    expect(left.filter(name => name.startsWith('vid2-')).length).toBe(12)
    expect(left).toContain('vid2-stitched.mp4')
    expect(left).toContain('vid2.mp4')
  })

  it('retains intermediates when KEEP_RENDER_INTERMEDIATES is set', () => {
    const dir = makeMediaDir()
    const files = seed(dir, 'vid1')
    process.env.KEEP_RENDER_INTERMEDIATES = 'true'
    const result = cleanupRenderIntermediates(dir, 'vid1')
    expect(result.removed).toBe(0)
    expect(readdirSync(dir).length).toBe(files.length)
  })

  it('does not throw on a missing directory', () => {
    expect(() => cleanupRenderIntermediates('/nonexistent/path/xyz', 'vid1')).not.toThrow()
  })
})
