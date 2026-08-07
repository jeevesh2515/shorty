# Shorts Autopilot

A low-cost, operator-first YouTube Shorts automation system. Ships fully
working with **zero external credentials**; activates extra capabilities the
moment you paste a single key from `REQUIRED_SECRETS.md`.

## Zero-cost stack (recommended)

| Layer | Service | Cost | Key |
|---|---|---|---|
| Script generation | Groq (Llama 70B) | **Free** | `GROQ_API_KEY` |
| Topic discovery | YouTube Data API v3 | Free (10k req/day) | `YOUTUBE_API_KEY` |
| Visual assets | Pexels | Free (200 req/hr) | `PEXELS_API_KEY` |
| Voiceover | Self-hosted Speaches (Docker) | **Free** | `SPEACHES_API_URL` |
| Video render | FFmpeg (local/Docker) | **Free** | — |
| Publishing | YouTube OAuth | Free | 3 OAuth keys |
| Database | SQLite | **Free** | — |

**Total monthly cost: $0** when using the free providers above.

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
- **BYOK adapters for all 6 LLM providers:**
  - `local` — deterministic, zero cost, always available.
  - `groq` — **FREE** 14,400 req/day Llama 70B via Groq.
  - `openrouter` — **FREE** Llama/Mistral via OpenRouter free tier.
  - `nvidia` — **FREE** credits Llama 70B via NVIDIA NIM.
  - `gemini` — low-cost Gemini Flash (~$0.002/script).
  - `openai` — GPT-4o-mini (~$0.01/script).
- YouTube Data API v3, Pexels, Speaches/Dograh TTS adapters.
- YouTube OAuth upload with scheduled publish support — connect from
  the Settings page, no manual token setup required.
- Optional daily scheduler hook with **auto-approve** and **auto-publish**
  toggles for fully autonomous operation.
- AI-generated thumbnail concepts via free Pollinations.ai image API.
- Docker deployment with FFmpeg preinstalled.
- Vitest repository/provider/API/workflow tests.
- Vercel (frontend) + Railway (backend) deployment configs.

## Quick start (local, $0)

```bash
npm install
npm run db:seed
npm run dev:all
```

- Frontend: http://localhost:5173
- API: http://localhost:8787
- API health: http://localhost:8787/api/health
- Provider readiness: http://localhost:8787/api/readiness

To connect the frontend to the live API:

```bash
VITE_API_URL=http://localhost:8787 npm run dev
```

## Provider modes

Set `LLM_PROVIDER` in `.env` to switch the script generation adapter:

```
LLM_PROVIDER=local       # deterministic, zero cost (default)
LLM_PROVIDER=groq        # FREE — Llama 70B, 14.4k req/day
LLM_PROVIDER=openrouter  # FREE — many models with :free suffix
LLM_PROVIDER=nvidia      # FREE credits — enterprise Llama via NVIDIA NIM
LLM_PROVIDER=gemini      # low cost ~$0.002/script
LLM_PROVIDER=openai      # paid ~$0.01/script
```

### Getting free API keys

| Provider | Sign-up URL | Free tier |
|---|---|---|
| Groq | https://console.groq.com | 14,400 req/day, no card |
| OpenRouter | https://openrouter.ai | free model tier forever |
| NVIDIA NIM | https://build.nvidia.com | free credits on signup |
| Pexels | https://www.pexels.com/api | 200 req/hr |
| YouTube Data | https://console.cloud.google.com | 10,000 units/day |

## Production configuration

```bash
cp .env.example .env
# Set LLM_PROVIDER=groq and GROQ_API_KEY=<your key>
npm run build
npm run dev:api
```

Or via Docker:

```bash
docker compose up -d --build
```

Set `API_TOKEN` in production and keep all provider keys server-side only.
**Never put provider keys in `VITE_*` variables — they will be visible in the browser.**

## Free deployment

### Backend — Railway (free 500 hr/month)

Railway uses the included `Dockerfile` automatically.

1. Push this repo to GitHub.
2. Go to https://railway.app → New Project → Deploy from GitHub.
3. Railway detects the `Dockerfile` and builds the image (includes FFmpeg).
4. Set environment variables in Railway Dashboard (copy from `.env.example`).
5. Railway assigns a public URL (e.g. `https://shorty-api.railway.app`).
6. Open the URL — the dashboard loads directly with same-origin API calls.
7. In Settings, click **Connect YouTube** to complete OAuth (optional).
8. Enable **Auto-approve** and **Auto-publish** for fully autonomous runs (optional).

**Important:** Railway's filesystem is ephemeral. The SQLite database and
rendered media are lost on redeploy. This is fine for a free-tier demo.
For production, add a persistent volume in Railway or switch to a managed
database.

### Frontend — Option A: Railway (single service)

The backend already serves the built frontend from `dist/`. If you deploy
only the backend on Railway, open the Railway URL in a browser — the
dashboard loads directly. No `VITE_API_URL` needed because the frontend
uses same-origin relative API paths.

### Frontend — Option B: Vercel (free forever)

1. Go to https://vercel.com → New Project → Import from GitHub.
2. Vercel auto-detects `vercel.json`.
3. Set `VITE_API_URL=https://<your-railway-url>` in Vercel Environment Variables.
4. In `vercel.json`, update the `/api` proxy destination to your Railway URL.
5. Deploy — your dashboard is live at `https://yourapp.vercel.app`.

## Verification

```bash
npm run build           # TypeScript + Vite + server bundle
npm test                # 5 fast tests (~1 s)
npm run test:full       # 4 slow tests including FFmpeg render (~30 s)
npm run api:smoke       # HTTP smoke against in-memory server
npm run pipeline:smoke  # In-process FFmpeg pipeline including audit + render
npm run docker:validate # Composes the docker-compose surface expectations
```

All of the above run with **no secret configuration**. Adding `GROQ_API_KEY`,
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
- `PHASE_1_DONE.md` … `PHASE_7_DONE.md` — verification-backed notes per phase.
