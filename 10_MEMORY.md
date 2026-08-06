# Living Memory – Shorts Autopilot

> Update this file every work session.

## Latest status

- **Date**: 2026-08-06
- **Phase**: Day 1 – Foundation & Scaffold
- **Base44 app**: [Not yet created — user needs to create at app.base44.com]
- **Last change**: Project docs created; Dograh selected as TTS provider (replacing ElevenLabs).

## Today's plan (2026-08-06)

- [ ] Create Base44 app "Shorts Autopilot" at app.base44.com
- [ ] Scaffold core entities: Topic, Script, Video, Upload, Analytics
- [ ] Create basic pages: Dashboard, Topics, Videos, Uploads
- [ ] Draft one "mega-prompt" to generate initial app structure
- [ ] Manually refine navigation and layout
- [ ] Set up Dograh via Docker locally (curl + start_docker.sh)

## Key decisions

- Use own API keys for all LLM, video, and YouTube calls.
- Use **Dograh** (https://github.com/dograh-hq/dograh) for TTS/voiceover — open-source, self-hosted, zero per-call cost.
- Use Base44 workflows for:
  - Daily scheduled trigger (topic → script → video → upload)
  - Logging to entities
- Keep live agent chat minimal during dev (use Automatic model, few test runs).

## Open questions

- Which niches to start with? (e.g., tech facts, travel micro-guides, AI news)
- Video generation approach (stock + captions vs AI video models)?
- Where to self-host Dograh? (local Docker vs cheap VPS)

## Notes / Learnings

- Base44 integration credits are the tightest constraint; avoid excessive live testing.
- Zapier MCP can be used later for free-tier workflows if needed (e.g., webhook → YouTube).
- Dograh ships with auto-generated keys and its own LLM/TTS/STT stack — can use out of the box, then bring own keys later.
- Dograh has Python and Node SDKs for programmatic TTS calls from backend functions.
