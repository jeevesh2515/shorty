# Shorts Autopilot — Roadmap

## Phase 0 — Product contract and local foundation
**Goal:** Make the project traceable and runnable before provider work begins.

Deliverables:
- Canonical project docs in `.planning/`
- React/Vite scaffold
- Domain types and seed data
- Graphify project map
- Local persistence and clear provider boundary

Exit criteria:
- `npm run build` passes
- `graphify-out/` contains a graph and report

## Phase 1 — Operator workspace UI
**Goal:** Ship the complete responsive operator experience from the brief.

Deliverables:
- Sidebar shell and navigation
- Dashboard, Topics, Videos, Uploads views
- Detail drawers/views and relational joins
- Filters, sorting, badges, empty/error states
- Manual run, pause, reject, retry, resync, and re-upload interactions

Exit criteria:
- No dead controls in the local demo
- All REQ-UX, REQ-DASH, REQ-TOPIC, REQ-VIDEO, and REQ-UPLOAD criteria met

## Phase 2 — Domain service and persistence hardening
**Goal:** Move workflow mutations from view code into testable domain services.

Deliverables:
- Repository interface for the five entities
- LocalStorage persistence with migrations/versioning
- Idempotent pipeline state machine
- Audit/event log for status transitions
- Validation and error contracts

Exit criteria:
- Reload preserves data and recovery state
- Retry cannot duplicate a local upload
- Unit/integration test coverage for transitions and joins

## Phase 3 — AI and media provider adapters
**Goal:** Replace local generation with secure server-side adapters.

Deliverables:
- LLM topic and script adapter
- Dograh voiceover adapter
- Stock/AI visual adapter
- Render adapter
- Secret/config validation
- Human approval checkpoints

Exit criteria:
- A manual run can complete with configured providers
- Provider failure maps to recoverable entity status
- Secrets never reach the browser

## Phase 4 — YouTube publishing and automation
**Goal:** Run the pipeline on a schedule with safe publishing.

Deliverables:
- YouTube OAuth/token refresh
- Upload and scheduled publish adapter
- Idempotency keys and duplicate prevention
- Recurring daily trigger
- Retry/backoff and operational logs
- Pause/resume automation controls

Exit criteria:
- One approved Short can publish or schedule
- Re-running a job cannot create duplicate YouTube uploads
- Failed jobs can be retried from the operator UI

## Phase 5 — Analytics and optimization loop
**Goal:** Turn channel performance into useful operating feedback.

Deliverables:
- YouTube Analytics sync
- KPI trends and historical snapshots
- Topic ranking using performance signals
- Script/voice A/B metadata
- Budget and quota guardrails
- Alerts for API and workflow health

Exit criteria:
- Dashboard reflects live analytics
- Topic selection can cite performance rationale
- Cost/quota failures pause automation safely

## Phase 6 — Deployment, security, and scale
**Goal:** Make the system dependable beyond local development.

Deliverables:
- Backend deployment and managed persistence
- Secret manager integration
- Observability and alerting
- Backup/recovery runbook
- Channel/niche extensibility
- Optional cross-posting boundaries

Exit criteria:
- Production deployment is repeatable
- Recovery runbook is tested
- Operational risks and provider limits are documented
