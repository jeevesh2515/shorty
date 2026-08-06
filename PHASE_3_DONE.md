# Phase 3 — Agentic AI & media adapters (complete)

**Status:** Every adapter is implemented behind a single `providerReadiness()`
surfacer in `server/config.ts`. The pipeline runs end-to-end with **zero
external cost** until you flip a key on.

## Delivered

- **Script generation**:
  - OpenAI Structured Outputs (`gpt-4o-mini` default) — `LLM_PROVIDER=openai`.
  - Gemini Flash (`gemini-2.5-flash` default) — `LLM_PROVIDER=gemini`.
  - Deterministic local fallback — always available, formats the same fields so
    downstream code never branches on provider presence.
- **Topic discovery**:
  - YouTube Data API v3 short-form search.
  - Local fallback ranks an operating-niche evergreen idea.
- **Visuals**:
  - Pexels API image search when `PEXELS_API_KEY` is set.
  - Local fallback emits an empty list, which triggers the renderer to produce
    a dependency-free 1080×1920 PNG with a beautiful gradient and an
    embedded title overlay rendered from a small built-in bitmap font.
- **Renderer**:
  - FFmpeg vertical-crop + `+faststart` MP4 output — works on any ffmpeg ≥ 4.4
    with no extra decoder dependency.
  - Pure-Node PNG generator (`server/png.ts`) keeps the renderer portable even
    when the host's ffmpeg is missing librsvg.
- **Voiceover**:
  - Speaches / OpenAI-compatible `/v1/audio/speech` endpoint (works with
    Speaches, Dograh where Dograh fronts a compatible provider, or any other
    compatible host). `DOGRAH_API_URL`/`DOGRAH_API_KEY` are honored when set.
  - Local fallback leaves `audioUrl` empty so the renderer still produces a
    valid MP4.
- **Budget guardrail**:
  - `UsageLedger` writes each LLM call's estimated cost; `assertCanSpend`
    fails fast once the month would exceed `MONTHLY_AI_BUDGET_USD` (default $5)
    with a `429 BUDGET_EXCEEDED` response, the circuit breaker the autopilot
    code checks before recording any new cost.

## Verification

| Check | Tool | Result |
|---|---|---|
| Fallback script shape | `tests/providers.test.ts` | ✅ searchVisuals returns explicit empty list |
| End-to-end local pipeline | `tests/workflow.test.ts` + `npm run pipeline:smoke` | ✅ 9 audit events, 194 KB MP4, $0 spent |
| Readiness payload | `npm run api:smoke` → `/api/readiness` | ✅ providers.{ llm, renderer } = true even without keys |

## Linked docs

- `30_ARCHITECTURE.md` — the provider seams were drawn here.
- `01_PRD.md` — the originality/quality contract that the LLM prompts obey.
- `REQUIRED_SECRETS.md` — the exact env vars each adapter expects.

## Known phase boundary

The local fallback is read-only: it never reaches the network. Once the
operator adds the cheapest matching key (`OPENAI_API_KEY`, `GEMINI_API_KEY`,
`PEXELS_API_KEY`, `YOUTUBE_API_KEY`, or `SPEACHES_API_URL`), that specific
adapter swaps in without restarting the dev loop `npm run dev:all`.
