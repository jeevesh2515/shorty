# Handoff — Shorts Autopilot

**Last verified:** 2026-08-09, against the live API.

Replaces `AGENT_HANDOFF.md` and `PROJECT_STATUS_REPORT.md`, both of which stated API routes
that return 404 and revenue figures roughly 100× too high. Corrections are called out below
so the same mistakes are not repeated.

---

## Live services

| Service | URL | State |
|---|---|---|
| Railway API | https://shorty-production-8fc1.up.railway.app | Online |
| Railway TTS (Speaches) | https://speaches-production-293a.up.railway.app | Online |
| Vercel frontend | https://shorty-alpha-three.vercel.app | Online |

Railway `shorty` service: project `415a9c22-deb1-4973-9397-876a228eeb3d`,
service `29c98b54-3bee-4bba-a825-4ca2e6a6d129`, environment `040d33f6-356a-4251-a6eb-b5a0f2ef336e`.
Speaches service: `939fe5be-8d1b-4266-834b-b2ce66f8f7fe`.

Both `main` pushes auto-deploy to Railway and Vercel.

---

## The database has already been wiped once

On 2026-08-09 the API returned **zero rows across every table** — topics, scripts, videos,
uploads, analytics, audit. The earlier reports describing 9 videos and 9 uploads are
obsolete; that data no longer exists. The container restarted and took the ephemeral
SQLite file with it.

YouTube OAuth survived only because `YOUTUBE_REFRESH_TOKEN` is an environment variable, not
because the DB persisted.

**Nothing is durable until a Railway Volume is mounted at `/app/data`.** The Dockerfile
already sets `DATA_DIR` and `SHORTS_DB_PATH` there, so this needs **no code change** — only
the volume. This is the single highest-priority action.

> Mounting a volume presents an *empty* directory. If the DB has content by then, export it
> first (`GET /api/state`), mount, wait for the automatic redeploy, then `POST /api/state/import`.

---

## API routes (verified)

The old handoff documented `/api/topics/discover` plus `/api/run-manual`. **`/api/run-manual`
does not exist.** The real routes:

```
GET    /api/health
GET    /api/readiness              providers + config + usage
GET    /api/state                  full DB export
POST   /api/state/import

GET    /api/topics                 POST /api/topics
POST   /api/topics/discover        POST /api/topics/cleanup
DELETE /api/topics/:id             PATCH /api/topics/:id/status
POST   /api/topics/:id/script

GET    /api/scripts                POST /api/scripts/:id/judge
PATCH  /api/scripts/:id/status

GET    /api/videos                 POST /api/videos
DELETE /api/videos/:id             POST /api/videos/:id/render
PATCH  /api/videos/:id/assets      attach externally-produced footage
POST   /api/videos/:id/media       ingest a finished MP4 by https URL

GET    /api/uploads                POST /api/uploads
POST   /api/uploads/:id/approve    POST /api/uploads/:id/publish
POST   /api/uploads/:id/retry      DELETE /api/uploads/:id

GET    /api/analytics              POST /api/analytics/sync
GET    /api/audit
PATCH  /api/settings/automation    PATCH /api/settings/auto-publish
POST   /api/runs/manual            POST /api/runs/scheduled   {"force": true}
GET    /api/auth/youtube           GET  /api/auth/youtube/callback
GET    /api/auth/youtube/status    POST /api/auth/youtube/disconnect
GET    /media/:filename
```

### Triggering the daily run

Use `POST /api/runs/scheduled` with `{"force": true}`.

`runScheduled()` refuses to run unless the London hour equals `REVIEW_HOUR_LONDON`. GitHub
Actions cron is UTC-only and routinely runs late, so a fixed UTC schedule silently misses
the window for half the year (GMT vs BST) and on any delayed run. `force` bypasses the gate;
the per-day key still guarantees at most one publish per day.

Note the whole pipeline — discover, script, render, upload — runs **synchronously inside one
request** and takes several minutes. Use a long client timeout. A dropped connection does
not stop server-side work.

---

## Enabling auto-publish

`AUTO_APPROVE` / `AUTO_PUBLISH` can be set two ways:

1. Railway environment variables (durable)
2. `PATCH /api/settings/auto-publish` with `{"autoApprove": true, "autoPublish": true}` —
   takes effect immediately, but lives in the DB, so it dies with the DB until the volume
   is mounted.

`reviewModeActive()` previously forced the first `REVIEW_LIMIT` (10) uploads into review
regardless of `AUTO_APPROVE` — and nothing could leave review without being approved, so it
deadlocked. An explicit auto-approve now short-circuits it.

---

## Revenue expectations — corrected

The previous reports applied **long-form CPM to Shorts**. They are paid from different pools.

| | Previously claimed | Actual |
|---|---|---|
| Rate | "$8–25 CPM" | Shorts RPM **$0.01–0.10**, typically **$0.03–0.07** per 1,000 views |
| Per video @ 10K views | "$80–250" | **$0.30–0.70** |
| 30 videos/month | "$2,400–7,500" | **~$9–21** |
| YPP threshold | "500 subs + 3,000 watch hours" | **1,000 subs + 10M Shorts views in 90 days** (or 4,000 long-form watch hours) |

The 500-subscriber figure is the *fan-funding* tier; it does not unlock ad revenue share.

At 1 Short/day averaging 10K views, 90 days yields ~900K views — roughly 11× short of the
threshold. Running cost is ~$5–10/month on Railway. **Volume is not the lever.** Shorts work
as top-of-funnel for something with real margin, not as direct income.

### Monetisation risk

YouTube's inauthentic-content policy (15 July 2026) explicitly excludes from monetisation
"AI-generated content made with generic or unoriginal templates giving the impression of
mass production" and channels whose videos "feel interchangeable from video to video."
Enforcement is **channel-wide**.

A single template plus stock footage plus one TTS voice on a daily cron is precisely that
profile. `DEFAULT_NICHE` accepts a comma-separated list and rotates daily, and the TTS
service now exposes `rate`/`pitch`/`voice`, so vary them.

---

## Gotchas worth knowing

| Area | Detail |
|---|---|
| **edge-tts word timings** | v7+ defaults to `boundary="SentenceBoundary"` and emits **zero** word events. Audio looks perfect, timings come back empty and captions silently fall back to estimates. Always pass `boundary="WordBoundary"`. |
| **ASS colours** | Style fields are `&HAABBGGRR` with no trailing `&`; inline `\c` overrides are `&HBBGGRR&` with one. Byte-reversed from HTML hex. |
| **Render intermediates** | Every render used to leave ~240MB of scene clips and stitched masters behind permanently. `cleanupRenderIntermediates()` now removes them; `KEEP_RENDER_INTERMEDIATES=true` retains them for debugging. |
| **API is unauthenticated** | `API_TOKEN` is unset, so anyone with the URL can publish to the channel, burn LLM quota or delete data. Note that `vercel.json` rewrites cannot inject an auth header, so the browser app needs `VITE_API_TOKEN` — which is not secret in a public bundle. |
| **Speaches builder** | Railway defaults to Railpack and will run the Node server instead of the Python service unless `services/speaches/railway.json` pins the Dockerfile builder. |

---

## Current priorities

1. **Mount the Railway volume at `/app/data`** — everything else is temporary until this lands
2. Set `AUTO_APPROVE=true`; keep `AUTO_PUBLISH=false` until a hand-checked video passes
3. Add the daily GitHub Actions workflow against `/api/runs/scheduled` with `{"force": true}`
4. Decide on API authentication
5. Wire `/api/analytics` into the dashboard UI
6. Vary niche, voice and hook structure before raising the publish rate
