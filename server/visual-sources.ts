/**
 * visual-sources.ts — multi-source stock footage acquisition, licence verification,
 * query caching, and provenance metadata for Shorts Autopilot.
 *
 * Stack priority:
 *   1. Pexels     — API; Pexels License (free commercial + YouTube use permitted).
 *   2. Pixabay    — API fallback; Pixabay Content License.
 *   3. Mixkit     — HTML scrape fallback; accepted only when item page confirms Free License.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerConfig } from './config.js'
import type { VisualAsset } from './domain.js'

export type StockSearchResult = { assets: VisualAsset[]; provider: string }

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_PER_PAGE = 8

// ── Query cache ──────────────────────────────────────────────────────────────
type CacheEnvelope = { fetchedAt: string; provider: string; query: string; assets: VisualAsset[] }

function cachePath(config: ServerConfig, provider: string, query: string) {
  const key = createHash('sha1').update(`${provider}::${query.toLowerCase().trim()}`).digest('hex')
  return join(config.assetCacheDir, `${key}.json`)
}

export function readCachedSearch(config: ServerConfig, provider: string, query: string): VisualAsset[] | undefined {
  try {
    const path = cachePath(config, provider, query)
    if (!existsSync(path)) return undefined
    const envelope = JSON.parse(readFileSync(path, 'utf8')) as CacheEnvelope
    if (Date.now() - Date.parse(envelope.fetchedAt) > CACHE_TTL_MS) return undefined
    return envelope.assets
  } catch {
    return undefined
  }
}

async function writeCachedSearch(config: ServerConfig, provider: string, query: string, assets: VisualAsset[]) {
  mkdirSync(config.assetCacheDir, { recursive: true })
  await writeFile(cachePath(config, provider, query), JSON.stringify({ fetchedAt: new Date().toISOString(), provider, query, assets } as CacheEnvelope, null, 2))
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`Provider request failed (${response.status})`)
  return response.json() as Promise<Record<string, unknown>>
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Provider request failed (${response.status})`)
  return response.text()
}

// ── Stopwords + keyword cleaning ─────────────────────────────────────────────
const PEXELS_STOPWORDS = new Set([
  'the','a','an','and','or','but','of','to','in','on','at','for','with',
  'from','by','as','is','are','was','were','be','been','being','this',
  'that','these','those','it','its','there','here','about','what','which',
  'who','whom','when','where','why','how','not','no','so','if','then',
  'than','too','very','just','can','will','would','could','should','may',
  'might','must','do','does','did','have','has','had','i','you','we',
  'they','he','she','me','my','your','our','their','him','her','them',
  'most','more','much','many','some','any','all','every','each','one',
  'dont','doesnt','didnt','wouldnt','couldnt','shouldnt','theres','youre',
  'people','person','thing','things','way','part','into','over','under',
  'up','down','out','off','again','after','before','between','through',
  'only','own','same','other','such',
])

export function deriveStockKeywords(text: string): string {
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean)
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const token of tokens) {
    const word = token.replace(/^-+|-+$/g, '')
    if (!word || word.length < 3 || PEXELS_STOPWORDS.has(word) || seen.has(word)) continue
    seen.add(word)
    keywords.push(word)
  }
  return keywords.length ? keywords.slice(0, 5).join(' ') : text.trim()
}

// ── Pexels ───────────────────────────────────────────────────────────────────
async function searchPexels(query: string, config: ServerConfig): Promise<StockSearchResult> {
  if (!config.pexelsApiKey) return { assets: [], provider: 'none' }
  const cached = readCachedSearch(config, 'pexels', query)
  if (cached) return { assets: cached, provider: 'pexels' }

  const q = deriveStockKeywords(query)
  const pexelsHeaders = { Authorization: config.pexelsApiKey }
  const photoResponse = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${DEFAULT_PER_PAGE}&orientation=portrait&size=large`, { headers: pexelsHeaders })
  const videoResponse = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${DEFAULT_PER_PAGE}&orientation=portrait`, { headers: pexelsHeaders }).catch(() => new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }))

  const photoData = (await photoResponse.json()) as Record<string, unknown>
  const videoData = (await videoResponse.json()) as Record<string, unknown>

  const photos = ((photoData.photos as Record<string, unknown>[] | undefined) || [])
    .map(photo => {
      const src = photo.src as Record<string, unknown>
      return {
        path: String(src.large2x || src.large || src.medium || ''),
        type: 'image' as const,
        source: 'pexels',
        credit: String(photo.photographer || ''),
        license: 'Pexels License',
        sourcePageUrl: String(photo.url || ''),
        role: query,
      }
    })
    .filter(asset => asset.path)

  const clips: VisualAsset[] = []
  for (const video of ((videoData.videos as Record<string, unknown>[] | undefined) || [])) {
    const files = (video.video_files as Record<string, unknown>[] | undefined) || []
    const source = files.find(file => String(file.quality) === 'hd' && Number((file as Record<string, unknown>).height || 0) >= 720) || files[0]
    const user = (video.user as Record<string, unknown> | undefined) || {}
    if ((source as Record<string, unknown> | undefined)?.link) {
      clips.push({
        path: String((source as Record<string, unknown>).link),
        type: 'video',
        source: 'pexels',
        credit: String(user.name || ''),
        license: 'Pexels License',
        sourcePageUrl: String(video.url || ''),
        role: query,
      })
    }
  }

  const assets = [...clips, ...photos]
  await writeCachedSearch(config, 'pexels', query, assets)
  return { assets, provider: 'pexels' }
}

// ── Pixabay ──────────────────────────────────────────────────────────────────
async function searchPixabay(query: string, config: ServerConfig): Promise<StockSearchResult> {
  if (!config.pixabayApiKey) return { assets: [], provider: 'none' }
  const cached = readCachedSearch(config, 'pixabay', query)
  if (cached) return { assets: cached, provider: 'pixabay' }

  const q = deriveStockKeywords(query)
  const data = await fetchJson(`https://pixabay.com/api/videos/?key=${encodeURIComponent(config.pixabayApiKey)}&q=${encodeURIComponent(q)}&per_page=${DEFAULT_PER_PAGE}&safesearch=true`)
  const hits = (data.hits as Record<string, unknown>[] | undefined) || []
  const assets: VisualAsset[] = []
  for (const hit of hits) {
    const variants = (hit.videos as Record<string, Record<string, unknown>> | undefined)
    const best = variants?.large || variants?.medium || variants?.small
    const url = best?.url ? String(best.url) : ''
    if (!url) continue
    assets.push({
      path: url,
      type: 'video',
      source: 'pixabay',
      credit: String(hit.user || ''),
      license: 'Pixabay Content License — verify no visible brands/logos',
      sourcePageUrl: String(hit.pageURL || ''),
      role: query,
    })
  }

  await writeCachedSearch(config, 'pixabay', query, assets)
  return { assets, provider: 'pixabay' }
}

// ── Mixkit ───────────────────────────────────────────────────────────────────
export function parseMixkitVideoPreviews(html: string): Array<{ previewUrl: string; pageUrl: string; title: string }> {
  const previews = [...html.matchAll(/https:\/\/assets\.mixkit\.co\/videos\/preview\/mixkit-[a-z0-9-]+-(\d+)-[a-z]+\.mp4/g)]
  const pages = new Map<string, string>()
  for (const match of html.matchAll(/href="(\/free-stock-video\/([a-z0-9-]+)\/)"[^>]*>/g)) {
    pages.set(match[2], `https://mixkit.co${match[1]}`)
  }
  const out: Array<{ previewUrl: string; pageUrl: string; title: string }> = []
  const seen = new Set<string>()
  for (const match of previews) {
    const id = match[1]
    let pageUrl = pages.get(id) || ''
    if (!pageUrl) {
      for (const [pslug, url] of pages) {
        if (pslug.endsWith(`-${id}`)) { pageUrl = url; break }
      }
    }
    if (!pageUrl || seen.has(pageUrl)) continue
    seen.add(pageUrl)
    out.push({ previewUrl: match[0], pageUrl, title: `mixkit-${id}` })
  }
  return out.slice(0, 4)
}

export function hasMixkitFreeLicense(html: string): boolean {
  return /free license/i.test(html) && !/not for commercial|standard license|premium license/i.test(html)
}

async function searchMixkit(query: string, config: ServerConfig): Promise<StockSearchResult> {
  if (!config.mixkitFallback) return { assets: [], provider: 'none' }
  const cached = readCachedSearch(config, 'mixkit', query)
  if (cached) return { assets: cached, provider: 'mixkit' }

  const slug = deriveStockKeywords(query).replace(/\s+/g, '-')
  const searchUrl = `https://mixkit.co/free-stock-video/${encodeURIComponent(slug)}/`
  const html = await fetchText(searchUrl)
  const previews = parseMixkitVideoPreviews(html)
  const assets: VisualAsset[] = []
  for (const preview of previews) {
    try {
      const page = await fetchText(preview.pageUrl)
      if (!hasMixkitFreeLicense(page)) continue
      assets.push({
        path: preview.previewUrl,
        type: 'video',
        source: 'mixkit',
        credit: preview.title,
        license: 'Mixkit Free License — confirmed on item page',
        sourcePageUrl: preview.pageUrl,
        role: query,
      })
    } catch {
      continue
    }
  }

  await writeCachedSearch(config, 'mixkit', query, assets)
  return { assets, provider: 'mixkit' }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
export async function searchStock(query: string, config: ServerConfig): Promise<StockSearchResult> {
  const attempts: Array<[string, (q: string, c: ServerConfig) => Promise<StockSearchResult>]> = [
    ['pexels', searchPexels],
    ['pixabay', searchPixabay],
    ['mixkit', searchMixkit],
  ]
  for (const [name, fn] of attempts) {
    try {
      const result = await fn(query, config)
      if (result.assets.length) return { ...result, provider: name }
    } catch {
      continue
    }
  }
  return { assets: [], provider: 'local-fallback' }
}

// ── Asset caching ────────────────────────────────────────────────────────────
export async function downloadStockAsset(asset: VisualAsset, dir: string, fileName: string): Promise<string | undefined> {
  try {
    mkdirSync(dir, { recursive: true })
    const response = await fetch(asset.path)
    if (!response.ok) return undefined
    const buffer = Buffer.from(await response.arrayBuffer())
    const target = join(dir, fileName)
    if (asset.type === 'video' && !isValidMp4Buffer(buffer)) return undefined
    if (asset.type === 'image' && !isValidImageBuffer(buffer)) return undefined
    await writeFile(target, buffer)
    return target
  } catch {
    return undefined
  }
}

export function isValidMp4Buffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false
  const header = buffer.toString('binary', 0, Math.min(buffer.length, 64))
  return header.includes('ftyp') || (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) || (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x00)
}

export function isValidImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 8) return false
  return (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) ||
    (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    buffer.toString('binary', 0, 4) === 'RIFF' && buffer.toString('binary', 8, 12) === 'WEBP' ||
    buffer.toString('binary', 0, 4).startsWith('GIF8')
}
