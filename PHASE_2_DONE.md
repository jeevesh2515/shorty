# Phase 2 — Core logic & backend (complete)

**Status:** The Node API, SQLite repository, and HTTP service are in place.
Every operator action from Phase 1 has a corresponding server route, idempotent
mutation, and audit event.

## Delivered

- Node + TypeScript HTTP service in `server/` exposing `/api/health`,
  `/api/readiness`, `/api/state`, plus entity-specific routes:
  topics (CRUD, status patch, discover, script generation),
  scripts (list, status patch), videos (create, render), uploads (create,
  publish, retry), analytics (list, sync), audit (list), automation
  (pause / resume), runs (manual, scheduled).
- SQLite schema with foreign keys, a single-shot migration marker
  (`schema_migrations`), and indexes on the hot read paths.
- `ShortsDatabase` repository that validates inputs, enforces the documented
  status transitions on Topic/Script/Video/Upload, and writes an audit event for
  every create/status-change.
- Bearer-token (`API_TOKEN`) and origin (`APP_ORIGIN`) hardening for private
  deployments; both stay off by default so local dev is one command away.
- Path-safe media serving (`/media/<file>` with traversal guard), no-cache JSON
  responses, request-size limit (`MAX_BODY_BYTES`), and a sanitized error
  envelope that maps `DomainError` instances to the right HTTP status code.
- `npm run api:smoke` script that boots an in-memory server and curls the three
  readiness endpoints.

## Verification

| Check | Tool | Result |
|---|---|---|
| Repository transitions | `tests/db.test.ts` | ✅ 2/2 |
| HTTP readiness/state | `tests/http.test.ts` | ✅ 1/1 |
| Smoke endpoint trio | `npm run api:smoke` | ✅ 200 on health, readiness, state |
| Strict server build | `npm run build` | ✅ passes |

## Linked docs

- `30_ARCHITECTURE.md` for the data model that this phase wires into SQLite.
- `20_RULES.md` for the cost/status invariants that the repository enforces.

## Known phase boundary

Phase 2 wires adapters in `server/providers.ts` for LLM/Youtube/Pexels/TTS,
but all of them currently route to local-fallback implementations. Phase 3
turns those adapters on for any operator who supplies the corresponding
BYOK secret.
