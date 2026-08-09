/**
 * seed-jellyfish.ts — Seeds the database with the fact-checked
 * "immortal jellyfish" Short, complete with 6 scene visual roles,
 * captions, render manifest, and metadata ready for produceVideo().
 *
 * Run:  npx tsx scripts/seed-jellyfish.ts
 */
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../server/config.js'
import { ShortsDatabase } from '../server/db.js'
import type { CaptionCue, RenderManifest, VisualAsset } from '../server/domain.js'

const config = loadConfig()
const db = new ShortsDatabase({ filename: config.dbPath })
const now = new Date().toISOString()

// ── Fact-checked narration ─────────────────────────────────────
const narration = [
  'Could an animal literally press reset on its life?',
  'Meet Turritopsis dohrnii, the "immortal jellyfish," smaller than your pinky nail.',
  'When stressed or injured, it can sink to the seabed and collapse into a tiny cyst.',
  'Then some cells switch jobs — a process called transdifferentiation.',
  'That cyst becomes a young polyp, which can grow new jellyfish.',
  'It is not invincible: predators and disease can still kill it.',
  'But it can rewind its life cycle. Would you press reset?',
].join(' ')

const durationSec = 30

// ── 6 scenes (roles only — renderer fills images via Pexels or fallback) ──
const scenes: VisualAsset[] = [
  { path: '', type: 'illustration', source: 'local-fallback', role: 'Illustrated poster frame — jellyfish close-up', startSec: 0, endSec: 5 },
  { path: '', type: 'illustration', source: 'local-fallback', role: 'Illustrated size comparison — smaller than a pinky nail', startSec: 5, endSec: 10 },
  { path: '', type: 'illustration', source: 'local-fallback', role: 'Illustrated life cycle — descent to seabed and cyst', startSec: 10, endSec: 15 },
  { path: '', type: 'illustration', source: 'local-fallback', role: 'Illustrated life cycle — cyst to young polyp', startSec: 15, endSec: 20 },
  { path: '', type: 'illustration', source: 'local-fallback', role: 'Illustrated life cycle — polyp grows new jellyfish', startSec: 20, endSec: 25 },
  { path: '', type: 'illustration', source: 'local-fallback', role: 'Illustrated payoff — not invincible, then reset CTA', startSec: 25, endSec: 30 },
]

// ── Captions ───────────────────────────────────────────────────
const words = narration.replace(/\s+/g, ' ').trim().split(' ')
const wordsPerCue = 3
const captions: CaptionCue[] = []
for (let i = 0; i < words.length; i += wordsPerCue) {
  const startSec = Number((durationSec * i / words.length).toFixed(2))
  const endSec = Number((durationSec * Math.min(i + wordsPerCue, words.length) / words.length).toFixed(2))
  captions.push({ startSec, endSec, text: words.slice(i, i + wordsPerCue).join(' ').toUpperCase() })
}

// ── Render manifest ────────────────────────────────────────────
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
    'Illustrated life-cycle visuals — not authentic Turritopsis footage',
    'Asset provenance recorded on each VisualAsset',
  ],
}

// ── Insert entities ────────────────────────────────────────────
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
  rationale: 'High-retention science hook with a clearly illustrated six-scene life-cycle explanation and evidence-backed claims.',
  createdAt: now,
  updatedAt: now,
})
db.updateTopicStatus(topicId, 'selected')
db.updateTopicStatus(topicId, 'scripted')

db.createScript({
  id: scriptId,
  topicId,
  text: narration,
  durationSec,
  hook: 'Could an animal literally press reset on its life?',
  cta: 'What would you do with a biological reset button?',
  titleSuggestion: 'This Jellyfish Can Rewind Its Life 🪼',
  descriptionSuggestion: 'Turritopsis dohrnii can revert to a polyp stage after stress or injury. Sources: https://pubmed.ncbi.nlm.nih.gov/31619459/ https://doi.org/10.1073/pnas.2118763119 #shorts #science #jellyfish',
  tagsSuggestion: ['immortal jellyfish', 'marine biology', 'regeneration', 'science facts'],
  status: 'draft',
  createdAt: now,
  updatedAt: now,
})
db.updateScriptStatus(scriptId, 'approved')

db.createVideo({
  id: videoId,
  scriptId,
  visualAssets: scenes,
  renderManifest: manifest,
  status: 'pending',
  createdAt: now,
  updatedAt: now,
})

console.log('✅ Jellyfish Short seeded successfully')
console.log(JSON.stringify({ topicId, scriptId, videoId }, null, 2))
console.log('\nNext steps:')
console.log('  1. Start the API:  npm run dev:api')
console.log('  2. Render video:   curl -X POST http://localhost:8787/api/videos/' + videoId + '/render')
console.log('  3. Or run the full pipeline:  curl -X POST http://localhost:8787/api/runs/manual -H "Content-Type: application/json" -d \'{"niche":"Science","topicTitle":"The Immortal Jellyfish"}\'')
db.close()
