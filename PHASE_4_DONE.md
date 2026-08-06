# Phase 4 — Automation & publishing (complete)

**Status:** The publishing and automation seams are live. They activate the
moment you drop a `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` /
`YOUTUBE_REFRESH_TOKEN` triple into `.env`. Until then the API marks every
upload as `scheduled` with a stable idempotency key so retries are safe.

## Delivered

- **YouTube OAuth refresh-token flow** — `youtubeAccessToken` exchanges the
  configured refresh token for a short-lived access token at request time;
  never reads `YOUTUBE_ACCESS_TOKEN` so a stale access token can never slip
  into the system.
- **Multipart `videos.insert` upload** — streams the rendered MP4 plus the
  snippet + status JSON in a single request, with `publishAt` set when
  `scheduledAt` is provided so the upload lands on YouTube's scheduler.
- **Idempotency** — every upload is identified by
  `stableIdempotencyKey([videoId, title, scheduledAt])`; the `uploads`
  table has a UNIQUE constraint on it, and `createUpload` returns the
  existing record instead of duplicating it.
- **Daily scheduler** — `ENABLE_SCHEDULER=true` boots an in-process
  `setInterval` whose first run writes `scheduled:YYYY-MM-DD:running` and then
  `complete` after the manual run succeeds; `runScheduled` short-circuits if
  either the per-day key already says `complete` or `automation_paused` is on.
- **Retry routes** — `/api/uploads/<id>/retry` calls into `publishUpload`
  again, which is itself a no-op once `youtubeVideoId` is set; failed uploads
  are restored to `scheduled` from the operator UI.
- **Audit hooks** — `failed` transitions write an audit event with the error
  message so the operator can grep without leaving the dashboard.

## Verification

| Check | Tool | Result |
|---|---|---|
| `runScheduled` is a no-op when paused | `tests/workflow.test.ts` | ✅ |
| `runScheduled` is a no-op when the day is complete | `tests/workflow.test.ts` | ✅ |
| Idempotent upload re-create | `tests/workflow.test.ts` | ✅ |
| Schedule window respected | `npm run build` + `scripts/pipeline-smoke.ts` | ✅ |

## Linked docs

- `30_ARCHITECTURE.md` — workflow + idempotency invariants.
- `REQUIRED_SECRETS.md` — OAuth scopes and refresh-token expectations.
- `PHASES_IMPLEMENTATION.md` — Phase 4 status snapshot.

## Activation prerequisites

Add the OAuth triple, pick a niche in `DEFAULT_NICHE`, and set
`ENABLE_SCHEDULER=true`. The Docker image already wires the
`SHORTS_DB_PATH` and `MEDIA_DIR` volumes so the same code runs unchanged in
either local or production mode.
