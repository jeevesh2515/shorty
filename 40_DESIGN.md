# Design – Shorts Autopilot

## User interface (Base44 pages)

### Dashboard

Purpose: Overview of daily operation and health.

Components:
- Today's status card:
  - "Next Short scheduled at: …"
  - "Last Short published: …"
- Metrics summary (last 7/30 days):
  - Shorts published
  - Total views
  - Avg view duration
  - Subscribers gained
- Quick actions:
  - "Run manual Short now"
  - "Pause daily automation"
- Alerts:
  - "API quota low", "Upload failed", etc.

### Topics

Purpose: Inspect and manage topic pipeline.

Views:
- List of Topics with filters:
  - By niche
  - By status (`new`, `selected`, `scripted`, `rejected`)
- Detail view:
  - Topic metadata
  - Linked Script
  - Reason for selection (trend score, etc.)

### Videos

Purpose: Track generation status.

Views:
- List of Videos with:
  - Linked Script
  - Status (`pending`, `rendering`, `ready`, `failed`)
  - Preview (if available)
- Detail view:
  - Audio preview
  - Visual assets
  - Final video preview

### Uploads

Purpose: Manage published content.

Views:
- List of Uploads:
  - Title, thumbnail, YouTube link
  - Status (`scheduled`, `published`, `failed`)
  - Basic metrics (views, etc.)
- Detail view:
  - Full metadata
  - Analytics snapshot
  - "Resync analytics" button

## Agent design

### Topic Agent

Responsibility: Choose the best topic for the next Short.

Inputs:
- Niche configuration
- Recent performance (which niches perform well)
- Trending data (YouTube, Google Trends, etc.)

Outputs:
- Selected topic (title, niche, rationale)
- Stored in `Topic` entity

Implementation:
- Backend function `fetch_trending_topics()` + simple ranking logic.
- Optionally an LLM call to summarise "why this topic".

### Script Agent

Responsibility: Turn a topic into a tight Short script + metadata.

Inputs:
- `Topic` record
- Style guidelines (hook style, CTA, length)

Outputs:
- Script text (15–45 seconds)
- Hook line
- CTA line
- Suggested title, description, tags

Implementation:
- LLM call with a structured prompt; output JSON.
- Store in `Script` entity.

### Media Agent

Responsibility: Produce voice, visuals, and final video.

Sub-steps:
1. TTS from script via Dograh → audio file.
   - Dograh is self-hosted (Docker), accessed at `http://localhost:3010` or your VPS URL.
   - Use Dograh's Python or Node SDK to programmatically generate TTS.
   - BYOK: plug in your own TTS provider keys via Dograh's config, or use built-in stack.
2. Visual selection/generation:
   - Option A: Stock footage + captions.
   - Option B: AI-generated images/video.
3. Assemble video:
   - Combine audio + visuals + text overlays + music.

Implementation:
- Calls to Dograh TTS API, stock/AI visual APIs, video rendering service.
- Store URLs and status in `Video` entity.

### Upload Agent

Responsibility: Publish to YouTube and track state.

Inputs:
- `Video` record
- Metadata (title, description, tags, thumbnail)

Outputs:
- YouTube video ID & URL
- `Upload` entity with status

Implementation:
- YouTube Data API v3 `videos.insert`.
- Handle scheduling vs immediate publish.

## Human-in-the-loop points

Optional but recommended early on:

- **After Script generation**:
  - Pause workflow for approval.
  - You review script; approve/reject.
- **After Video generation**:
  - Preview video before upload.

In Base44:
- Use workflow interrupts or a "Pending Approval" status.
- Add a "Approve & Continue" button on Dashboard.

## Visual style

- Clean, minimal, operator-focused.
- Status colours:
  - Green: published / ready
  - Yellow: pending / in progress
  - Red: failed
- Emphasis on metrics and next action.

## Dograh TTS integration details

- **Setup**: Self-host via Docker (one command, ~2-3 min first start).
- **Access**: `http://localhost:3010` (local) or your VPS URL.
- **SDK options**:
  - Python: `pip install dograh-sdk`
  - Node: `npm install @dograh/sdk`
- **BYOK**: Bring your own TTS provider (e.g., Coqui, Piper, or cloud TTS) via Dograh's config, or use the built-in stack (auto-generated keys, no setup needed).
- **MCP native**: Dograh has an MCP server — could potentially integrate with Base44's MCP support later for direct TTS calls without a backend function.
- **Cost**: Free when self-hosted. Only cost is hosting (local = free, VPS = ~$5/month).
