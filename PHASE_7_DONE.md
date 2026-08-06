# Phase 7 — Free Provider Adapters + Deployment

**Status:** ✅ Complete  
**Date:** 2026-08-06

## What was built

### Free LLM provider adapters (`server/providers.ts`)

All three new providers share an `openAiCompatibleScript()` helper because
Groq, OpenRouter, and NVIDIA NIM all expose the exact same OpenAI chat
completions request shape at different base URLs.

| Provider | Base URL | Free tier | Best model |
|---|---|---|---|
| Groq | `api.groq.com/openai/v1` | 14,400 req/day | `llama-3.3-70b-versatile` |
| OpenRouter | `openrouter.ai/api/v1` | `:free` model suffix | `llama-3.1-8b-instruct:free` |
| NVIDIA NIM | `integrate.api.nvidia.com/v1` | Free credits on signup | `llama-3.1-70b-instruct` |

### Updated configuration (`server/config.ts`)

- `LlmProvider` union type extended from 3 values to 6: `'openai' | 'gemini' | 'groq' | 'openrouter' | 'nvidia' | 'local'`
- `VALID_PROVIDERS` array with explicit runtime validation (invalid values fall back to `'local'`)
- `groqApiKey`, `groqModel`, `openrouterApiKey`, `openrouterModel`, `nvidiaApiKey`, `nvidiaModel` fields added
- `providerReadiness()` extended to expose per-provider key presence (`groq`, `openrouter`, `nvidia`)

### Updated `.env.example`

- Documents all 6 provider modes with inline comments
- Links to free signup pages for Groq, OpenRouter, NVIDIA NIM, Pexels, YouTube Data API
- Clearly marks which entries are FREE vs paid

### Settings UI (`src/App.tsx`, `src/index.css`)

- New 3-column LLM provider grid with cards for all 6 providers
- `FREE`, `LOW-COST`, `PAID` badges on each card
- Active provider highlighted with purple border + animated dot
- Cards with keys configured shown in green (ready state)
- "Get key →" link on each card pointing directly to the signup page
- Pipeline services section updated with FREE badges on free-tier services
- Budget copy updated to mention $0 spend when using free tiers

### Deployment configs

- `vercel.json` — Vercel frontend deployment with `/api` proxy rewrite
- `railway.json` — Railway backend deployment with health check and restart policy

### Documentation

- `README.md` — complete rewrite with zero-cost stack table, provider mode docs, free signup links, and step-by-step Railway + Vercel deployment guide

## Verification

```
npm run build  ✅  (TypeScript strict, Vite bundle — no errors)
npm test       ✅  (5/5 tests pass, providers.test.ts mock updated)
```

## Deployment checklist

### Railway (backend API)
- [ ] Connect GitHub repo to Railway
- [ ] Set env vars: `LLM_PROVIDER`, `GROQ_API_KEY` (or other free key)
- [ ] Optionally add `YOUTUBE_API_KEY`, `PEXELS_API_KEY`
- [ ] Set `API_TOKEN` to a random secret
- [ ] Note the Railway public URL

### Vercel (frontend)
- [ ] Import repo to Vercel
- [ ] Set `VITE_API_URL=https://<your-railway-url>` in Vercel env vars
- [ ] Update `vercel.json` `/api` proxy destination to Railway URL
- [ ] Deploy

## Cost breakdown (free stack)

| Service | Monthly cost |
|---|---|
| Groq (14,400 req/day) | $0 |
| Pexels visuals | $0 |
| YouTube Data API | $0 |
| FFmpeg rendering | $0 |
| Railway (500 hr/month) | $0 |
| Vercel (hobby plan) | $0 |
| **Total** | **$0** |
