import { describe, expect, it } from 'vitest'
import { localScript, searchVisuals } from '../server/providers.js'
import type { ServerConfig } from '../server/config.js'
import type { Topic } from '../server/domain.js'

const config: ServerConfig = { port: 8787, dbPath: ':memory:', mediaDir: '/tmp/shorts-autopilot-test', staticDir: '/tmp/shorts-autopilot-dist', appOrigin: 'http://localhost:5173', apiToken: undefined, maxBodyBytes: 1_000_000, llmProvider: 'local', openaiModel: 'gpt-4o-mini', geminiModel: 'gemini-2.5-flash', automationPaused: false, monthlyAiBudgetUsd: 5 }
const topic: Topic = { id: 'topic-1', title: 'Why tiny habits compound', niche: 'Productivity', source: 'manual', status: 'new', metrics: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }

describe('provider fallbacks', () => {
  it('generates a valid local script without credentials', () => {
    const script = localScript(topic)
    expect(script.text.length).toBeGreaterThan(40)
    expect(script.durationSec).toBeGreaterThanOrEqual(15)
    expect(script.tagsSuggestion).toContain('shorts')
  })

  it('returns an explicit empty visual result without Pexels credentials', async () => {
    const result = await searchVisuals('mountains', config)
    expect(result.provider).toBe('local-fallback')
    expect(result.assets).toEqual([])
  })
})
