import { mkdirSync, statSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadConfig } from '../server/config.js'
import { ShortsDatabase } from '../server/db.js'
import { ShortsWorkflow } from '../server/workflow.js'

async function main() {
  const config = loadConfig()
  const tempDir = resolve(process.cwd(), 'data/pipeline-smoke')
  mkdirSync(tempDir, { recursive: true })
  const db = new ShortsDatabase({ filename: ':memory:' })
  const workflowConfig = { ...config, dbPath: ':memory:', mediaDir: tempDir }
  const workflow = new ShortsWorkflow(db, workflowConfig)
  const result = await workflow.runManual({ niche: 'Productivity', topicTitle: 'Why tiny habits compound without spending a dollar' })
  const mediaFiles = readdirSync(tempDir)
  const mp4 = mediaFiles.find(file => file.endsWith('.mp4'))
  if (!mp4) throw new Error('FFmpeg render did not produce an MP4 file')
  const size = statSync(join(tempDir, mp4)).size
  if (size < 1024) throw new Error(`Rendered MP4 suspiciously small: ${size} bytes`)
  const video = db.getVideo(result.video.id)
  const script = db.getScript(result.script.id)
  const upload = db.getUpload(result.upload.id)
  if (!video?.finalVideoUrl) throw new Error('Video finalVideoUrl missing')
  if (!script?.titleSuggestion) throw new Error('Script titleSuggestion missing')
  if (!upload?.idempotencyKey) throw new Error('Upload idempotencyKey missing')
  const auditCount = db.listAudit(50).length
  const usage = workflow.usageSummary()
  console.log(JSON.stringify({
    useCase: 'local-fallback-pipeline',
    ffmpegAvailable: existsSync(`/opt/homebrew/bin/ffmpeg`),
    renderedFile: mp4,
    sizeBytes: size,
    finalVideoPath: video.finalVideoUrl,
    providers: result.providers,
    scriptProvider: (result as { provider?: string }).provider,
    scriptId: result.script.id,
    videoId: result.video.id,
    uploadId: result.upload.id,
    auditEventsCount: auditCount,
    usage,
    allFinalVideoUrlStartsWithMedia: video.finalVideoUrl.startsWith('/media/'),
    scriptTags: script.tagsSuggestion.length,
    niche: result.topic.niche,
  }, null, 2))
  db.close()
}

main().catch(error => { console.error(error); process.exit(1) })
