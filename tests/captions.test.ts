import { describe, expect, it } from 'vitest'
import {
  buildAssSubtitles,
  buildCuesFromEstimate,
  buildCuesFromWordTimings,
  escapeFilterPath,
} from '../server/captions.js'
import type { WordTiming } from '../server/domain.js'

/** Real edge-tts output for "Octopuses have three hearts. Two pump blood to the gills." */
const REAL_TIMINGS: WordTiming[] = [
  { text: 'Octopuses', start: 0.138, end: 0.875 },
  { text: 'have', start: 0.887, end: 1.125 },
  { text: 'three', start: 1.137, end: 1.413 },
  { text: 'hearts', start: 1.425, end: 2.062 },
  // 0.363s sentence pause here -- a natural phrase break
  { text: 'Two', start: 2.425, end: 2.688 },
  { text: 'pump', start: 2.700, end: 3.025 },
  { text: 'blood', start: 3.038, end: 3.350 },
  { text: 'to', start: 3.362, end: 3.462 },
  { text: 'the', start: 3.475, end: 3.575 },
  { text: 'gills', start: 3.587, end: 4.100 },
]

describe('buildCuesFromWordTimings', () => {
  it('groups words and carries per-word timings for karaoke highlighting', () => {
    const cues = buildCuesFromWordTimings(REAL_TIMINGS, 4.5)
    expect(cues.length).toBeGreaterThan(0)
    expect(cues[0].text).toBe('OCTOPUSES HAVE THREE')
    expect(cues[0].words).toHaveLength(3)
    expect(cues[0].words?.[0]).toMatchObject({ text: 'OCTOPUSES', start: 0.138 })
  })

  it('breaks a cue on a real speech pause rather than mid-phrase', () => {
    const cues = buildCuesFromWordTimings(REAL_TIMINGS, 4.5)
    // "hearts" ends a sentence and is followed by a 0.363s gap, so it must not be
    // grouped with the words that follow it.
    const heartsCue = cues.find(cue => cue.text.includes('HEARTS'))
    expect(heartsCue?.text).toBe('HEARTS')
    const nextCue = cues.find(cue => cue.text.startsWith('TWO'))
    expect(nextCue?.text).toBe('TWO PUMP BLOOD')
  })

  it('produces a monotonic timeline that never exceeds the clip duration', () => {
    const duration = 4.5
    const cues = buildCuesFromWordTimings(REAL_TIMINGS, duration)
    let previousStart = -1
    for (const cue of cues) {
      expect(cue.startSec).toBeGreaterThanOrEqual(previousStart)
      expect(cue.endSec).toBeGreaterThan(cue.startSec)
      expect(cue.endSec).toBeLessThanOrEqual(duration)
      previousStart = cue.startSec
    }
  })

  it('holds a cue on screen until the next begins, so there is no blank flicker', () => {
    const cues = buildCuesFromWordTimings(REAL_TIMINGS, 4.5)
    const heartsCue = cues.find(cue => cue.text === 'HEARTS')
    // "hearts" stops at 2.062 but the next cue starts at 2.425 -- the caption should
    // bridge that pause instead of disappearing.
    expect(heartsCue?.endSec).toBeCloseTo(2.425, 2)
  })

  it('returns nothing when there are no usable words', () => {
    expect(buildCuesFromWordTimings([], 10)).toEqual([])
    expect(buildCuesFromWordTimings([{ text: '  ', start: 0, end: 1 }], 10)).toEqual([])
  })
})

describe('buildCuesFromEstimate (legacy fallback)', () => {
  it('spreads words evenly when no real timings exist', () => {
    const cues = buildCuesFromEstimate('one two three four five six', 6)
    expect(cues).toHaveLength(2)
    expect(cues[0]).toMatchObject({ startSec: 0, text: 'ONE TWO THREE' })
    expect(cues[1].endSec).toBeCloseTo(6, 5)
  })

  it('carries no per-word data, since none of it is real', () => {
    const cues = buildCuesFromEstimate('alpha beta gamma', 3)
    expect(cues[0].words).toBeUndefined()
  })
})

describe('buildAssSubtitles', () => {
  const cues = buildCuesFromWordTimings(REAL_TIMINGS, 4.5)
  const ass = buildAssSubtitles(cues)

  it('emits a valid 1080x1920 ASS header', () => {
    expect(ass).toContain('[Script Info]')
    expect(ass).toContain('ScriptType: v4.00+')
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('PlayResY: 1920')
    expect(ass).toContain('[V4+ Styles]')
    expect(ass).toContain('[Events]')
  })

  it('converts RGB to ASS byte-reversed BGR', () => {
    // Accent FFE02B -> &H2BE0FF. Getting this backwards silently swaps red and blue.
    expect(ass).toContain('&H2BE0FF')
    // Style colours take an alpha byte and no trailing ampersand.
    expect(ass).toMatch(/Style: Caption,Anton,\d+,&H00FFFFFF,/)
  })

  it('emits one dialogue line per word so the highlight tracks the voice', () => {
    const dialogueLines = ass.split('\n').filter(line => line.startsWith('Dialogue:'))
    expect(dialogueLines).toHaveLength(REAL_TIMINGS.length)
  })

  it('highlights exactly one word per line, keeping the rest of the cue visible', () => {
    const firstLine = ass.split('\n').find(line => line.startsWith('Dialogue:')) as string
    expect(firstLine).toContain('OCTOPUSES')
    expect(firstLine).toContain('HAVE THREE')
    // Exactly one accent-colour switch => exactly one active word.
    expect(firstLine.match(/&H2BE0FF/g)).toHaveLength(1)
  })

  it('formats timestamps as H:MM:SS.cc', () => {
    expect(ass).toMatch(/Dialogue: 0,\d:\d{2}:\d{2}\.\d{2},\d:\d{2}:\d{2}\.\d{2},Caption/)
  })

  it('strips braces that would otherwise open an ASS override block', () => {
    const injected = buildAssSubtitles([
      { startSec: 0, endSec: 1, text: 'HELLO {\\fscx500}WORLD' },
    ])
    const dialogue = injected.split('\n').find(line => line.startsWith('Dialogue:')) as string
    expect(dialogue).not.toContain('fscx500')
  })

  it('renders a static line for cues that have no per-word data', () => {
    const staticAss = buildAssSubtitles([{ startSec: 0, endSec: 2, text: 'NO WORD DATA' }])
    const lines = staticAss.split('\n').filter(line => line.startsWith('Dialogue:'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('NO WORD DATA')
  })
})

describe('escapeFilterPath', () => {
  it('escapes colons so a path cannot break the ffmpeg filtergraph', () => {
    expect(escapeFilterPath('/app/data/media/a.ass')).toBe('/app/data/media/a.ass')
    expect(escapeFilterPath('C:/tmp/a.ass')).toBe('C\\:/tmp/a.ass')
  })
})
