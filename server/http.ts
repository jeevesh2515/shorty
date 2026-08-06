import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import type { ServerConfig } from './config.js'
import { providerReadiness } from './config.js'
import { ShortsDatabase } from './db.js'
import { DomainError } from './domain.js'
import { ShortsWorkflow } from './workflow.js'

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
function send(res: ServerResponse, status: number, body: unknown, origin = '*') { res.writeHead(status, { ...jsonHeaders, 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' }); res.end(JSON.stringify(body)) }
function ok(res: ServerResponse, body: unknown, status = 200) { send(res, status, { ok: true, data: body }) }
function fail(res: ServerResponse, error: unknown, origin = '*') { const domain = error instanceof DomainError ? error : undefined; send(res, domain?.statusCode || 500, { ok: false, error: { code: domain?.code || 'INTERNAL_ERROR', message: domain ? domain.message : 'Internal server error' } }, origin) }
async function readBody(req: IncomingMessage, maxBytes: number) { const chunks: Buffer[] = []; let bytes = 0; for await (const chunk of req) { const buffer = Buffer.from(chunk); bytes += buffer.length; if (bytes > maxBytes) throw new DomainError('BODY_TOO_LARGE', 'Request body is too large', 413); chunks.push(buffer) } if (!chunks.length) return {}; try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> } catch { throw new DomainError('INVALID_JSON', 'Request body must be valid JSON', 400) } }
function routePath(req: IncomingMessage) { return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`) }
function serveMedia(req: IncomingMessage, res: ServerResponse, mediaDir: string, pathname: string) { const root = resolve(mediaDir); const file = resolve(join(root, decodeURIComponent(pathname.replace(/^\/media\//, '')))); if (relative(root, file).startsWith('..') || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return } const types: Record<string, string> = { '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' }; res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' }); createReadStream(file).pipe(res) }
function serveStatic(res: ServerResponse, staticDir: string, pathname: string) { const root = resolve(staticDir); const requested = pathname === '/' ? '/index.html' : pathname; const file = resolve(join(root, decodeURIComponent(requested))); if (relative(root, file).startsWith('..') || !existsSync(file) || !statSync(file).isFile()) { const fallback = resolve(join(root, 'index.html')); if (existsSync(fallback)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); createReadStream(fallback).pipe(res); return } res.writeHead(404); res.end('Not found'); return } const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }; res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(res) }

export function createHttpServer(db: ShortsDatabase, workflow: ShortsWorkflow, config: ServerConfig) {
  return createServer(async (req, res) => {
    const requestOrigin = typeof req.headers.origin === 'string' && req.headers.origin === config.appOrigin ? req.headers.origin : config.appOrigin
    try {
      if (config.apiToken && req.url?.startsWith('/api/') && req.headers.authorization !== `Bearer ${config.apiToken}`) { send(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, requestOrigin); return }
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': requestOrigin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Vary': 'Origin' }); res.end(); return }
      const url = routePath(req)
      if (url.pathname.startsWith('/media/')) { serveMedia(req, res, config.mediaDir, url.pathname); return }
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/media/')) { serveStatic(res, config.staticDir, url.pathname); return }
      if (req.method === 'GET' && url.pathname === '/api/health') { ok(res, { service: 'shorts-autopilot-api', status: 'ok', timestamp: new Date().toISOString() }); return }
      if (req.method === 'GET' && url.pathname === '/api/readiness') { ok(res, { providers: providerReadiness(config), config: { llmProvider: config.llmProvider, monthlyAiBudgetUsd: config.monthlyAiBudgetUsd, automationPaused: config.automationPaused || db.getSetting('automation_paused') === 'true' }, usage: workflow.usageSummary() }); return }
      if (req.method === 'GET' && url.pathname === '/api/state') { ok(res, db.exportState()); return }
      if (req.method === 'GET' && url.pathname === '/api/topics') { ok(res, db.listTopics()); return }
      if (req.method === 'POST' && url.pathname === '/api/topics') { const body = await readBody(req, config.maxBodyBytes); ok(res, await workflow.createTopic({ title: String(body.title || ''), niche: String(body.niche || ''), source: body.source as 'trending' | 'evergreen' | 'manual' | undefined, rationale: body.rationale ? String(body.rationale) : undefined, metrics: (body.metrics as Record<string, unknown>) || {} }), 201); return }
      if (req.method === 'POST' && url.pathname === '/api/topics/discover') { const body = await readBody(req, config.maxBodyBytes); ok(res, await workflow.discoverAndStore(String(body.niche || 'Productivity')), 201); return }
      const topicStatus = url.pathname.match(/^\/api\/topics\/([^/]+)\/status$/)
      if (req.method === 'PATCH' && topicStatus) { const body = await readBody(req, config.maxBodyBytes); ok(res, db.updateTopicStatus(topicStatus[1], body.status as never)); return }
      const topicScript = url.pathname.match(/^\/api\/topics\/([^/]+)\/script$/)
      if (req.method === 'POST' && topicScript) { ok(res, await workflow.generateScript(topicScript[1])); return }
      if (req.method === 'GET' && url.pathname === '/api/scripts') { ok(res, db.listScripts()); return }
      const scriptStatus = url.pathname.match(/^\/api\/scripts\/([^/]+)\/status$/)
      if (req.method === 'PATCH' && scriptStatus) { const body = await readBody(req, config.maxBodyBytes); ok(res, db.updateScriptStatus(scriptStatus[1], body.status as never)); return }
      if (req.method === 'GET' && url.pathname === '/api/videos') { ok(res, db.listVideos()); return }
      if (req.method === 'POST' && url.pathname === '/api/videos') { const body = await readBody(req, config.maxBodyBytes); ok(res, await workflow.createVideo(String(body.scriptId)), 201); return }
      const videoRender = url.pathname.match(/^\/api\/videos\/([^/]+)\/render$/)
      if (req.method === 'POST' && videoRender) { ok(res, await workflow.produceVideo(videoRender[1])); return }
      if (req.method === 'GET' && url.pathname === '/api/uploads') { ok(res, db.listUploads()); return }
      if (req.method === 'POST' && url.pathname === '/api/uploads') { const body = await readBody(req, config.maxBodyBytes); ok(res, await workflow.createUpload(String(body.videoId), { title: String(body.title || ''), description: body.description ? String(body.description) : undefined, tags: Array.isArray(body.tags) ? body.tags.map(String) : [], scheduledAt: body.scheduledAt ? String(body.scheduledAt) : undefined }), 201); return }
      const uploadPublish = url.pathname.match(/^\/api\/uploads\/([^/]+)\/publish$/)
      if (req.method === 'POST' && uploadPublish) { ok(res, await workflow.publishUpload(uploadPublish[1])); return }
      const uploadApprove = url.pathname.match(/^\/api\/uploads\/([^/]+)\/approve$/)
      if (req.method === 'POST' && uploadApprove) { ok(res, await workflow.approveForPublish(uploadApprove[1])); return }
      const uploadRetry = url.pathname.match(/^\/api\/uploads\/([^/]+)\/retry$/)
      if (req.method === 'POST' && uploadRetry) { ok(res, await workflow.publishUpload(uploadRetry[1])); return }
      if (req.method === 'GET' && url.pathname === '/api/analytics') { ok(res, db.listAnalytics()); return }
      if (req.method === 'POST' && url.pathname === '/api/analytics/sync') { ok(res, await workflow.syncAnalytics()); return }
      if (req.method === 'GET' && url.pathname === '/api/audit') { ok(res, db.listAudit(Number(url.searchParams.get('limit') || 100))); return }
      if (req.method === 'PATCH' && url.pathname === '/api/settings/automation') { const body = await readBody(req, config.maxBodyBytes); const paused = Boolean(body.paused); db.setSetting('automation_paused', String(paused)); db.audit('job', 'automation', 'setting_changed', paused ? 'paused' : 'active', paused ? 'Automation paused' : 'Automation resumed'); ok(res, { paused }); return }
      if (req.method === 'POST' && url.pathname === '/api/runs/manual') { const body = await readBody(req, config.maxBodyBytes); ok(res, await workflow.runManual({ niche: String(body.niche || 'Productivity'), topicTitle: body.topicTitle ? String(body.topicTitle) : undefined }), 201); return }
      if (req.method === 'POST' && url.pathname === '/api/runs/scheduled') { ok(res, await workflow.runScheduled(), 201); return }
      send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } })
    } catch (error) { console.error('[API ERROR]', req.method, req.url, error); fail(res, error, requestOrigin) }
  })
}
