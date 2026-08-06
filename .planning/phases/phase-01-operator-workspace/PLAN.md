# Phase 1 Plan — Operator Workspace

## Objective
Deliver a polished, responsive, local-first Shorts Autopilot operator workspace with all entities, requested pages, linked detail views, and working demo actions.

## Work items

1. Define domain types for Topic, Script, Video, Upload, and Analytics.
2. Seed realistic linked records covering scheduled, published, failed, rendering, and rejected states.
3. Add localStorage-backed state with reset-safe initialization.
4. Build the application shell: sidebar, header, navigation, responsive content frame.
5. Build Dashboard KPI/health sections and manual-run/pause controls.
6. Build Topics table, filtering, details, script generation, and rejection.
7. Build Videos table, details, media previews, and rerender action.
8. Build Uploads table, filtering, details, analytics, resync, and retry.
9. Add shared status badges, icon primitives, formatting helpers, and empty states.
10. Validate build and browser behavior at desktop/mobile widths.

## Verification loop

- `npm run build`
- Start Vite and inspect Dashboard, Topics, Videos, and Uploads in Chrome.
- Exercise filters and detail navigation.
- Reject a topic, trigger script generation, retry a failed video/upload, resync analytics, toggle automation, and run a manual Short.
- Reload the browser and verify local state persists.
- Run `graphify . --no-viz` and inspect `graphify-out/GRAPH_REPORT.md`.

## Exit criteria

- No requested page or entity is missing.
- No primary action is a dead button in the local demo.
- No console errors in browser verification.
- Strict TypeScript build passes.
