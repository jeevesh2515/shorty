import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../server/config.js'
import { ShortsDatabase } from '../server/db.js'
import { createHttpServer } from '../server/http.js'
import { ShortsWorkflow } from '../server/workflow.js'

let db: ShortsDatabase
let server: ReturnType<typeof createHttpServer>
let baseUrl = ''

afterEach(async () => { await new Promise<void>(resolve => server?.close(() => resolve())); db?.close() })

describe('HTTP API', () => {
  it('exposes readiness and state endpoints', async () => {
    db = new ShortsDatabase({ filename: ':memory:', seed: true })
    const config = { ...loadConfig({}), port: 0, dbPath: ':memory:', mediaDir: '/tmp/shorts-autopilot-test' }
    server = createHttpServer(db, new ShortsWorkflow(db, config), config)
    await new Promise<void>(resolve => server.listen(0, resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    baseUrl = `http://127.0.0.1:${address.port}`
    const readiness = await fetch(`${baseUrl}/api/readiness`).then(response => response.json()) as { ok: boolean; data: { providers: Record<string, boolean> } }
    const state = await fetch(`${baseUrl}/api/state`).then(response => response.json()) as { ok: boolean; data: { topics: unknown[] } }
    expect(readiness.ok).toBe(true)
    expect(readiness.data.providers.llm).toBe(true)
    expect(state.ok).toBe(true)
    expect(state.data.topics.length).toBe(1)
  })
})
