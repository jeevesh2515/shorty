# PostHog Workflow — Shorts Autopilot (9-node, visual-only)

The deployed graph (`019fdd42-2281-0000-437b-f0a79ebd50b1`, project `243137` eu) is a
**visual 9-node pipeline**. It triggers **only** on `topic_discovery_completed` and is a
visual orchestration/dashboard layer — it does **not** do the real work.

## What the deployed graph actually is

| # | Node | Behavior |
|---|------|----------|
| 1 | Topic discovery | Entry trigger — fires on `topic_discovery_completed` |
| 2 | LLM judge (placeholder) | `template-posthog-set-variable` function — does **not** call the API |
| 3 | Quality gate | Reads `properties.judge_score >= 9` from the **same trigger event** — pass → node 4, fail → `node_reject_exit` |
| 4–8 | Script / VO / images / assembly / thumbnail (placeholders) | `template-posthog-set-variable` functions — do **not** call the API |
| 9 | Render & Store for Preview | Exit node — visual only |

Nodes 2 and 4–8 are placeholder `template-posthog-set-variable` function nodes: they set a
variable in the graph and never touch `server/http.ts`. Nothing in the graph produces a
topic, script, video, or upload.

## The real pipeline: the backend API

All actual work is done by the API (`server/http.ts`), driven by the frontend buttons in
`src/App.tsx`. The workflow is just the event-driven visual layer on top.

| Route | Stage |
|-------|-------|
| `POST /api/runs/manual` | Run the whole chain server-side (topic → script/judge → render) |
| `POST /api/topics/discover` | Discover & store a topic (`discoverAndStore`) |
| `POST /api/topics` | Create a topic manually |
| `POST /api/topics/{id}/script` | Generate script (loops up to 3 LLM attempts) |
| `POST /api/scripts/{id}/judge` | Evaluate script with the LLM judge (returns `judgeScore`) |
| `POST /api/videos/{id}/render` | Produce video: TTS, visuals, assembly, thumbnail, preview store |
| `POST /api/uploads/{id}/approve` | Approve for publish |

…plus `GET /api/state`, `POST /api/uploads/{id}/retry`, `POST /api/analytics/sync`,
`PATCH /api/settings/automation`, etc.

## Trigger contract

- **Only `topic_discovery_completed` enters the graph** — no other event does.
- The node-3 gate needs `judge_score` in the **event properties** (e.g. the frontend
  captures `topic_discovery_completed` with `judge_score: 9.5`); score `>= 9` passes to
  node 4, otherwise the branch exits at `node_reject_exit`.
- Other events (`manual_short_run_completed`, `script_judge_evaluated`,
  `render_preview_stored`) exist but are **not** wired into this graph.

## Upgrade path: real HTTP automation (webhook template)

PostHog ships a `template-webhook` function: inputs `url` / `method` / `body` / `headers`,
does `fetch()` and **throws on HTTP status >= 400**. It is attachable as a function node via
`workflows-patch-graph` (op `update_action`) + `workflows-publish`.

**Keep it simple. Warnings:**
- Patching several placeholder nodes to call `POST /api/runs/manual` would **double/over-fire
  the whole pipeline** — every node would trigger a full server-side run.
- Correct use is **one webhook node** that triggers the manual run (or per-stage endpoints
  like `POST /api/videos/{id}/render`, with the topic/script/video **IDs carried in the event
  properties**).
- The webhook node must carry the API token (`Authorization: Bearer …`) if the API requires
  auth, and its body must include whatever the route expects.

## How to associate this into PostHog

To rebuild/retarget the graph (e.g. to attach the webhook node above) use the **PostHog MCP**:
`workflows-get` to inspect, `workflows-patch-graph` to change a node's `update_action`, then
`workflows-publish` to deploy. This requires a **PostHog Personal API key** in the MCP env —
the `phc_` key in `.env` is browser-ingest only and cannot manage workflows (verified 401).
The MCP server is wired in `.mcp.json` next to this file.

Until a webhook node is attached, the deployed graph stays **visual-only**: it renders the
pipeline state but runs nothing.
