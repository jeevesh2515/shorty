import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { loadConfig } from './config.js'
import { ShortsDatabase } from './db.js'
import { createHttpServer } from './http.js'
import { ShortsWorkflow } from './workflow.js'

const config = loadConfig()
mkdirSync(config.mediaDir, { recursive: true })
const db = new ShortsDatabase({ filename: config.dbPath, seed: process.env.SEED_DEMO === 'true' })
const workflow = new ShortsWorkflow(db, config)
const server = createHttpServer(db, workflow, config)
server.listen(config.port, () => console.log(`Shorts Autopilot API listening on http://localhost:${config.port}`))

let schedulerTimer: NodeJS.Timeout | undefined
if (process.env.ENABLE_SCHEDULER === 'true') {
  const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 60 * 60 * 1000)
  schedulerTimer = setInterval(() => workflow.runScheduled().then(result => console.log('[scheduler]', result)).catch(error => console.error('[scheduler]', error)), intervalMs)
  console.log(`Scheduler enabled with ${intervalMs}ms interval`)
}

function shutdown() { if (schedulerTimer) clearInterval(schedulerTimer); server.close(() => { db.close(); process.exit(0) }) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
