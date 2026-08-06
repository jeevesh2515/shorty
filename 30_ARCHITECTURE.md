# Architecture – Shorts Autopilot

## High-level overview

Shorts Autopilot is a multi-agent pipeline orchestrated by Base44 workflows, with AI-heavy steps executed via backend functions using your own API keys. TTS is handled by Dograh (self-hosted, open-source).

```text
[Scheduler] → [Topic Agent] → [Script Agent] → [Media Agent] → [Upload Agent] → [Analytics]
                 ↑                ↑                ↑                ↑
           (your API keys)  (your API keys)  (Dograh + your keys)  (YouTube API)
```

## Core components

1. **Base44 App**
   - Entities: Topic, Script, Video, Upload, Analytics
   - Pages: Dashboard, Topics, Videos, Uploads
   - Workflows: Daily Shorts Pipeline, Manual Topic Run, Analytics Sync

2. **Backend Functions (your own API keys)**
   - `fetch_trending_topics()`: Calls YouTube/Trend APIs or search tools.
   - `generate_script(topic, constraints)`: LLM call for script + metadata.
   - `generate_voiceover(script)`: Dograh TTS API (self-hosted, BYOK).
   - `generate_visuals(script)`: Image/video generation or stock selection.
   - `assemble_video(audio, visuals, metadata)`: Video rendering service.
   - `upload_to_youtube(video, metadata)`: YouTube Data API.

3. **External Services**
   - LLM: OpenAI / Gemini / other (your keys)
   - TTS: **Dograh** (self-hosted via Docker — https://github.com/dograh-hq/dograh)
     - Open-source, BSD-2-Clause license
     - BYOK: bring your own LLM/STT/TTS providers, or use built-in stack
     - Python SDK: `pip install dograh-sdk`
     - Node SDK: `npm install @dograh/sdk`
     - Self-host with: `curl -o docker-compose.yaml https://raw.githubusercontent.com/dograh-hq/dograh/main/docker-compose.yaml && curl -o start_docker.sh https://raw.githubusercontent.com/dograh-hq/dograh/main/scripts/start_docker.sh && chmod +x start_docker.sh && ./start_docker.sh`
     - Access at: `http://localhost:3010`
   - Visuals: Pexels, Pixabay, or AI video models (e.g., Veo, Runway)
   - YouTube: Data API v3 for uploads + Analytics

## Data model (entities)

### Topic

- `id` (auto)
- `title` (string)
- `niche` (string)
- `source` (string: "trending", "evergreen", "manual")
- `status` (enum: `new`, `selected`, `scripted`, `rejected`)
- `metrics` (JSON: search volume, trend score, etc.)
- `created_at` (datetime)

### Script

- `id` (auto)
- `topic_id` (ref: Topic)
- `text` (long text)
- `duration_sec` (int)
- `hook` (string)
- `cta` (string)
- `status` (enum: `draft`, `approved`, `rejected`)
- `created_at` (datetime)

### Video

- `id` (auto)
- `script_id` (ref: Script)
- `audio_url` (string)
- `visual_assets` (JSON: list of image/video URLs)
- `final_video_url` (string, storage or provider URL)
- `status` (enum: `pending`, `rendering`, `ready`, `failed`)
- `created_at` (datetime)

### Upload

- `id` (auto)
- `video_id` (ref: Video)
- `youtube_video_id` (string)
- `youtube_url` (string)
- `title` (string)
- `description` (long text)
- `tags` (list<string>)
- `thumbnail_url` (string)
- `scheduled_at` (datetime, optional)
- `status` (enum: `pending`, `scheduled`, `published`, `failed`)
- `created_at` (datetime)

### Analytics

- `id` (auto)
- `upload_id` (ref: Upload)
- `views` (int)
- `average_view_duration_sec` (float)
- `swipe_away_rate` (float)
- `likes` (int)
- `comments` (int)
- `subscribers_gained` (int)
- `estimated_revenue` (float)
- `fetched_at` (datetime)

## Workflow logic

### Daily Shorts Pipeline (recurring)

Trigger: Daily at a fixed time (e.g., 10:00 AM UTC).

Steps:
1. **Select Topic**
   - Call `fetch_trending_topics()` → pick best candidate.
   - Create `Topic` record with `status = selected`.
2. **Generate Script**
   - Call `generate_script(topic)` → create `Script` record.
   - Optionally pause for human approval (interrupt point).
3. **Generate Media**
   - Call `generate_voiceover(script)` via Dograh TTS → store `audio_url`.
   - Call `generate_visuals(script)` → store `visual_assets`.
   - Call `assemble_video(...)` → store `final_video_url`.
   - Update `Video` status.
4. **Upload to YouTube**
   - Call `upload_to_youtube(video, metadata)` → create `Upload` record.
   - Set `status = published` and store `youtube_video_id`.
5. **Log Initial Analytics**
   - Create `Analytics` record with initial zeros; scheduled sync later.

### Manual Topic Run

Trigger: Manual button in Dashboard.

- Same as daily pipeline but allows choosing niche or topic manually.

### Analytics Sync

Trigger: Daily or hourly.

- For each `Upload` with `status = published`:
  - Call YouTube Analytics API → update `Analytics` entity.

## Credit-saving strategies

- All LLM, TTS (Dograh), video, and YouTube calls happen in backend functions with your keys.
- Base44 workflows only orchestrate and log; they don't directly call external AI APIs.
- Use Base44's in-app agents sparingly (Automatic model, few test runs).
- Dograh self-hosted = zero per-call TTS cost (only hosting cost).
