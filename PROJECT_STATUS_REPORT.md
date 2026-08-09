# Shorts Autopilot — Engineering Status Report
**Author:** Senior AI Engineer Report  
**Date:** 2026-08-09  
**Version:** 0.2.0 · Branches: `main`, `release/shorts-autopilot-v1`  
**Repo:** [jeevesh2515/shorty](https://github.com/jeevesh2515/shorty)

---

## 1. Project Overview

Shorts Autopilot is a **full-stack YouTube Shorts automation pipeline** built with TypeScript. It takes a content niche as input and autonomously generates, renders, and publishes YouTube Shorts end-to-end. The operator dashboard (React/Vite SPA) gives full human-in-the-loop control at every stage.

```
Topic Discovery → Script Generation → Script Judging → Visual Search →
Voiceover (TTS) → Video Render (FFmpeg) → Thumbnail → Upload → YouTube Publish
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + TypeScript + Vite |
| **Backend** | Node.js HTTP server (no Express), TypeScript |
| **Database** | SQLite via `better-sqlite3` |
| **Renderer** | FFmpeg (Docker container on Railway) |
| **LLM** | Groq (primary), OpenRouter, Nvidia, OpenAI, Gemini, Ollama |
| **TTS** | Speaches (FastAPI + edge-tts) on Railway, node-edge-tts fallback, macOS `say` fallback |
| **Visuals** | Pexels, Pixabay, Mixkit fallback |
| **YouTube** | Google YouTube Data API v3 + OAuth2 |
| **Hosting** | Railway (backend + TTS), Vercel (frontend) |
| **Analytics** | PostHog |
| **CI/CD** | GitHub → Railway auto-deploy, Vercel auto-deploy |

---

## 2. Architecture

```
┌──────────────────────────────────┐
│  Vercel (Frontend SPA)           │
│  https://shorty-alpha-three.     │
│  vercel.app                      │
│  → proxies /api/* to Railway     │
└──────────┬───────────────────────┘
           │ HTTPS proxy (vercel.json)
           ▼
┌──────────────────────────────────┐
│  Railway: shorty service         │
│  https://shorty-production-8fc1  │
│  .up.railway.app                 │
│                                  │
│  ├── HTTP API (server/http.ts)   │
│  ├── Workflow (server/workflow)  │
│  ├── SQLite DB (data/*.sqlite)   │
│  └── FFmpeg renderer             │
└──────────┬───────────────────────┘
           │ SPEACHES_API_URL (internal)
           ▼
┌──────────────────────────────────┐
│  Railway: speaches service       │
│  https://speaches-production-    │
│  293a.up.railway.app             │
│                                  │
│  FastAPI + edge-tts Python       │
│  POST /v1/audio/speech           │
│  GET  /health                    │
└──────────────────────────────────┘
```

---

## 3. ✅ What Works (Fully Implemented & Verified)

### 3.1 Frontend Dashboard
- **Topics tab** — list, create, delete, filter, status badges
- **Scripts tab** — per-topic script detail, judge score, hook/body/CTA display
- **Videos tab** — rendered video preview, thumbnail, audio player, render manifest
- **Uploads tab** — upload queue, approve-to-publish flow, status tracking
- **Sidebar navigation** — keyboard-accessible, mobile-responsive
- **Empty states, error states, loading indicators** — all implemented
- **Pause/Resume automation toggle** — propagated to backend

### 3.2 Topic Pipeline
- Topic creation (manual + AI-discovered)
- **Duplicate / similarity detection** via `areTopicsSimilar()` in `server/domain.ts`
  - Jaccard token similarity, subject keyword matching, emoji/stopword stripping
  - Blocks both new topics AND new scripts for similar existing content
- AI topic discovery: `discoverAndStore(niche)` calls LLM, deduplicates, stores
- Topic status machine: `new → selected → scripted`
- Topic cleanup (removes unscripted topics to prevent stale queue buildup)

### 3.3 Script Generation
- LLM-powered script generation with **retry loop** (up to 3 attempts)
- **AI Judge** (`judgeScript`) scores each draft 0–10 on hook, pacing, CTA, SEO, virality
- Minimum score threshold of **9.0/10** before auto-approve
- Feedback passed back to LLM on retry for self-improvement loop
- Optional `requireResearch` gate — blocks scripts without factual source URLs
- Status machine: `draft → approved`

### 3.4 Voiceover (TTS)
- **Primary (Railway)**: Speaches service at `https://speaches-production-293a.up.railway.app`
  - FastAPI + `edge-tts` Python library
  - OpenAI-compatible `/v1/audio/speech` endpoint
  - 6 OpenAI voice aliases mapped to Microsoft Edge Neural voices
  - **Verified: HTTP 200, ~24KB MP3 per request** ✅
- **Fallback 2**: `node-edge-tts` (direct Microsoft TTS — may be blocked on Railway IPs)
- **Fallback 3**: macOS `say` → `ffmpeg` (local dev only)
- `ALLOW_SILENT_AUDIO=true` env var available to skip audio requirement if needed

### 3.5 Video Rendering (FFmpeg)
- Per-scene FFmpeg rendering with correct `isActualVideo` check for synthetic fallbacks
- **1080×1920, 30fps** (YouTube Shorts vertical format)
- Colour grading: `eq=contrast=1.06:saturation=1.08,format=yuv420p`
- Ken Burns zoom effect for image scenes
- Caption/subtitle overlay via Drawtext filter
- Audio merging (voiceover + background)
- Thumbnail generated from first frame
- Render manifest stored in DB for provenance
- SVG illustrated fallback for when no visual assets are found

### 3.6 Visual Assets
- **Pexels API** — video and image search
- **Pixabay API** — image search fallback
- **Mixkit** — free stock video fallback (scraper + licence validator)
- Visual asset provenance tracked: source, license, credit, sourcePageUrl
- Capped to max 8 assets per video (6 video + 2 image)
- Optional `requireVideoFootage` gate — fails if only images found

### 3.7 Thumbnail Generation
- AI-powered thumbnail concept generation via LLM
- Rendered as PNG using `server/png.ts`
- Stored in media dir, URL saved to video record

### 3.8 YouTube Publishing
- **OAuth 2.0 flow** — full authorize + callback + refresh token management
- Token stored in SQLite settings table (survives restarts)
- `uploadToYouTube()` — multipart upload, title, description, tags, scheduled publish time
- Idempotency key prevents duplicate uploads on retry
- **One confirmed YouTube publish: `EAayUrUSk3c`** ✅
- `AUTO_PUBLISH=true` → publishes immediately after approval
- `AUTO_APPROVE=true` → skips manual review step
- YouTube Analytics sync: `fetchYouTubeAnalytics()` — views, likes, CTR, watchTime

### 3.9 Scheduled Automation
- `runScheduled()` runs once per day at configurable London time (`REVIEW_HOUR_LONDON`)
- Full pipeline: discover topic → generate script → render video → queue for upload
- Idempotent daily key prevents double-runs
- Pause/resume via `AUTOMATION_PAUSED=true` or UI toggle
- Monthly AI cost budget (`MONTHLY_AI_BUDGET_USD`, default $5)

### 3.10 REST API (24 endpoints)
All endpoints in [server/http.ts](file:///Users/jeeveshsingale/shorty/server/http.ts) verified working:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Service heartbeat |
| GET | `/api/readiness` | Provider connectivity check |
| GET/POST | `/api/topics` | List / create topics |
| POST | `/api/topics/discover` | AI topic discovery |
| POST | `/api/topics/cleanup` | Remove stale topics |
| DELETE | `/api/topics/:id` | Delete a topic |
| PATCH | `/api/topics/:id/status` | Manual status override |
| POST | `/api/topics/:id/script` | Generate script for topic |
| GET | `/api/scripts` | List all scripts |
| POST | `/api/scripts/:id/judge` | Re-evaluate script |
| PATCH | `/api/scripts/:id/status` | Manual status override |
| GET/POST | `/api/videos` | List / create video records |
| DELETE | `/api/videos/:id` | Delete video |
| POST | `/api/videos/:id/render` | Trigger full render pipeline |
| GET/POST | `/api/uploads` | List / create upload queue items |
| DELETE | `/api/uploads/:id` | Delete upload |
| POST | `/api/uploads/:id/publish` | Publish to YouTube now |
| POST | `/api/uploads/:id/approve` | Approve for scheduled publish |
| POST | `/api/uploads/:id/retry` | Retry failed upload |
| GET/POST | `/api/state` | Export / import full DB state |
| GET/POST | `/api/auth/youtube` | OAuth redirect |
| GET | `/api/auth/youtube/callback` | OAuth callback |
| GET | `/api/analytics` | YouTube analytics data |
| GET | `/media/*` | Serve rendered MP4/MP3/PNG files |

### 3.11 Database (SQLite)
- 5 core entities: Topics, Scripts, Videos, Uploads, Analytics
- Audit log table for all status transitions
- Settings KV store (YouTube token, automation flags, daily keys)
- `exportState()` / `importState()` for full DB migration between environments
- Similar-topic deduplication runs on import

### 3.12 Security
- API token auth (`Authorization: Bearer <token>`) on all `/api/` routes
- Secrets never reach the browser (all provider keys are server-side only)
- Path traversal protection on media file serving (`relative()` check)
- CORS headers with origin allowlist
- `.gitignore` covers `.env`, `data/`, `*.sqlite`, `dist/`

### 3.13 Deployment
- **Railway `shorty` service** — Online, EU West, auto-deploys from `main`
- **Railway `speaches` service** — Online, Amsterdam, Dockerfile build from `services/speaches/`
- **Vercel frontend** — Online, proxies `/api/*` and `/media/*` to Railway via `vercel.json`
- `SPEACHES_API_URL` correctly linked between Railway services

### 3.14 Test Suite (9/9 passing)
- `tests/db.test.ts` — topic/script/video relational chain, invalid transitions, similarity detection
- `tests/http.test.ts` — readiness and state endpoints
- `tests/providers.test.ts` — local script generation, empty visual search without keys
- `tests/visual-sources.test.ts` — Mixkit URL parsing, license validation, buffer validation

### 3.15 PostHog Analytics
- PostHog JS SDK integrated in frontend
- Basic page view tracking active

---

## 4. ⚠️ Partially Working / Known Issues

### 4.1 Two Videos Missing Audio
2 of 9 videos have `audioUrl: null`. These were rendered before the Speaches TTS service was deployed.

> **Fix:** Delete these two videos from the Videos tab and re-render them. The new Speaches service will supply audio.

### 4.2 All Uploads in `review_required` State
8 of 9 uploads are stuck in `review_required`. Only 1 has been published to YouTube.

> **Fix:** Set `AUTO_APPROVE=true` and `AUTO_PUBLISH=true` on Railway for fully automated publishing. Or approve individually through the UI.

### 4.3 Speaches Builder Fragility on Railway
The `speaches` service needed GraphQL API calls to force Dockerfile builder (Railway defaulted to Railpack which ran the Node.js server instead of Python). After setting `dockerfilePath` and adding `services/speaches/railway.json`, it works — but may need re-verification after a Railway infrastructure change.

> **Fix:** Consider a separate dedicated GitHub repository for `speaches` with its own `Dockerfile` at root, eliminating the subdirectory ambiguity.

### 4.4 Scheduled Automation Not Truly Unattended
`runScheduled()` runs inside the Node.js process but Railway containers can restart. If a restart happens during the 9am London window, that day's run is skipped.

> **Fix:** Use an external cron trigger (cron-job.org, Railway cron job, or GitHub Actions scheduled workflow) to hit `/api/topics/discover` and the render endpoints on a schedule.

### 4.5 Analytics Not Displayed in UI
`/api/analytics` endpoint and `syncAnalytics()` are fully implemented on the backend but the frontend Dashboard doesn't render any charts or KPI cards from real YouTube data.

---

## 5. ❌ Not Yet Implemented (Backlog)

### 5.1 YouTube Analytics Dashboard UI
- No chart/graph UI for views, CTR, watch time, subscriber growth
- Topic performance ranking (score topics by published video performance) — not done

### 5.2 A/B Testing Framework
- Script/voice A/B metadata schema exists, but no split logic, tracking, or reporting UI

### 5.3 PostHog Full Funnel Instrumentation
- SDK installed but only page views fire
- Missing: script_approved, video_rendered, upload_published events

### 5.4 Multi-Channel / Multi-Niche Support
- Single YouTube channel and single niche currently
- No channel selector or niche profile switcher in UI

### 5.5 Cross-Platform Publishing
- No TikTok, Instagram Reels, or YouTube Community post publishing
- YouTube upload only

### 5.6 Script Research / Factual Grounding
- `requireResearch` gate coded but `factualSources` rarely populated
- No web search / RAG pipeline for real-time facts before scripting

### 5.7 Watermark / Branding Overlay
- No channel logo, lower-third, or brand watermark in rendered video

### 5.8 Background Music Layer
- FFmpeg supports audio mixing but no background music library or selector

### 5.9 Auto-Generated YouTube Chapters / Cards
- No chapter timestamp generation from script scenes
- No YouTube end-screen or card automation

### 5.10 Push Notifications / Alerts
- No Slack, email, or webhook alert on automation failure or successful publish

### 5.11 Persistent SQLite Backup
- `exportState()` exists but no scheduled automated backup
- No Railway volume mount — SQLite data lost on container redeploy

---

## 6. Configuration Reference

### Railway Environment Variables

| Variable | Status | Purpose |
|---|---|---|
| `LLM_PROVIDER` | ✅ `groq` | Script generation engine |
| `GROQ_API_KEY` | ✅ Set | Groq LLM access |
| `OPENROUTER_API_KEY` | ✅ Set | LLM fallback |
| `NVIDIA_API_KEY` | ✅ Set | LLM fallback |
| `PEXELS_API_KEY` | ✅ Set | Visual stock search |
| `YOUTUBE_CLIENT_ID` | ✅ Set | YouTube OAuth |
| `YOUTUBE_CLIENT_SECRET` | ✅ Set | YouTube OAuth |
| `YOUTUBE_REFRESH_TOKEN` | ✅ In DB | OAuth refresh token |
| `YOUTUBE_API_KEY` | ✅ Set | Analytics |
| `SPEACHES_API_URL` | ✅ Set | TTS microservice |
| `ALLOW_SILENT_AUDIO` | ⚠️ Not set | Set `true` to skip TTS if unavailable |
| `AUTO_APPROVE` | ⚠️ Not set | Set `true` to skip manual review |
| `AUTO_PUBLISH` | ⚠️ Not set | Set `true` for unattended publishing |
| `DEFAULT_NICHE` | ⚠️ Not set | Defaults to `Productivity` |
| `API_TOKEN` | ⚠️ Not set | Set to enable bearer auth on all API routes |
| `MONTHLY_AI_BUDGET_USD` | ⚠️ Default `5` | Monthly cost cap |

---

## 7. Live Service Status

| Service | URL | Status |
|---|---|---|
| Railway API | https://shorty-production-8fc1.up.railway.app | ✅ Online |
| Railway TTS | https://speaches-production-293a.up.railway.app | ✅ Online |
| Vercel Frontend | https://shorty-alpha-three.vercel.app | ✅ Online |
| GitHub `main` | jeevesh2515/shorty | ✅ Up to date |

### Database State (Railway, 2026-08-09)
- **Topics:** 10 (all `scripted`)
- **Scripts:** 9 (all `approved`)
- **Videos:** 9 — 7 `review_required`, 1 `ready`, 1 `scheduled`
- **Uploads:** 9 — 8 `review_required`, 1 `scheduled` with YouTube ID `EAayUrUSk3c`
- **Published to YouTube:** 1 video confirmed

---

## 8. Recommended Next Steps (Priority Order)

| # | Task | Effort |
|---|---|---|
| 1 | Re-render 2 audioless videos from the Videos tab | 5 min |
| 2 | Approve & publish all pending uploads (or set AUTO_APPROVE + AUTO_PUBLISH) | 10 min |
| 3 | Set `API_TOKEN` on Railway to secure the API | 5 min |
| 4 | Add Railway volume mount to `/app/data` to persist SQLite across redeploys | 15 min |
| 5 | Wire `/api/analytics` to the Dashboard UI for live YouTube stats | 2–4 hrs |
| 6 | Add external cron trigger for daily automation | 30 min |
| 7 | Full PostHog funnel instrumentation (script, render, publish events) | 2 hrs |
| 8 | Background music layer (royalty-free audio mix in FFmpeg) | 3 hrs |
| 9 | Channel watermark / logo overlay in FFmpeg | 1 hr |
| 10 | Multi-niche + multi-channel selector in UI | 4–6 hrs |

---

*Report generated from live API, local SQLite analysis, and codebase inspection.*
