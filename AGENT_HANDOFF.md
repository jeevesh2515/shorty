# 🤖 AGENT HANDOFF — Shorts Autopilot YouTube Automation
**For: HyperAgent (Claude Opus / Gemini Opus 5)**  
**Date:** 2026-08-09  
**GitHub Repo:** https://github.com/jeevesh2515/shorty  
**Primary Branch:** `main` (Up to date with `release/shorts-autopilot-v1` at commit `e7034c7`)

> [!IMPORTANT]
> You have **GitHub access only** — no local machine access.  
> All work must be done by editing files in the repo, committing, and letting Railway/Vercel auto-deploy.  
> Never hardcode secrets in files. Use the Railway environment variable system.

---

## 📌 Starting Point & Branch Info

- **Branch to use:** `main`
- **Latest commit:** `e7034c7` (Both `main` and `release/shorts-autopilot-v1` are 100% synchronized)
- **Live Railway API:** https://shorty-production-8fc1.up.railway.app
- **Live Railway TTS (Speaches):** https://speaches-production-293a.up.railway.app
- **Live Vercel Frontend:** https://shorty-alpha-three.vercel.app

---

## 🎯 Mission

Make this YouTube Shorts automation system **fully functional, unattended, and monetisable**.  
The owner wants to **earn money from YouTube Shorts** using free or near-free AI tools.  
Videos are already being generated. The gaps are: publishing pipeline, analytics, and full automation.

---

## 📐 System Architecture (already built & deployed)

```
GitHub (jeevesh2515/shorty)
    │
    ├── auto-deploys to Railway (backend API + FFmpeg)
    │   https://shorty-production-8fc1.up.railway.app
    │
    ├── auto-deploys to Vercel (React dashboard)
    │   https://shorty-alpha-three.vercel.app
    │
    └── Railway: speaches service (Python TTS)
        https://speaches-production-293a.up.railway.app
```

### Key files in the repo

| File/Folder | Purpose |
|---|---|
| `server/workflow.ts` | Core pipeline logic — topic → script → video → upload |
| `server/providers.ts` | All external API integrations (LLM, TTS, visuals, YouTube) |
| `server/http.ts` | All 24 REST API endpoints |
| `server/db.ts` | SQLite database layer (topics, scripts, videos, uploads) |
| `server/domain.ts` | Topic similarity detection, status machines, domain errors |
| `server/config.ts` | All environment variable loading |
| `src/App.tsx` | React dashboard (Topics, Scripts, Videos, Uploads tabs) |
| `services/speaches/` | Python FastAPI TTS microservice (deployed on Railway) |
| `Dockerfile` | Main app container (Node.js + FFmpeg) |
| `vercel.json` | Vercel → Railway proxy config |

---

## ✅ What Is Already Working (DO NOT BREAK)

### Infrastructure
- ✅ Railway backend: **Online** — `https://shorty-production-8fc1.up.railway.app`
- ✅ Railway TTS (Speaches): **Online** — `https://speaches-production-293a.up.railway.app`
- ✅ Vercel frontend: **Online** — `https://shorty-alpha-three.vercel.app`
- ✅ GitHub → Railway auto-deploy on push to `main`
- ✅ GitHub → Vercel auto-deploy on push to `main`

### Pipeline (end-to-end verified)
- ✅ **Topic discovery** — LLM generates trending topic ideas per niche
- ✅ **Topic deduplication** — blocks similar topics from being re-scripted
- ✅ **Script generation** — LLM generates hook + body + CTA scripts
- ✅ **AI Judge** — scores scripts 0–10, rejects below 9.0, retries with feedback
- ✅ **Voiceover (TTS)** — Speaches service generates real MP3 audio (edge-tts voices)
- ✅ **Video rendering** — FFmpeg: 1080×1920, 30fps, captions, Ken Burns, colour grade
- ✅ **Thumbnail** — AI concept + PNG generation
- ✅ **Visual search** — Pexels, Pixabay, Mixkit fallback
- ✅ **YouTube OAuth** — token stored in DB, survives restarts
- ✅ **YouTube upload** — multipart upload with title/description/tags/scheduled time
- ✅ **1 video already published** to YouTube (`EAayUrUSk3c`)

### Current Database State (Railway, synced 2026-08-09)
- Topics: **9** (all `scripted`)
- Scripts: **9** (all `approved`)
- Videos: **9** (7 `review_required`, 1 `ready`, 1 `scheduled`)
- Uploads: **9** (8 `review_required`, 1 `scheduled` with YouTube ID)

---

## ❌ What Is NOT Working / Not Yet Built

### CRITICAL — must fix to make money

1. **Videos are stuck in `review_required`** — no auto-approve, no auto-publish  
   → Set `AUTO_APPROVE=true` and `AUTO_PUBLISH=true` on Railway service `shorty`

2. **2 videos have no audio** (rendered before TTS was live)  
   → Delete videos `f42d3057` and `5d6d53b9` via the API and re-render them

3. **Daily automation is not truly unattended**  
   → `runScheduled()` is in the code but needs an external cron trigger  
   → Add a Railway cron job or GitHub Actions scheduled workflow

4. **No Analytics Dashboard in UI**  
   → Backend `/api/analytics` works, but the React frontend doesn't show charts

5. **SQLite is NOT persisted across Railway restarts**  
   → Every redeploy wipes the database. Must add a Railway Volume or switch to PostgreSQL

### ENHANCEMENT — to grow the channel

6. Background music layer in FFmpeg renders
7. Channel watermark / logo overlay
8. Multi-niche and multi-channel support
9. PostHog full funnel tracking (script_approved, video_rendered, published events)
10. YouTube chapters / timestamps from script scenes
11. Cross-platform posting (TikTok, Instagram Reels)
12. Script factual research (web search / RAG before scripting)

---

## 🆓 Free Tools To Use (Important for Zero-Cost Operation)

### LLM (Script Generation)
| Tool | API | Free Tier |
|---|---|---|
| **Groq** | Already configured (`GROQ_API_KEY`) | ~14M tokens/day free |
| **OpenRouter** | Already configured | Free models: `google/gemma-4-31b-it:free`, `meta-llama/llama-3.1-8b-instruct:free` |
| **Nvidia NIM** | Already configured | Free during preview |
| **Google Gemini Flash** | Add `GEMINI_API_KEY` | 1M tokens/day free |
| **Ollama** | Self-host on Railway | Fully free, `llama3.2:3b` works well |

**Recommended:** Use Groq with `llama-3.3-70b-versatile` — fastest, best quality, free.

### TTS (Voiceover)
| Tool | Status | Quality |
|---|---|---|
| **Speaches (Railway)** | ✅ Already deployed | Good (Microsoft Edge Neural) |
| **edge-tts Python** | Used by Speaches | en-GB-SoniaNeural, en-US-AriaNeural |
| **node-edge-tts** | Fallback in code | Same Microsoft TTS, may be blocked |
| **Google TTS** | Add via gTTS Python | Free, lower quality |

**Current best:** Speaches service at `speaches-production-293a.up.railway.app` — already live.

### Visual Assets (Stock Video/Images)
| Tool | API | Free Tier |
|---|---|---|
| **Pexels** | `PEXELS_API_KEY` set | 200 req/hr free |
| **Pixabay** | `PIXABAY_API_KEY` set | Unlimited |
| **Mixkit** | No key needed | Scraper, fully free |
| **Unsplash** | Add `UNSPLASH_ACCESS_KEY` | 50 req/hr free |

### Thumbnail Generation
- Already using LLM concept + custom PNG renderer (free)
- Can upgrade: Canva API (free tier), or stable-diffusion via HuggingFace Spaces

### Analytics
- **PostHog**: already integrated (free tier = 1M events/month)
- **YouTube Data API**: already configured, use for real channel analytics

---

## 🎯 Niche Strategy (Best for YouTube Shorts Revenue)

Based on the current topics in the DB, the channel is focused on **Science & Nature Facts**. This is an excellent niche:

### Why Science Facts Works for Shorts
- ✅ High CPM ($8–25 for education/science niche)
- ✅ Evergreen content — doesn't go stale
- ✅ No copyright issues (facts are public domain)
- ✅ Pexels/Pixabay have excellent science/nature B-roll
- ✅ Low competition vs. meme or reaction channels
- ✅ Easy to script with LLM (factual, structured)

### Recommended Sub-Niches (add to `DEFAULT_NICHE` env var)
```
Science        ← already running ✅
Psychology     ← high CPM, viral potential
Space          ← massive audience
History        ← evergreen, easy to visualise
Biology        ← works perfectly with existing visual search
Animals        ← already performing (Octopus, Axolotls, Lobster topics)
```

### Monetisation Path
1. **Get to 1,000 subscribers + 4,000 watch hours** → YouTube Partner Programme (YPP)
2. With 1–2 Shorts/day auto-published → 60–90 days to eligibility
3. Science/education CPM: **$8–25** → even at 10K views/video, $80–250/video
4. At 30 videos/month: **$2,400–7,500/month** (once monetised)

### Content Calendar Strategy
Post 1–2 Shorts per day, rotating sub-niches:
```
Mon: Science fact
Tue: Animal behaviour  
Wed: Psychology / mind
Thu: Space / universe
Fri: History mystery
Sat: Biology / human body
Sun: Technology / future
```

Set `DEFAULT_NICHE` to rotate: `Science,Animals,Psychology,Space,History,Biology`

---

## 🔧 Immediate Action Plan for the Agent

### STEP 1: Fix the Publish Pipeline (30 mins)
The most critical step. Set these Railway environment variables on the `shorty` service:

```bash
AUTO_APPROVE=true
AUTO_PUBLISH=true
DEFAULT_NICHE=Science
MONTHLY_AI_BUDGET_USD=10
```

### STEP 2: Fix SQLite Persistence (Critical for production)

**Option A (Recommended — easiest): Add a Railway Volume**

In Railway Dashboard:
1. Open `shorty` service → Storage tab
2. Add a Volume, mount path: `/app/data`
3. This persists the SQLite file across restarts

**Option B: Migrate to PostgreSQL (better long-term)**

Add a PostgreSQL plugin to the Railway project, then modify `server/db.ts` to use `pg` or `drizzle-orm` instead of `better-sqlite3`. Schema is already relational so migration is straightforward.

### STEP 3: Set Up Daily Automation Cron

Create `.github/workflows/daily-shorts.yml` in the repo:

```yaml
name: Daily Shorts Automation
on:
  schedule:
    - cron: '0 8 * * *'  # 8am UTC = 9am London
  workflow_dispatch:

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Discover topic
        run: |
          curl -X POST https://shorty-production-8fc1.up.railway.app/api/topics/discover \
            -H "Content-Type: application/json" \
            -d '{"niche": "Science"}'
      
      - name: Run manual Short
        run: |
          curl -X POST https://shorty-production-8fc1.up.railway.app/api/run-manual \
            -H "Content-Type: application/json" \
            -d '{"niche": "Science"}'
```

### STEP 4: Add Analytics Dashboard to Frontend

In `src/App.tsx`, add an Analytics tab that fetches from `/api/analytics` and renders:
- Views chart (last 30 days)
- Top performing video (by views)
- Total watch time
- Subscriber count delta

### STEP 5: Add Persistent Volume / Backup

Add this to `server/index.ts` — a periodic state export:
```typescript
setInterval(async () => {
  const state = db.exportState()
  await fs.writeFile('/app/data/backup.json', JSON.stringify(state))
}, 60 * 60 * 1000) // every hour
```

---

## 🔑 Live Service Details

### Railway `shorty` service
- **URL:** https://shorty-production-8fc1.up.railway.app
- **Project ID:** `415a9c22-deb1-4973-9397-876a228eeb3d`
- **Service ID:** `29c98b54-3bee-4bba-a825-4ca2e6a6d129`
- **Environment ID:** `040d33f6-356a-4251-a6eb-b5a0f2ef336e`
- **Region:** EU West (europe-west4)
- **Auto-deploy:** Yes, from `main` branch

### Railway `speaches` TTS service
- **URL:** https://speaches-production-293a.up.railway.app
- **Service ID:** `939fe5be-8d1b-4266-834b-b2ce66f8f7fe`
- **Region:** Amsterdam
- **Health check:** GET /health → `{"status":"ok","provider":"edge-tts-openai-compatible"}`
- **TTS endpoint:** POST /v1/audio/speech (OpenAI-compatible)

### Vercel frontend
- **URL:** https://shorty-alpha-three.vercel.app
- **Project:** shorty-alpha-three (jeevesh2515)
- **Proxy:** All `/api/*` and `/media/*` → Railway backend

### YouTube Channel
- **1 video published:** https://www.youtube.com/watch?v=EAayUrUSk3c
- **OAuth:** Refresh token stored in Railway SQLite `settings` table

---

## 📋 API Endpoints Reference

All endpoints on `https://shorty-production-8fc1.up.railway.app`:

```
GET  /api/health              → {"ok":true,"data":{"status":"ok"}}
GET  /api/readiness           → provider status + config + usage
GET  /api/state               → full DB export (JSON)
POST /api/state/import        → import state JSON to Railway DB

GET  /api/topics              → list all topics
POST /api/topics              → create topic: {title, niche, source?, rationale?}
POST /api/topics/discover     → AI discover: {niche: "Science"}
POST /api/topics/cleanup      → remove unscripted topics
DELETE /api/topics/:id        → delete a topic
PATCH /api/topics/:id/status  → {status: "new"|"selected"|"scripted"}
POST /api/topics/:id/script   → generate script for topic

GET  /api/scripts             → list all scripts
POST /api/scripts/:id/judge   → re-evaluate script quality
PATCH /api/scripts/:id/status → {status: "draft"|"approved"}

GET  /api/videos              → list all videos
POST /api/videos              → create video record: {scriptId}
POST /api/videos/:id/render   → trigger full render pipeline
DELETE /api/videos/:id        → delete video

GET  /api/uploads             → list all uploads
POST /api/uploads             → create upload: {videoId, title, description?, tags?}
POST /api/uploads/:id/approve → approve for publish
POST /api/uploads/:id/publish → publish to YouTube NOW
POST /api/uploads/:id/retry   → retry failed upload
DELETE /api/uploads/:id       → delete upload

GET  /api/analytics           → YouTube analytics for published videos
GET  /api/auth/youtube        → start OAuth flow
GET  /api/auth/youtube/callback → OAuth callback

GET  /media/:filename         → serve MP4/MP3/PNG files
```

---

## 🧪 How to Verify Everything Works

After each change, verify by calling these endpoints:

```bash
# 1. Check all providers are online
curl https://shorty-production-8fc1.up.railway.app/api/readiness

# 2. Discover a new topic
curl -X POST https://shorty-production-8fc1.up.railway.app/api/topics/discover \
  -H "Content-Type: application/json" \
  -d '{"niche":"Science"}'

# 3. Get a topic ID from the response, generate its script
curl -X POST https://shorty-production-8fc1.up.railway.app/api/topics/<TOPIC_ID>/script

# 4. Get the script ID, create + render a video
curl -X POST https://shorty-production-8fc1.up.railway.app/api/videos \
  -H "Content-Type: application/json" \
  -d '{"scriptId":"<SCRIPT_ID>"}'

curl -X POST https://shorty-production-8fc1.up.railway.app/api/videos/<VIDEO_ID>/render

# 5. Check video status
curl https://shorty-production-8fc1.up.railway.app/api/videos

# 6. TTS service health
curl https://speaches-production-293a.up.railway.app/health
```

---

## 🚀 How to Make Money (Final Checklist)

1. ✅ 1 video already published to YouTube (`EAayUrUSk3c`)
2. ⬜ Enable AUTO_APPROVE + AUTO_PUBLISH → videos flow automatically  
3. ⬜ Set up daily cron → 1 new Short every day
4. ⬜ After 30 days at 1/day → 30 videos published
5. ⬜ Apply for YouTube Partner Programme (500 subs + 3,000 watch hours for Shorts)
6. ⬜ Enable channel memberships + Super Thanks once monetised
7. ⬜ Add affiliate links in video descriptions (Amazon, courses) for secondary revenue

---

*Handoff prepared by senior AI engineer. All services verified live as of 2026-08-09.*
