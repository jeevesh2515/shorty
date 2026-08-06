# Shorts Autopilot — Project

## Vision

Shorts Autopilot is an operator-first system for turning a content idea into a publishable YouTube Short: discover a topic, generate and approve a script, assemble media, publish or schedule the upload, and learn from analytics.

## Product outcome

The project is complete when a single creator can run the full lifecycle from the browser, inspect every linked record, recover from failures without duplicate uploads, and see performance data feed back into topic selection.

## Canonical source documents

- `01_PRD.md` — product requirements and success metrics
- `20_RULES.md` — invariants, cost, data, and YouTube policy rules
- `30_ARCHITECTURE.md` — pipeline, entities, workflows, and provider boundaries
- `40_DESIGN.md` — operator UX and agent responsibilities
- `50_PHASES.md` — original rollout plan
- `MEGA_PROMPT.md` — initial entity/page acceptance brief
- `REQUIRED_SECRETS.md` — live integration credentials and deployment prerequisites

## Current repository strategy

The repository began as an empty workspace. We are implementing a production-shaped frontend first with:

- React + TypeScript + Vite
- local relational seed data for a fully interactive demo
- browser persistence for operator mutations
- explicit provider seams so live LLM, Dograh, media, YouTube, and analytics adapters can be added safely
- no authentication in the first release, as required by the brief

The frontend must not pretend that an external upload happened. Local/demo actions are clearly represented in state and documented as the adapter boundary until credentials and a backend are configured.

## Core invariants

1. Every Short is traceable through Topic → Script → Video → Upload → Analytics.
2. Status transitions are explicit and recoverable.
3. Failed work can be retried without creating duplicate uploads.
4. API keys stay server-side; never expose provider secrets in browser code.
5. AI-heavy work is routed through provider adapters and is observable.
6. The operator can review scripts and media before publishing.
7. YouTube policy and originality guardrails are visible in the workflow.

## Success criteria

- A polished responsive operator dashboard exists.
- All five entities and four requested pages are represented and editable in the frontend.
- The full local workflow can be exercised without dead buttons or fake navigation.
- Build/type validation passes.
- Project docs, phase plans, and a graph map explain what exists and what remains for live integrations.
