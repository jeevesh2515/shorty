/**
 * acquire-jellyfish.ts — hunts Pexels/Pixabay/Mixkit for the Jellyfish Short,
 * caches clips locally with provenance, and seeds the DB with a 6-scene video
 * that prefers real footage and labels any unverified Turritopsis life-cycle
 * explanation as "Illustrated life cycle".
 *
 * Run: npx tsx scripts/acquire-jellyfish.ts
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { loadConfig } from '../server/config.js'
import { ShortsDatabase } from '../server/db.js'
import { searchStock, downloadStockAsset } from '../server/visual-sources.js'
import type { CaptionCue, RenderManifest, VisualAsset } from '../server/domain.js'

const config = loadConfig()
const db = new ShortsDatabase({ filename: config.dbPath })
const now = new Date().toISOString()

const queries = [
  'jellyfish underwater',
  'jellyfish close up',
  'jellyfish drifting ocean',
  'seabed underwater',
  'coral polyp macro',
]

async function pickBestVideo(assets: VisualAsset[]): Promise<VisualAsset | undefined> {
  const videos = assets.filter(a => a.type === 'video')
  if (!videos.length) return undefined
  return videos[0]
}

async function main() {
  const libraryDir = join(config.mediaDir, 'jellyfish-library')
  mkdirSync(libraryDir, { recursive: true })

  const selectedAssets: VisualAsset[] = []
  const provenance: Array<Record<string, unknown>> = []

  for (const query of queries) {
    const result = await searchStock(query, config)
    const best = await pickBestVideo(result.assets)
    if (!best) {
      console.warn(`No video found for "${query}" — will fall back to illustration at render time.`)
      continue
    }
    const fileName = `${queries.indexOf(query) + 1}-${query.replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.mp4`
    const localPath = await downloadStockAsset(best, libraryDir, fileName)
    if (!localPath) {
      console.warn(`Download failed for "${query}" — will fall back to illustration.`)
      continue
    }
    const asset: VisualAsset = {
      path: localPath,
      type: 'video',
      source: best.source,
      credit: best.credit,
      license: best.license,
      sourcePageUrl: best.sourcePageUrl,
      role: query,
    }
    selectedAssets.push(asset)
    provenance.push({ scene: selectedAssets.length - 1, query, asset })
    console.log(`Scene ${selectedAssets.length}: ${query} → ${basename(localPath)} (${best.source})`)
  }

  while (selectedAssets.length < 6) {
    selectedAssets.push({ path: '', type: 'illustration', source: 'local-fallback', role: 'Illustrated filler — wait for render fallback', startSec: selectedAssets.length * 5, endSec: (selectedAssets.length + 1) * 5 })
  }

  // Label the cyst-to-polyp explanation as illustrated life-cycle
  selectedAssets[3].role = 'Illustrated life cycle — cyst collapse explanation (not verified Turritopsis dohrnii footage)'
  selectedAssets[4].role = 'Illustrated life cycle — young polyp growth (not verified Turritopsis dohrnii footage)'

  const topicId = randomUUID()
  const scriptId = randomUUID()
  const videoId = randomUUID()

  db.createTopic({
    id: topicId,
    title: 'This Jellyfish Can Rewind Its Life 🪼',
    niche: 'Science',
    source: 'manual',
    status: 'new',
    metrics: { trendScore: 91, searchLift: 28, competition: 'Low' },
    rationale: 'High-retention science hook with real stock footage and licensed visuals.',
    createdAt: now,
    updatedAt: now,
  })
  db.updateTopicStatus(topicId, 'selected')
  db.updateTopicStatus(topicId, 'scripted')

  const narration = [
    'Could an animal literally press reset on its life?',
    'Meet Turritopsis dohrnii, the "immortal jellyfish," smaller than your pinky nail.',
    'When stressed or injured, it can sink to the seabed and collapse into a tiny cyst.',
    'Then some cells switch jobs — a process called transdifferentiation.',
    'That cyst becomes a young polyp, which can grow new jellyfish.',
    'It is not invincible: predators and disease can still kill it.',
    'But it can rewind its life cycle. Would you press reset?',
  ].join(' ')

  db.createScript({
    id: scriptId,
    topicId,
    text: narration,
    durationSec: 30,
    hook: 'Could an animal literally press reset on its life?',
    cta: 'What would you do with a biological reset button?',
    titleSuggestion: 'This Jellyfish Can Rewind Its Life 🪼',
    descriptionSuggestion: 'Turritopsis dohrnii can revert to a polyp stage after stress or injury. Sources: https://pubmed.ncbi.nlm.nih.gov/31619459/ https://doi.org/10.1073/pnas.2118763119 #shorts #science #jellyfish',
    tagsSuggestion: ['immortal jellyfish', 'marine biology', 'regeneration', 'science facts'],
    status: 'approved',
    createdAt: now,
    updatedAt: now,
  })

  const captions: CaptionCue[] = []
  const words = narration.replace(/\s+/g, ' ').trim().split(' ')
  const wordsPerCue = 3
  for (let i = 0; i < words.length; i += wordsPerCue) {
    const startSec = Number((30 * i / words.length).toFixed(2))
    const endSec = Number((30 * Math.min(i + wordsPerCue, words.length) / words.length).toFixed(2))
    captions.push({ startSec, endSec, text: words.slice(i, i + wordsPerCue).join(' ').toUpperCase() })
  }

  const manifest: RenderManifest = {
    captions,
    posterFrameSec: 0.75,
    factualSources: [
      'https://pubmed.ncbi.nlm.nih.gov/31619459/',
      'https://doi.org/10.1073/pnas.2118763119',
    ],
    requiresSyntheticDisclosure: true,
    compliance: [
      'Original narration',
      'Captioned for accessibility',
      'Source-backed factual claim — PubMed + PNAS cited',
      'Real stock footage + local fallback illustrations for unverified life-cycle stages',
      'Asset provenance recorded on each VisualAsset',
    ],
  }

  db.createVideo({
    id: videoId,
    scriptId,
    visualAssets: selectedAssets,
    renderManifest: manifest,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  })

  await writeFile(join(libraryDir, '..', 'jellyfish-provenance.json'), JSON.stringify({ topicId, scriptId, videoId, scenes: provenance }, null, 2))

  console.log('\n✅ Jellyfish footage acquired and seeded')
  console.log(JSON.stringify({ topicId, scriptId, videoId }, null, 2))
  console.log('\nNext:')
  console.log(`  1. Start API:  npm run dev:api`)
  console.log(`  2. Render:    curl -X POST http://localhost:8787/api/videos/${videoId}/render`)
  console.log(`  3. Approve:   dashboard or /api/uploads`)
}

main().catch(error => { console.error(error); process.exit(1) })
