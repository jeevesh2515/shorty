# Phases – Shorts Autopilot

## Phase 0 – Preparation (Day 0)

Goals:
- Decide niches and content style.
- Gather API keys:
  - LLM (OpenAI / Gemini)
  - Dograh (self-hosted TTS — https://github.com/dograh-hq/dograh)
  - Visuals / video
  - YouTube Data API
- Set up Base44 account and workspace.
- Self-host Dograh via Docker:
  ```bash
  curl -o docker-compose.yaml https://raw.githubusercontent.com/dograh-hq/dograh/main/docker-compose.yaml && curl -o start_docker.sh https://raw.githubusercontent.com/dograh-hq/dograh/main/scripts/start_docker.sh && chmod +x start_docker.sh && ./start_docker.sh
  ```
  Access at `http://localhost:3010`.

Deliverables:
- List of 3–5 starter niches.
- API keys configured in a secure place.
- Base44 workspace ready.
- Dograh running locally (or on VPS).

## Phase 1 – Foundation & Scaffold (Days 1–3)

Goals:
- Create Base44 app structure.
- Define entities: Topic, Script, Video, Upload, Analytics.
- Create basic pages: Dashboard, Topics, Videos, Uploads.
- Implement one "mega-prompt" to scaffold the app.

Deliverables:
- Working Base44 app with empty entities and navigation.
- `docs/` folder with all `.md` files.

## Phase 2 – Core Logic & Backend (Days 4–10)

Goals:
- Implement backend functions (with your API keys):
  - `fetch_trending_topics`
  - `generate_script`
  - `generate_voiceover` (via Dograh TTS SDK)
  - `generate_visuals`
  - `assemble_video`
  - `upload_to_youtube`
- Wire basic data flows (manual runs first).
- Test Dograh TTS integration:
  - Send script text → receive audio file URL.
  - Verify audio quality and duration.

Deliverables:
- End-to-end manual pipeline:
  - Manually trigger a topic → script → video → upload.
- Logs in entities for each step.

## Phase 3 – Agentic Layer (Days 11–17)

Goals:
- Add in-app agents (Automatic model) for:
  - Topic selection rationale
  - Script refinement
- Add minimal agent chat UI for debugging/oversight.
- Test with 1–2 runs; check logs.

Deliverables:
- Agents that can explain choices and suggest improvements.
- No heavy live testing; rely on logs.

## Phase 4 – Automations & Workflows (Days 18–24)

Goals:
- Create recurring daily workflow:
  - Scheduled trigger → full pipeline.
- Add optional human approval steps.
- Implement idempotency (no duplicate uploads).
- Ensure Dograh instance is reliably running (or move to VPS).

Deliverables:
- Daily automated Shorts running reliably.
- Failure handling and retry logic.

## Phase 5 – Analytics & Optimisation (Days 25–35)

Goals:
- Implement Analytics sync workflow.
- Build Dashboard charts and KPIs.
- Use performance data to refine topic selection and script style.
- A/B test Dograh voice styles for audience retention.

Deliverables:
- Live dashboard with views, retention, subs gained.
- Iterated prompt templates based on data.

## Phase 6 – Scale & Monetisation (Days 36–45+)

Goals:
- Ensure YPP eligibility path is clear.
- Consider:
  - Additional niches/channels
  - Cross-posting to TikTok/Reels (via Zapier MCP or similar)
  - Multiple Dograh voice profiles for different niches
- Optimise cost/performance.

Deliverables:
- Consistent daily output with improving metrics.
- Clear path to monetisation and potential revenue tracking.
