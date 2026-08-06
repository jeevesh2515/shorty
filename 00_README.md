# Shorts Autopilot – Project Docs

This folder contains all living documentation for the Shorts Autopilot agentic AI system.

## How to use these docs

- **Before each work session**, read `10_MEMORY.md` to refresh context.
- **Before each major change**, read `30_ARCHITECTURE.md` and `40_DESIGN.md`.
- **When adding features**, check `20_RULES.md` for constraints and patterns.
- **When planning phases**, refer to `50_PHASES.md`.
- **When clarifying scope**, refer to `01_PRD.md`.

## Daily workflow

1. Open `10_MEMORY.md` and update "Latest status" and "Today's plan".
2. Check `50_PHASES.md` to see current phase and next milestones.
3. Implement in Base44 using minimal prompts; prefer manual edits.
4. At end of day, update `10_MEMORY.md` with what changed and any issues.

## Files

- `01_PRD.md` – Product requirements and success metrics
- `10_MEMORY.md` – Living memory: status, decisions, open questions
- `20_RULES.md` – Coding, prompt, and architecture rules
- `30_ARCHITECTURE.md` – System architecture and data flows
- `40_DESIGN.md` – UI, agents, and workflow design
- `50_PHASES.md` – Phased rollout plan with milestones

## Tech Stack Notes

- **TTS / Voice**: Dograh (https://github.com/dograh-hq/dograh) — open-source, self-hosted, BYOK. Replaces ElevenLabs. Zero per-call cost when self-hosted.
- **Platform**: Base44 (free tier — 25 message credits/month, 100 integration credits)
- **LLM**: Your own API keys (OpenAI / Gemini / other)
- **Video**: Stock footage + captions or AI-generated visuals
- **YouTube**: Data API v3 for uploads + Analytics
