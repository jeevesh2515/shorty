# Shorts Autopilot — Phase Completion

This file is the single source of truth for "what is done". Each phase has a
companion `PHASE_<n>_DONE.md` that lists deliverables and the verification that
backs them.

## Phase 1 — Operator workspace: complete

- Responsive dashboard shell and four new pages on top of the originals
  (Topics, Videos, Uploads, Audit log, Settings).
- Five entity views and linked detail drawers.
- Filters, status badges, alerts, manual run, pause/resume, retries, resync,
  and persistence (LocalStorage when no API; SQLite when `VITE_API_URL` is
  set).
- See [`PHASE_1_DONE.md`](PHASE_1_DONE.md).

## Phase 2 — Core backend: complete

- Node HTTP API under `server/`.
- SQLite schema with foreign keys and a versioned migration marker.
- Repository methods for all five entities.
- JSON validation, status transitions, idempotency keys, audit events.
- Request-size limit, configurable bearer token, origin-aware CORS, path-safe
  media serving.
- Vitest coverage for repository, providers, HTTP readiness/state, and the
  workflow local-fallback pipeline (now including FFmpeg).
- See [`PHASE_2_DONE.md`](PHASE_2_DONE.md).

## Phase 3 — AI/media adapters: complete in BYOK/fallback form

- Local deterministic script fallback.
- OpenAI and Gemini structured-generation adapters.
- Pexels visual adapter.
- Speaches/OpenAI-compatible TTS adapter; Dograh URL/key kept as
  orchestration/auth config.
- **New**: dependency-free PNG renderer (`server/png.ts`) so the local
  fallback does not require librsvg.
- **New**: `scripts/pipeline-smoke.ts` confirms the full pipeline produces a
  real rendered MP4 + 9 audit events + $0 spend.
- Provider readiness and monthly usage ledger/budget guard.
- See [`PHASE_3_DONE.md`](PHASE_3_DONE.md).

## Phase 4 — Publishing/automation: complete in code

- YouTube OAuth refresh-token exchange.
- Multipart `videos.insert` upload and future scheduling metadata.
- Statistics sync endpoint.
- Daily scheduler hook with date idempotency key and pause setting.
- Failed job audit events and retry routes.
- See [`PHASE_4_DONE.md`](PHASE_4_DONE.md).

## Phase 5 — Analytics/optimization: core complete + new UI

- Analytics repository and sync path.
- Dashboard API mode reads persisted analytics.
- Usage budget status is available from readiness.
- **New**: Settings page in the UI surface reads `/api/readiness` and renders a
  per-provider card plus a budget bar.
- **New**: Audit log page renders the most recent 100 events from `/api/audit`.
- See [`PHASE_5_DONE.md`](PHASE_5_DONE.md).

## Phase 6 — Deployment: implementation complete

- Dockerfile, Docker Compose, `.env.example`, static frontend serving, API
  auth/origin controls, persistent volume assumptions, and runbook are
  present.
- **New**: `npm run docker:validate` script asserts the compose file's
  required surface (port, volume, env_file, healthcheck, media bind mount,
  restart policy) without needing `docker` installed.
- **New**: `npm run pipeline:smoke` script runs the full local pipeline
  end-to-end with FFmpeg to confirm the operator activates the same code path
  in production.
- **New**: `npm run test:full` runs the slow workflow tests (FFmpeg included)
  separately from the fast `npm test`.
- See [`PHASE_6_DONE.md`](PHASE_6_DONE.md).

## What is left for the operator

Add only the BYOK secrets described in [`REQUIRED_SECRETS.md`](REQUIRED_SECRETS.md).
Each one lights up exactly one adapter without any other code change. The
pipeline never spends more than `MONTHLY_AI_BUDGET_USD` per month, and the
circuit-breaker pauses automation at the same threshold.

## Runbook

```bash
cp .env.example .env             # fill in only what you want to activate
npm install
npm run build                    # strict TypeScript + Vite + server build
npm test                         # 5 fast tests
npm run test:full                # 4 slow tests including FFmpeg
npm run api:smoke                # HTTP smoke against in-memory server
npm run pipeline:smoke           # full local fallback pipeline with FFmpeg
npm run docker:validate          # asserts compose.yml surface
npm run dev:all                  # API (8787) + Vite (5173) in one process
```

For a single Node deployment:

```bash
node --import tsx server/index.ts
```

For Docker:

```bash
cp .env.example .env
docker compose up -d --build
```
