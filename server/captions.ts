/**
 * Caption timing and ASS subtitle generation.
 *
 * Replaces two things that were hurting output quality:
 *
 *  1. **Timing.** Cues used to be spread linearly across the word count
 *     (`duration * index / words.length`), which assumes every word takes the same time.
 *     Real speech does not work that way — measured against edge-tts word boundaries, a
 *     9.6s clip drifted by up to 0.885s, and the error compounds over a 40s Short.
 *     We now drive cues from the actual per-word boundaries the TTS engine reports.
 *
 *  2. **Rendering.** Captions used to be drawn with a hand-rolled bitmap font into
 *     manually-encoded PNGs, one full 1080x1920 frame per cue, concatenated into a
 *     **qtrle ARGB** video and overlaid. That is a near-lossless full-frame alpha track —
 *     hundreds of MB for a 30s clip, and the likely cause of the repeated ffmpeg
 *     out-of-memory fixes in this repo's history. ASS via libass is a single filter pass
 *     over a ~10KB text file, with real font rendering.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import type { CaptionCue, WordTiming } from './domain.js'

const execFileAsync = promisify(execFile)

/** A pause longer than this ends a caption group — it marks a natural phrase break. */
const PHRASE_BREAK_SEC = 0.35
/** Words shown at once. Three is the sweet spot for vertical video legibility. */
const WORDS_PER_CUE = 3
/** Never leave the screen blank for longer than this between cues. */
const MAX_CUE_HOLD_SEC = 1.0

export type CaptionStyle = {
  fontName: string
  fontSize: number
  /** Inactive word colour, RGB hex e.g. 'FFFFFF'. */
  baseColor: string
  /** Currently-spoken word colour. */
  accentColor: string
  outline: number
  marginV: number
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontName: 'Anton',
  fontSize: 110,
  baseColor: 'FFFFFF',
  accentColor: 'FFE02B',
  outline: 7,
  // 1920-tall canvas; ~300px clears YouTube's Shorts UI chrome at the bottom.
  marginV: 300,
}

/**
 * Group word timings into caption cues.
 *
 * Groups break on either a word count limit or a natural pause, so cues follow the
 * cadence of the narration rather than an arbitrary grid.
 */
export function buildCuesFromWordTimings(
  words: WordTiming[],
  totalDuration: number,
  wordsPerCue = WORDS_PER_CUE,
): CaptionCue[] {
  const usable = words.filter(word => word.text && word.text.trim().length > 0)
  if (!usable.length) return []

  const groups: WordTiming[][] = []
  let current: WordTiming[] = []

  for (const [index, word] of usable.entries()) {
    const previous = usable[index - 1]
    const gap = previous ? word.start - previous.end : 0
    const shouldBreak = current.length >= wordsPerCue || (previous && gap > PHRASE_BREAK_SEC)
    if (shouldBreak && current.length) {
      groups.push(current)
      current = []
    }
    current.push(word)
  }
  if (current.length) groups.push(current)

  return groups.map((group, index) => {
    const next = groups[index + 1]
    const lastEnd = group[group.length - 1].end
    // Hold the cue until the next one begins so there is no blank flicker during a pause,
    // but do not let it linger through a long silence.
    const holdUntil = next ? Math.min(next[0].start, lastEnd + MAX_CUE_HOLD_SEC) : lastEnd + 0.4
    return {
      startSec: Number(group[0].start.toFixed(3)),
      endSec: Number(Math.min(holdUntil, totalDuration).toFixed(3)),
      text: group.map(word => word.text).join(' ').toUpperCase(),
      words: group.map(word => ({
        text: word.text.toUpperCase(),
        start: Number(word.start.toFixed(3)),
        end: Number(word.end.toFixed(3)),
      })),
    }
  })
}

/**
 * Legacy fallback: even distribution across the clip.
 * Only used when the TTS provider returned no word boundaries.
 */
export function buildCuesFromEstimate(text: string, duration: number, wordsPerCue = WORDS_PER_CUE): CaptionCue[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const cues: CaptionCue[] = []
  for (let index = 0; index < words.length; index += wordsPerCue) {
    cues.push({
      startSec: Number((duration * index / words.length).toFixed(2)),
      endSec: Number((duration * Math.min(index + wordsPerCue, words.length) / words.length).toFixed(2)),
      text: words.slice(index, index + wordsPerCue).join(' ').toUpperCase(),
    })
  }
  return cues
}

/** ASS stores colours as &HBBGGRR (byte-reversed from HTML hex). */
function assColor(rgbHex: string): string {
  const clean = rgbHex.replace(/^#/, '').padStart(6, '0')
  const r = clean.slice(0, 2)
  const g = clean.slice(2, 4)
  const b = clean.slice(4, 6)
  return `&H${b}${g}${r}&`.toUpperCase()
}

/**
 * Style-field colours carry an alpha byte and, unlike inline `\c` overrides, take no
 * trailing ampersand: &HAABBGGRR (alpha 00 = fully opaque).
 */
function assStyleColor(rgbHex: string, alphaHex = '00'): string {
  return assColor(rgbHex).replace('&H', `&H${alphaHex}`).replace(/&$/, '')
}

/** ASS timestamps are H:MM:SS.cc — one hour digit, centisecond precision. */
function assTime(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  const secs = Math.floor(clamped % 60)
  const centis = Math.round((clamped - Math.floor(clamped)) * 100)
  // Rounding can tip centiseconds to 100; normalise rather than emit ".100".
  const carry = centis === 100
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(carry ? secs + 1 : secs).padStart(2, '0')}.${String(carry ? 0 : centis).padStart(2, '0')}`
}

/**
 * Neutralise ASS control syntax in caption text.
 *
 * Braces open override blocks. Stripping only the braces is not enough — the block's
 * contents would survive as literal on-screen text (a script containing `{\fscx500}`
 * would render the words "fscx500"). Drop whole blocks, then any unbalanced brace, then
 * stray backslashes, which can form overrides on their own.
 */
function escapeAssText(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Build a complete ASS subtitle file with per-word highlighting.
 *
 * Each *word* gets its own Dialogue line showing the whole cue, with the active word
 * recoloured and slightly enlarged. libass handles thousands of lines without trouble, and
 * the highlight lands exactly on the spoken word rather than an interpolated guess.
 */
export function buildAssSubtitles(
  cues: CaptionCue[],
  style: Partial<CaptionStyle> = {},
  playResX = 1080,
  playResY = 1920,
): string {
  const s: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, ...style }

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,'
      + ' Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline,'
      + ' Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    [
      'Style: Caption',
      s.fontName,
      String(s.fontSize),
      assStyleColor(s.baseColor),
      assStyleColor(s.accentColor),
      assStyleColor('000000'),
      assStyleColor('000000', 'A0'),
      '0', '0', '0', '0',          // Bold/Italic/Underline/StrikeOut (Anton is already heavy)
      '100', '100',                // ScaleX / ScaleY
      '2', '0',                    // Spacing / Angle
      '1',                         // BorderStyle: outline + shadow
      String(s.outline), '3',      // Outline / Shadow
      '2',                         // Alignment: bottom-centre
      '90', '90', String(s.marginV),
      '1',
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const base = assColor(s.baseColor)
  const accent = assColor(s.accentColor)
  const events: string[] = []

  for (const cue of cues) {
    const words = cue.words?.length
      ? cue.words
      : // No per-word data: show the cue as one static line.
        [{ text: cue.text, start: cue.startSec, end: cue.endSec }]

    for (const [index, word] of words.entries()) {
      const isLast = index === words.length - 1
      const start = Math.max(word.start, cue.startSec)
      // Hold each highlight until the next word begins, so there is never a gap where
      // nothing is emphasised.
      const end = isLast ? cue.endSec : Math.max(words[index + 1].start, start + 0.05)
      if (end <= start) continue

      const rendered = words
        .map((entry, position) =>
          position === index
            // Active word: accent colour, nudged larger for a subtle pop.
            ? `{\\c${accent}\\fscx106\\fscy106}${escapeAssText(entry.text)}{\\c${base}\\fscx100\\fscy100}`
            : escapeAssText(entry.text),
        )
        .join(' ')

      events.push(
        `Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,{\\c${base}}${rendered}`,
      )
    }
  }

  return `${header.join('\n')}\n${events.join('\n')}\n`
}

/**
 * Probe whether this ffmpeg build exposes the libass `ass` filter.
 *
 * Debian's ffmpeg ships with libass, but the render must not hard-fail on a build that
 * does not — the caller falls back to the legacy PNG overlay path.
 */
let assSupportCache: boolean | undefined
export async function hasAssFilter(): Promise<boolean> {
  if (assSupportCache !== undefined) return assSupportCache
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-hide_banner', '-filters'], { maxBuffer: 8 * 1024 * 1024 })
    assSupportCache = /^\s*\S*\s+ass\s+/m.test(stdout)
  } catch {
    assSupportCache = false
  }
  return assSupportCache
}

/**
 * fontconfig needs a directory to search for the bundled display face.
 *
 * Resolved relative to the compiled module, so it works from both `dist-server/` in the
 * container and `server/` in local dev.
 */
export function bundledFontsDir(): string | undefined {
  const candidates = [
    new URL('../assets/fonts', import.meta.url).pathname,
    new URL('../../assets/fonts', import.meta.url).pathname,
  ]
  return candidates.find(path => existsSync(path))
}

/**
 * Pick the caption typeface at runtime.
 *
 * Anton is fetched during the Docker build rather than committed, so it may legitimately
 * be absent (offline build, CDN blip). Naming a font that fontconfig cannot resolve makes
 * libass silently substitute something arbitrary — usually a serif, which looks wrong on a
 * Short. Checking the file means the ASS we emit always names a face that actually exists.
 *
 * DejaVu Sans Bold is installed via apt in the Dockerfile, so the fallback is guaranteed.
 */
export function resolveCaptionFont(): { fontName: string; fontsDir?: string } {
  const fontsDir = bundledFontsDir()
  if (fontsDir && existsSync(`${fontsDir}/Anton-Regular.ttf`)) {
    return { fontName: 'Anton', fontsDir }
  }
  return { fontName: 'DejaVu Sans', fontsDir }
}

/** Escape a filesystem path for use inside an ffmpeg filtergraph argument. */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}
