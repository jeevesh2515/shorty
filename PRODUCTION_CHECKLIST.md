# Shorty — Production Checklist

**Goal:** Make Shorty durable and sellable as a single-operator / early SaaS product.

Last updated: 2026-08-13

---

## P0 — Do these before any paid user

### 1. Mount Railway volume at `/app/data`

Without this, SQLite + rendered media disappear on every redeploy.

1. Railway dashboard → `shorty` service → **Volumes**
2. Add volume, mount path: `/app/data`
3. Confirm env vars (already set in Dockerfile):
   - `DATA_DIR=/app/data`
   - `SHORTS_DB_PATH=/app/data/shorts-autopilot.sqlite`
   - `MEDIA_DIR=/app/data/media`
4. **If DB already has data:** export first:
   ```bash
   curl -H "Authorization: Bearer $API_TOKEN" \
     https://shorty-production-8fc1.up.railway.app/api/state > state-backup.json
   ```
   After volume mounts and service restarts:
   ```bash
   curl -X POST -H "Authorization: Bearer $API_TOKEN" \
     -H "Content-Type: application/json" \
     --data @state-backup.json \
     https://shorty-production-8fc1.up.railway.app/api/state/import
   ```

### 2. Enable API authentication

Code already supports `API_TOKEN`. It was just unset in production.

**Backend (Railway):**
```bash
# Generate a strong token
openssl rand -hex 32
```
Set `API_TOKEN=<that value>` in Railway env vars.

**Frontend (Vercel):**
Set `VITE_API_TOKEN` to the **same** value, then redeploy Vercel so the client sends `Authorization: Bearer ...`.

> Note: `VITE_*` values are visible in the browser bundle. This is acceptable for a single-operator tool (shared secret). For multi-tenant SaaS, move to session cookies / JWT issued after login.

**Public routes (no token required):**
- `GET /api/health` — monitors / uptime
- YouTube OAuth start + callback

Everything else under `/api/*` requires the Bearer token when `API_TOKEN` is set.

### 3. Verify after deploy

```bash
# Health is public
curl https://shorty-production-8fc1.up.railway.app/api/health

# Protected route should 401 without token
curl https://shorty-production-8fc1.up.railway.app/api/topics

# With token should succeed
curl -H "Authorization: Bearer $API_TOKEN" \
  https://shorty-production-8fc1.up.railway.app/api/topics
```

---

## P1 — Reliability & autonomy

- [ ] GitHub Actions daily cron → `POST /api/runs/scheduled` with `{"force": true}`
- [ ] Set `AUTO_APPROVE=true` only after reviewing first 3–5 renders by hand
- [ ] Keep `AUTO_PUBLISH=false` until one hand-checked video is published successfully
- [ ] Wire analytics into dashboard UI
- [ ] Vary `DEFAULT_NICHE` (comma-separated) and TTS voice/rate to reduce “mass produced AI” risk

---

## P2 — Toward sellable SaaS

- [ ] Multi-channel / workspace model
- [ ] Usage metering + Stripe billing
- [ ] Proper session auth (replace shared `VITE_API_TOKEN`)
- [ ] Monitoring (errors, failed renders, quota exhaustion)
- [ ] Content quality score + reject low-effort scripts automatically

---

## Revenue expectations (realistic)

Shorts RPM is typically **$0.03–0.07 per 1k views**. Treat Shorty as:
1. A **subscription product** for creators/agencies, or
2. A **top-of-funnel** system for higher-margin products

Do not plan on direct YouTube ad revenue alone.
