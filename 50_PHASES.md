# Phases – Shorts Autopilot

## Phase 0 — Preparation
**Status: complete.** Product contract, provider choices, cost rules, secret boundaries, and graph map are documented in `01_PRD.md`, `20_RULES.md`, `30_ARCHITECTURE.md`, `40_DESIGN.md`, and the `.planning/` artifacts.

## Phase 1 — Operator workspace UI
**Status: complete.** React/Vite frontend, six pages (Dashboard, Topics, Videos, Uploads, Audit log, Settings), five entities, detail views, filters, alerts, retries, pause/resume, and demo workflow are implemented and verified. See [`PHASE_1_DONE.md`](PHASE_1_DONE.md).

## Phase 2 — Core logic & backend
**Status: complete.** Node API, SQLite repository, foreign keys, migration marker, validation, status transitions, idempotency, audit events, health/readiness, request limits, and API smoke/tests are implemented. See [`PHASE_2_DONE.md`](PHASE_2_DONE.md).

## Phase 3 — Agentic AI and media adapters
**Status: complete in provider-ready form.** Local fallback plus OpenAI/Gemini, YouTube discovery, Pexels, Speaches-compatible TTS, a dependency-free PNG visual, and FFmpeg rendering are implemented behind server adapters. Only external account configuration remains for live calls. See [`PHASE_3_DONE.md`](PHASE_3_DONE.md).

## Phase 4 — Automation and publishing
**Status: complete in provider-ready form.** Scheduler hook, pause setting, date idempotency, YouTube OAuth refresh flow, upload/schedule metadata, failure audit, and retry routes are implemented. Live upload testing requires a YouTube channel OAuth configuration. See [`PHASE_4_DONE.md`](PHASE_4_DONE.md).

## Phase 5 — Analytics and optimization
**Status: complete.** Analytics repository and sync path, `/api/readiness`/`/api/audit` exposed to the operator via the new **Settings** and **Audit log** pages. Full retention/swipe-away/subscriber/revenue dimensions require the YouTube Analytics report configuration and a real channel. See [`PHASE_5_DONE.md`](PHASE_5_DONE.md).

## Phase 6 — Deployment and activation
**Status: implementation complete; activation pending environment.** Dockerfile, Docker Compose, `.env.example`, static frontend serving, API auth/origin controls, persistent volume assumptions, runbook, `npm run docker:validate`, `npm run pipeline:smoke`, and `npm run test:full` are present. See [`PHASE_6_DONE.md`](PHASE_6_DONE.md).

## Where the operator is right now

1. The codebase is fully wired; every phase can be exercised locally without
   any external credential.
2. `npm run build && npm test && npm run test:full && npm run api:smoke &&
   npm run pipeline:smoke && npm run docker:validate` is the single command
   sequence that proves a fresh checkout works.
3. The remaining operator setup is exactly what `REQUIRED_SECRETS.md`
   describes — paste the smallest set of BYOK keys, restore from a SQLite
   backup, brief is shipped.

## Minimal-cost principles

- No Base44 / no SaaS runtime dependency is required by this repository.
- Local SQLite, local PNG fallback, local SVG, local FFmpeg, and local
  deterministic script generation cost nothing.
- External spend is limited to BYOK provider usage under a monthly budget
  ledger; the default cap is `$5/month` and automation pauses at the cap.
