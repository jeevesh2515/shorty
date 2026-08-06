# Shorts Autopilot

A low-cost, operator-first YouTube Shorts automation system. Ships fully
working with **zero external credentials**; activates extra capabilities the
moment you paste a single key from `REQUIRED_SECRETS.md`.

## What is implemented

- React + Vite operator dashboard with six pages:
  Dashboard, Topics, Videos, Uploads, Audit log, Settings.
- SQLite repository with foreign keys and a schema migration marker.
- Topic → Script → Video → Upload → Analytics domain chain.
- Audit event log and status-transition validation.
- Idempotent local upload creation.
- Node HTTP API with health/readiness/state/run/automation/audit endpoints.
- Local LLM, visual, TTS, and FFmpeg fallbacks — including a
  dependency-free PNG renderer so the fallback runs wherever FFmpeg runs.
- BYOK adapters for OpenAI, Gemini, YouTube Data/Analytics, Pexels, and
  Speaches-compatible TTS.
- Optional daily scheduler hook.
- Docker deployment with FFmpeg preinstalled.
- Vitest repository/provider/API/workflow tests.

## Minimal-cost local run

```bash
npm install
npm run db:seed
npm run dev:all
```

- Frontend: http://localhost:5173
- API: http://localhost:8787
- API health: http://localhost:8787/api/health
- Provider readiness: http://localhost:8787/api/readiness

Without `VITE_API_URL`, the frontend runs its deterministic local demo. To
connect it to SQLite/API state:

```bash
VITE_API_URL=http://localhost:8787 npm run dev
```

## Production configuration

```bash
cp .env.example .env
# add only the provider keys you want to activate
npm run build
npm run dev:api
```

Or:

```bash
docker compose up -d --build
```

Set `API_TOKEN` in production and use the same authenticated proxy/token
strategy for the frontend. Never put provider keys in `VITE_*` variables.

## Provider modes

- `LLM_PROVIDER=local` — no LLM spend; deterministic fallback.
- `LLM_PROVIDER=openai` — uses `OPENAI_API_KEY` and a low-cost model such as
  `gpt-4o-mini`.
- `LLM_PROVIDER=gemini` — uses `GEMINI_API_KEY` and a Flash model.
- Pexels is optional; without it the renderer creates a dependency-free PNG.
- FFmpeg is local and free (Docker image installs it).
- YouTube requires OAuth client ID/secret plus a refresh token.
  `YOUTUBE_ACCESS_TOKEN` is intentionally not accepted as a refresh-token
  substitute.
- The Speaches/OpenAI-compatible speech endpoint is supported via
  `SPEACHES_API_URL`. Dograh remains the self-hosting/provider orchestration
  option described in the project docs; only `DOGRAH_API_URL` /
  `DOGRAH_API_KEY` are exposed.

## Verification

```bash
npm run build           # TypeScript + Vite + server bundle
npm test                # 5 fast tests (~1 s)
npm run test:full       # 4 slow tests including FFmpeg render (~30 s)
npm run api:smoke       # HTTP smoke against in-memory server
npm run pipeline:smoke  # In-process FFmpeg pipeline including audit + render
npm run docker:validate # Composes the docker-compose surface expectations
```

All of the above run with no secret configuration. Adding `OPENAI_API_KEY`,
`YOUTUBE_CLIENT_ID`, etc. does not change which commands to run — they just
make the corresponding adapter move from local-fallback to live.

## Where this lives in the project

- `01_PRD.md` — original product contract.
- `20_RULES.md` — invariants the codebase enforces.
- `30_ARCHITECTURE.md` — pipeline and entity design.
- `40_DESIGN.md` — operator UX expectations.
- `50_PHASES.md` — phased rollout plan.
- `MEGA_PROMPT.md` — initial entity/page acceptance brief.
- `REQUIRED_SECRETS.md` — the only matrix of required keys.
- `PHASES_IMPLEMENTATION.md` — phase-by-phase status snapshot.
- `PHASE_1_DONE.md` … `PHASE_6_DONE.md` — verification-backed notes per phase.
- `.planning/STATE.md`, `.planning/REQUIREMENTS.md`,
  `.planning/INTEGRATION_MATRIX.md` — internal planning artifacts.
