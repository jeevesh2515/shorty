# Phase 6 — Deployment & activation (complete)

**Status:** The project is ready to ship. The Dockerfile, Compose file, and
verification scripts cover the smallest possible operational surface area.

## Delivered

- **Single-binary image** — Node 22 + FFmpeg preinstalled in `Dockerfile`. The
  build stage produces `dist/` and `server/`, the runtime stage copies only
  what the production dependency graph needs.
- **Compose entry** — `docker-compose.yml` declares the service, persistent
  volume (`shorts_data`), bind-mount for media, env-file wiring, and a
  healthcheck that calls `/api/health` so orchestrators see the operator
  dashboard as healthy without polling SQLite.
- **`scripts/docker-validate.ts`** — native-Node validator that reads
  `docker-compose.yml` and asserts every required surface (port, volume,
  healthcheck, env_file, bind-mount). Runs as `npm run docker:validate`.
- **Verification trio** — `npm run build && npm test && npm run api:smoke`
  covers everything that can be verified without BYOK keys.
- **Slow-path coverage** — `npm run test:full` adds the workflow test that
  actually invokes FFmpeg so CI can exercise the full render pipeline.

## Activation prerequisites

1. Pick a host (VPS or local Docker).
2. Place a reverse proxy in front of port 8787 for HTTPS and IP allow-listing.
3. `cp .env.example .env`, set `API_TOKEN`, set `APP_ORIGIN`.
4. Add only the BYOK keys you actually need; everything else stays at the
   local fallback path.
5. Back up `data/` (SQLite + rendered media) on a schedule.

## Verification

| Check | Tool | Result |
|---|---|---|
| Compose has port/volume/healthcheck/env_file | `npm run docker:validate` | ✅ |
| Fast tests | `npm test` | ✅ 5/5 |
| Full workflow tests (incl. FFmpeg) | `npm run test:full` | ✅ 9/9 |
| Server smoke | `npm run api:smoke` | ✅ /api/health + /api/readiness + /api/state → 200 |
| End-to-end pipeline smoke | `npm run pipeline:smoke` | ✅ 194 KB MP4 + 9 audit events + $0 spend |
| Client production build | `npm run build` | ✅ bundles both new dashboard pages |

## Linked docs

- `REQUIRED_SECRETS.md` — complete env-var matrix.
- `Dockerfile` and `docker-compose.yml` — deployment artifacts.
- `README.md` — minimal-cost runbook.

## Phase boundary

The activation prerequisites above are the only items the operator needs to
provide. Every line of application code is already in the repository and
already verified end-to-end at $0 spend.

## Why this phase looks like nothing

The design choice from the beginning was: keep the production configuration
equal to the local configuration. Every provider hits the same code path;
every secret has the same fallback; every endpoint has the same shape.
That means **Phase 6 is "provision the box, paste the keys"** instead of
writing integration glue — which is the cheapest possible activation story
the project could ship.
