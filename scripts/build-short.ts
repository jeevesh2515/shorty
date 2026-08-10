/**
 * build-short.ts — assemble a finished YouTube Short from generated clips.
 *
 * Takes a JSON config plus a folder of video clips (Higgsfield, Veo, stock — the source
 * does not matter) and produces an upload-ready MP4 with word-accurate karaoke captions,
 * beat-aligned cuts, ducked music, a burned watermark and broadcast loudness.
 *
 * This is the deterministic half of the pipeline. Generation is a commodity; the assembly
 * below is what actually makes a Short feel finished, and it runs free on any machine with
 * ffmpeg.
 *
 *   npx tsx scripts/build-short.ts scripts/shorts/example.json
 *
 * Requires: ffmpeg with libass, and a reachable Speaches TTS service (SPEACHES_API_URL)
 * for per-word timings.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { buildAssSubtitles, buildCuesFromWordTimings, resolveCaptionFont } from '../server/captions.js'
import type { WordTiming } from '../server/domain.js'

const exec = promisify(execFile)
const ff = (args: string[]) => exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 64 * 1024 * 1024 })
const probe = async (path: string, entries: string) => {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', path])
  return stdout.trim()
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type SceneConfig = {
  /** Clip path, relative to the config file. */
  clip: string
  /**
   * The last spoken word of this scene's narration beat. Cuts land on meaning rather
   * than on a fixed grid, which is what makes the edit feel deliberate.
   */
  endToken?: string
  /** Which occurrence of endToken, when the word repeats. 1-indexed. */
  occurrence?: number
  /** Hold the cut this many seconds past the token — a J-cut into the next line. */
  hold?: number
  /** Play the clip backwards. A reversed push-in becomes a pull-back. */
  reverse?: boolean
  /**
   * Take the clip's tail rather than its head. Combined with `reverse` on a copy of
   * scene 1, the final frame lands on the opening frame and the Short loops seamlessly.
   */
  useTail?: boolean
}

type ShortConfig = {
  id: string
  script: string
  voice?: string
  rate?: string
  /** Silent lead-in so the opening shot breathes before the first line. */
  preroll?: number
  /** Hold after the final word. */
  tail?: number
  scenes: SceneConfig[]
  music?: { file: string; start?: number; volume?: number }
  watermark?: { file: string; opacity?: number; x?: number; y?: number; size?: number }
  caption?: { font?: string; size?: number; accent?: string; base?: string; marginV?: number; outline?: number }
  /** Documentary-style label over the opening shot. */
  locator?: { title: string; sub?: string; from?: number; to?: number }
  output?: string
}

// ---------------------------------------------------------------------------
// Speech + timings
// ---------------------------------------------------------------------------

async function synthesize(cfg: ShortConfig, outDir: string) {
  const base = (process.env.SPEACHES_API_URL || '').replace(/\/$/, '')
  if (!base) throw new Error('SPEACHES_API_URL is not set — needed for per-word caption timings')

  const response = await fetch(`${base}/v1/audio/speech/timed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: cfg.script,
      voice: cfg.voice || 'en-GB-RyanNeural',
      rate: cfg.rate || '+0%',
      response_format: 'mp3',
    }),
  })
  if (!response.ok) throw new Error(`TTS failed (${response.status}). Is the Speaches service on v0.3.0+?`)

  const data = await response.json() as { audio_base64?: string; words?: WordTiming[] }
  if (!data.audio_base64) throw new Error('TTS returned no audio')
  if (!data.words?.length) {
    // edge-tts >=7 defaults to SentenceBoundary and emits no word events at all. Without
    // them captions silently fall back to a linear guess, so fail loudly instead.
    throw new Error('TTS returned no word timings — Speaches must pass boundary="WordBoundary"')
  }

  const voicePath = join(outDir, 'voice.mp3')
  writeFileSync(voicePath, Buffer.from(data.audio_base64, 'base64'))
  return { voicePath, words: data.words }
}

/** Locate the end time of a scene's closing word. */
function tokenEnd(words: WordTiming[], token: string, occurrence = 1): number {
  const norm = (s: string) => s.toLowerCase().replace(/[.,:;!?"']/g, '')
  let seen = 0
  for (const word of words) {
    if (norm(word.text) === norm(token)) {
      seen += 1
      if (seen === occurrence) return word.end
    }
  }
  throw new Error(`endToken "${token}"#${occurrence} not found in narration`)
}

// ---------------------------------------------------------------------------
// Edit plan
// ---------------------------------------------------------------------------

type PlannedScene = SceneConfig & { index: number; start: number; end: number; duration: number; factor: number; clipDuration: number }

async function planEdit(cfg: ShortConfig, words: WordTiming[], configDir: string): Promise<PlannedScene[]> {
  const preroll = cfg.preroll ?? 0.6
  const tail = cfg.tail ?? 0.55
  const total = Number((words[words.length - 1].end + preroll + tail).toFixed(3))

  const bounds = [0]
  for (const scene of cfg.scenes.slice(0, -1)) {
    if (!scene.endToken) throw new Error('every scene except the last needs an endToken')
    bounds.push(Number((tokenEnd(words, scene.endToken, scene.occurrence) + preroll + (scene.hold ?? 0)).toFixed(3)))
  }
  bounds.push(total)

  const planned: PlannedScene[] = []
  for (const [index, scene] of cfg.scenes.entries()) {
    const clipPath = resolve(configDir, scene.clip)
    if (!existsSync(clipPath)) throw new Error(`clip not found: ${clipPath}`)
    const clipDuration = Number(await probe(clipPath, 'format=duration'))
    const duration = Number((bounds[index + 1] - bounds[index]).toFixed(3))
    // Only stretch when the beat outruns the clip. Slowing a fast-motion shot to fill a
    // long beat undercuts whatever the narration is claiming about speed.
    const factor = duration > clipDuration ? Number((duration / clipDuration).toFixed(4)) : 1
    planned.push({ ...scene, index, start: bounds[index], end: bounds[index + 1], duration, factor, clipDuration })
  }
  return planned
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const NORMALISE = 'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920'

async function renderScenes(scenes: PlannedScene[], configDir: string, workDir: string) {
  const outputs: string[] = []
  for (const scene of scenes) {
    const src = resolve(configDir, scene.clip)
    const out = join(workDir, `scene-${scene.index + 1}.mp4`)
    let input = src

    if (scene.reverse) {
      input = join(workDir, `rev-${scene.index + 1}.mp4`)
      await ff(['-y', '-i', src, '-an', '-vf', 'reverse', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', input])
    }

    // Upscaled sources (Higgsfield returns 716x1284) get a touch of sharpening back.
    const width = Number((await probe(src, 'stream=width')).split('\n')[0])
    const filters = [
      scene.factor !== 1 ? `setpts=${scene.factor}*PTS` : '',
      NORMALISE,
      width < 1080 ? 'unsharp=5:5:0.5:5:5:0.0' : '',
      'fps=30',
    ].filter(Boolean).join(',')

    const seek: string[] = []
    if (scene.useTail) {
      const dur = Number(await probe(input, 'format=duration'))
      seek.push('-ss', String(Math.max(0, dur - scene.duration).toFixed(4)))
    }

    await ff([
      '-y', ...seek, '-i', input, '-an', '-vf', filters, '-t', String(scene.duration),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', out,
    ])
    outputs.push(out)
    console.log(`  scene ${scene.index + 1}: ${scene.duration.toFixed(2)}s ${scene.factor !== 1 ? `(slow x${scene.factor})` : '(native)'}${scene.reverse ? ' reversed' : ''}`)
  }

  const listFile = join(workDir, 'scenes.txt')
  writeFileSync(listFile, outputs.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
  const stitched = join(workDir, 'stitched.mp4')
  await ff(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', stitched])
  return stitched
}

function buildCaptions(cfg: ShortConfig, words: WordTiming[], total: number, workDir: string) {
  const preroll = cfg.preroll ?? 0.6
  const shifted = words.map(w => ({ ...w, start: w.start + preroll, end: w.end + preroll }))
  const { fontName } = resolveCaptionFont()
  const style = cfg.caption || {}

  let ass = buildAssSubtitles(buildCuesFromWordTimings(shifted, total), {
    fontName: style.font || fontName,
    fontSize: style.size ?? 100,
    baseColor: style.base || 'FFFFFF',
    accentColor: style.accent || '5CE1FF',
    outline: style.outline ?? 8,
    marginV: style.marginV ?? 360,
  })

  if (cfg.locator) {
    const { title, sub, from = 0.9, to = 6.4 } = cfg.locator
    const t = (s: number) => {
      const cs = Math.round((s % 1) * 100)
      return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
    }
    const styles = [
      `Style: Locator,${style.font || fontName},74,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,6,0,1,6,3,5,0,0,0,1`,
      `Style: Locsub,${style.font || fontName},40,&H00FFE15C,&H00FFE15C,&H00000000,&H00000000,0,0,0,0,100,100,10,0,1,5,2,5,0,0,0,1`,
    ].join('\n')
    ass = ass.replace('[Events]', `${styles}\n\n[Events]`).trimEnd()
    ass += `\nDialogue: 0,${t(from)},${t(to)},Locator,,0,0,0,,{\\pos(540,300)\\fad(500,700)}${title}`
    if (sub) ass += `\nDialogue: 0,${t(from)},${t(to)},Locsub,,0,0,0,,{\\pos(540,372)\\fad(500,700)}${sub}`
    ass += '\n'
  }

  const path = join(workDir, 'captions.ass')
  writeFileSync(path, ass)
  return path
}

/**
 * A plain white mark disappears against bright footage, so give it a soft dark halo.
 */
async function shadowWatermark(src: string, workDir: string, size: number) {
  const out = join(workDir, 'watermark-shadowed.png')
  const pad = Math.round(size * 1.13)
  await ff([
    '-y', '-i', src, '-filter_complex',
    `[0]scale=${pad}:${pad},format=rgba,split[s][w];`
    + `[s]alphaextract,boxblur=5:2,format=gray,curves=all='0/0 0.15/0.75 1/1'[al];`
    + `color=c=black:s=${pad}x${pad},format=rgba[blk];[blk][al]alphamerge[shadow];`
    + `[w]scale=${size}:${size}[mark];[shadow][mark]overlay=(W-w)/2:(H-h)/2`,
    '-frames:v', '1', out,
  ])
  return out
}

async function mixAndRender(cfg: ShortConfig, stitched: string, voicePath: string, assPath: string, total: number, configDir: string, workDir: string, outPath: string) {
  const preroll = cfg.preroll ?? 0.6
  const paddedVoice = join(workDir, 'voice-padded.mp3')
  await ff(['-y', '-i', voicePath, '-af', `adelay=${Math.round(preroll * 1000)}|${Math.round(preroll * 1000)}`, '-c:a', 'libmp3lame', '-q:a', '2', paddedVoice])

  const { fontsDir } = resolveCaptionFont()
  const escape = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")

  const inputs = ['-i', stitched, '-i', paddedVoice]
  const chains: string[] = [`[0:v]ass=${escape(assPath)}${fontsDir ? `:fontsdir=${escape(fontsDir)}` : ''}[cap]`]
  let videoLabel = '[cap]'
  let next = 2

  let musicIndex = -1
  if (cfg.music) {
    const musicPath = resolve(configDir, cfg.music.file)
    if (!existsSync(musicPath)) throw new Error(`music not found: ${musicPath}`)
    inputs.push('-i', musicPath)
    musicIndex = next++
  }
  if (cfg.watermark) {
    const wmSrc = resolve(configDir, cfg.watermark.file)
    if (!existsSync(wmSrc)) throw new Error(`watermark not found: ${wmSrc}`)
    const wm = await shadowWatermark(wmSrc, workDir, cfg.watermark.size ?? 92)
    inputs.push('-i', wm)
    const wmIndex = next++
    chains.push(`[${wmIndex}]format=rgba,colorchannelmixer=aa=${cfg.watermark.opacity ?? 0.9}[wm]`)
    // Shorts stacks its action buttons down the right edge and puts title/channel
    // bottom-left, so top-left is the only reliably unobstructed corner.
    chains.push(`${videoLabel}[wm]overlay=${cfg.watermark.x ?? 48}:${cfg.watermark.y ?? 98}[vout]`)
    videoLabel = '[vout]'
  }

  let audioLabel = '[1:a]'
  if (musicIndex >= 0) {
    const start = cfg.music!.start ?? 0
    const volume = cfg.music!.volume ?? 0.3
    const fadeOut = Math.max(0, total - 1.6)
    chains.push(
      `[${musicIndex}:a]atrim=${start}:${start + total + 2},asetpts=PTS-STARTPTS,`
      + `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=${volume},`
      + `afade=t=in:st=0:d=1.6,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.6[mus]`,
      `[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[vo]`,
      `[vo]asplit=2[vo1][key]`,
      // Duck the bed under speech rather than relying on a fixed level.
      `[mus][key]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=400[duck]`,
      `[vo1][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`,
    )
    audioLabel = '[aout]'
  } else {
    chains.push(`[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[aout]`)
    audioLabel = '[aout]'
  }

  await ff([
    '-y', ...inputs, '-filter_complex', chains.join(';'),
    '-map', videoLabel, '-map', audioLabel,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '9M', '-bufsize', '18M', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
    '-r', '30', '-shortest', '-movflags', '+faststart', outPath,
  ])
}

/** Contact sheet plus a loop-seam measurement, so quality is checked rather than assumed. */
async function qualityCheck(outPath: string, workDir: string) {
  const duration = Number(await probe(outPath, 'format=duration'))
  const marks = [0.05, 0.25, 0.45, 0.65, 0.85, 0.97].map(f => (duration * f).toFixed(2))
  const frames: string[] = []
  for (const [i, t] of marks.entries()) {
    const p = join(workDir, `qc-${i}.png`)
    await ff(['-y', '-ss', t, '-i', outPath, '-frames:v', '1', '-vf', 'scale=300:-1', p])
    frames.push(p)
  }
  const sheet = join(dirname(outPath), `${basename(outPath, '.mp4')}-qc.png`)
  await ff([
    '-y', ...frames.flatMap(f => ['-i', f]),
    '-filter_complex', '[0][1][2]hstack=inputs=3[a];[3][4][5]hstack=inputs=3[b];[a][b]vstack=inputs=2',
    sheet,
  ])

  const first = join(workDir, 'loop-first.png')
  const last = join(workDir, 'loop-last.png')
  await ff(['-y', '-ss', '0', '-i', outPath, '-frames:v', '1', first])
  await ff(['-y', '-sseof', '-0.05', '-i', outPath, '-update', '1', '-frames:v', '1', last])
  const diff = join(workDir, 'loop-diff.png')
  await ff(['-y', '-i', first, '-i', last, '-filter_complex', 'blend=all_mode=difference,format=gray,scale=160:-1', diff])
  const { stdout } = await exec('ffmpeg', ['-v', 'error', '-i', diff, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' as never }) as unknown as { stdout: Buffer }
  const mean = stdout.length ? stdout.reduce((a, b) => a + b, 0) / stdout.length : 255

  return { duration, sheet, loopDelta: mean }
}

// ---------------------------------------------------------------------------

async function main() {
  const configPath = resolve(process.argv[2] || '')
  if (!configPath || !existsSync(configPath)) {
    console.error('usage: npx tsx scripts/build-short.ts <config.json>')
    process.exit(1)
  }
  const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as ShortConfig
  const configDir = dirname(configPath)
  const workDir = join(configDir, `.build-${cfg.id}`)
  mkdirSync(workDir, { recursive: true })
  const outPath = resolve(configDir, cfg.output || `${cfg.id}.mp4`)

  console.log(`\nBuilding "${cfg.id}"\n`)

  console.log('1/5  narration')
  const { voicePath, words } = await synthesize(cfg, workDir)
  const total = Number((words[words.length - 1].end + (cfg.preroll ?? 0.6) + (cfg.tail ?? 0.55)).toFixed(3))
  console.log(`     ${words.length} words, ${total.toFixed(2)}s total${total > 60 ? '  [!] over 60s Shorts limit' : ''}`)

  console.log('2/5  edit plan')
  const scenes = await planEdit(cfg, words, configDir)
  const stretched = scenes.filter(s => s.factor > 1.35)
  if (stretched.length) {
    console.log(`     [!] scene(s) ${stretched.map(s => s.index + 1).join(', ')} stretched >1.35x — consider moving a line to a neighbouring scene`)
  }

  console.log('3/5  scenes')
  const stitched = await renderScenes(scenes, configDir, workDir)

  console.log('4/5  captions + mix')
  const assPath = buildCaptions(cfg, words, total, workDir)
  await mixAndRender(cfg, stitched, voicePath, assPath, total, configDir, workDir, outPath)

  console.log('5/5  quality check')
  const qc = await qualityCheck(outPath, workDir)
  const sizeMb = (readFileSync(outPath).length / 1048576).toFixed(1)

  console.log(`\n  ${outPath}`)
  console.log(`  ${qc.duration.toFixed(2)}s · ${sizeMb}MB`)
  console.log(`  loop seam: ${qc.loopDelta.toFixed(1)}/255 ${qc.loopDelta < 18 ? '(seamless)' : '(visible cut — check the closing scene)'}`)
  console.log(`  contact sheet: ${qc.sheet}\n`)
}

main().catch(error => {
  console.error(`\nbuild failed: ${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
})
