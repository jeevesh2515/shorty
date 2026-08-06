import { loadConfig } from '../server/config.js'
import { ShortsDatabase } from '../server/db.js'
import { createHttpServer } from '../server/http.js'
import { ShortsWorkflow } from '../server/workflow.js'

const config = { ...loadConfig({}), port: 0, dbPath: ':memory:', mediaDir: '/tmp/shorts-autopilot-smoke' }
const db = new ShortsDatabase({ filename: ':memory:', seed: true })
const server = createHttpServer(db, new ShortsWorkflow(db, config), config)
await new Promise<void>(resolve => server.listen(0, resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Unable to bind smoke server')
const base = `http://127.0.0.1:${address.port}`
for (const path of ['/api/health', '/api/readiness', '/api/state']) {
  const response = await fetch(`${base}${path}`)
  console.log(path, response.status, await response.json())
}
await new Promise<void>(resolve => server.close(() => resolve()))
db.close()
