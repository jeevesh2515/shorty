# Phase 5 — Analytics & optimization (complete)

**Status:** The dashboard now exposes both readiness and audit data, and the
analytics sync path is wired through YouTube Data API v3 with the documented
YouTube Analytics limits surfaced honestly.

## Delivered

- **Analytics repository** — `upsertAnalytics` is the single source of truth
  for view/like/comment snapshots and records nothing the upstream API did not
  return.
- **`/api/analytics/sync`** — calls `fetchYouTubeAnalytics` which only requests
  `videos.list?part=statistics`. Average-view-duration, swipe-away rate,
  subscriber gain, and revenue are intentionally **left at zero** when the
  YouTube Analytics report dimensions are unavailable, so the dashboard
  cannot lie about unsubstantiated numbers.
- **Readiness payload** — `GET /api/readiness` already returns:
  - `providers.{ llm, youtube, youtubeSearch, dograh, visuals, renderer }`
  - `config.{ llmProvider, monthlyAiBudgetUsd, automationPaused }`
  - `usage.{ month, spentUsd, budgetUsd, remainingUsd }`
- **Operator UI** — two new pages that consume exactly that surface:
  - **Settings** shows one card per provider (green when ready, amber when
    awaiting the secret you paste next), a budget bar that flips red when
    spend exceeds 80% of the cap, and a runbook with the smallest-still-
    missing secrets.
  - **Audit log** shows the most recent 100 events from the audit table with
    status badges so a single failed job is traceable from creation through
    failure through retry.

## Verification

| Check | Tool | Result |
|---|---|---|
| End-to-end pipeline records audit events | `npm run pipeline:smoke` | ✅ 9 events |
| Readiness surface exposes budget | `GET /api/readiness` smoke | ✅ `{ spentUsd: 0, budgetUsd: 5, remainingUsd: 5 }` |
| Frontend renders the new pages | `npm run build` | ✅ bundles Settings + Audit pages |

## Linked docs

- `40_DESIGN.md` — operator UX requirements that this phase surfaces.
- `PHASES_IMPLEMENTATION.md` — Phase 5 status snapshot.

## Phase boundary

Until you turn on the YouTube Analytics report dimensions in Google API
Console, advanced KPIs (avg view duration, swipe-away rate, subscriber gain,
revenue) stay at 0 — the implementation never fabricates data. Once those
report dimensions are enabled, extending the analytics fetcher to call the
YouTube Analytics API is a single function in `server/providers.ts`.
