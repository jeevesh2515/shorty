# Mega-Prompt: Shorts Autopilot App Scaffold

> Copy everything below the line and paste it into the Base44 builder chat as your FIRST message after creating the app.

---

Create a YouTube Shorts automation app called "Shorts Autopilot". This is a full-stack agentic AI system that automates daily YouTube Shorts creation — from topic discovery to script generation to video assembly to YouTube upload, with analytics tracking.

## ENTITIES (create all 5)

### 1. Topic
Fields:
- `title` (string, required)
- `niche` (string, required)
- `source` (string, enum: "trending", "evergreen", "manual", default: "manual")
- `status` (string, enum: "new", "selected", "scripted", "rejected", default: "new")
- `metrics` (JSON)
- `rationale` (string, optional — why this topic was chosen)

### 2. Script
Fields:
- `topic_id` (reference to Topic, required)
- `text` (long text, required)
- `duration_sec` (number, default: 30)
- `hook` (string, required)
- `cta` (string, optional)
- `title_suggestion` (string, optional)
- `description_suggestion` (long text, optional)
- `tags_suggestion` (list of strings)
- `status` (string, enum: "draft", "approved", "rejected", default: "draft")

### 3. Video
Fields:
- `script_id` (reference to Script, required)
- `audio_url` (string, optional)
- `visual_assets` (JSON — array of image/video URLs)
- `final_video_url` (string, optional)
- `thumbnail_url` (string, optional)
- `status` (string, enum: "pending", "rendering", "ready", "failed", default: "pending")

### 4. Upload
Fields:
- `video_id` (reference to Video, required)
- `youtube_video_id` (string, optional)
- `youtube_url` (string, optional)
- `title` (string, required)
- `description` (long text, optional)
- `tags` (list of strings)
- `thumbnail_url` (string, optional)
- `scheduled_at` (datetime, optional)
- `status` (string, enum: "pending", "scheduled", "published", "failed", default: "pending")

### 5. Analytics
Fields:
- `upload_id` (reference to Upload, required)
- `views` (number, default: 0)
- `average_view_duration_sec` (number, default: 0)
- `swipe_away_rate` (number, default: 0)
- `likes` (number, default: 0)
- `comments` (number, default: 0)
- `subscribers_gained` (number, default: 0)
- `estimated_revenue` (number, default: 0)
- `fetched_at` (datetime)

## PAGES (create all 4)

### 1. Dashboard
- A hero status card at the top showing:
  - "Next Short scheduled" with the next scheduled Upload's scheduled_at value (or "No shorts scheduled" if none)
  - "Last published Short" with the most recent Upload where status = "published" (show title + youtube_url as a link)
- A 4-card metrics row (last 30 days):
  - Shorts Published (count of Uploads with status = "published" in last 30 days)
  - Total Views (sum of Analytics.views for those uploads)
  - Avg View Duration (avg of Analytics.average_view_duration_sec)
  - Subscribers Gained (sum of Analytics.subscribers_gained)
- A "Run Manual Short Now" button (no logic yet — just the button, styled prominently)
- A "Pause Automation" toggle button
- An alerts section showing any Uploads or Videos with status = "failed" (red badge with title)

### 2. Topics
- A list view of all Topics with:
  - Columns: Title, Niche, Source, Status (with color-coded badge: green = scripted, yellow = selected, gray = new, red = rejected)
  - Filter dropdown for niche and status
  - Sort by created_date descending
  - Click any row → opens detail view
- Detail view shows:
  - Topic metadata (title, niche, source, metrics as formatted JSON, rationale)
  - Linked Script (if exists) — show script text, hook, cta, status
  - A "Generate Script" button (no logic yet)
  - A "Reject Topic" button that sets status = "rejected"

### 3. Videos
- A list view of all Videos with:
  - Columns: Linked Script title (via script_id), Status (badge: green = ready, yellow = rendering, gray = pending, red = failed), Created date
  - Sort by created_date descending
  - Click any row → opens detail view
- Detail view shows:
  - Script text (from linked Script)
  - Audio URL (as audio player if available)
  - Visual assets (show as image grid if available)
  - Final video URL (as video player if available)
  - Thumbnail URL (as image if available)
  - Status badge
  - A "Re-render Video" button (no logic yet)

### 4. Uploads
- A list view of all Uploads with:
  - Columns: Title, Thumbnail (small image), YouTube link (opens in new tab), Status (badge), Scheduled at, Views (from Analytics)
  - Sort by created_date descending
  - Filter by status
  - Click any row → opens detail view
- Detail view shows:
  - Full metadata: title, description, tags (as chips), thumbnail
  - YouTube URL (as clickable link)
  - Analytics snapshot: views, avg view duration, swipe away rate, likes, comments, subscribers gained, estimated revenue
  - A "Resync Analytics" button (no logic yet)
  - A "Re-upload" button if status = "failed" (no logic yet)

## NAVIGATION
- Sidebar navigation with: Dashboard, Topics, Videos, Uploads
- Dashboard is the default/home page
- Clean, minimal, operator-focused design
- Use a dark sidebar with light content area
- Status badges should be color-coded consistently:
  - Green: published, ready, approved, scripted
  - Yellow: pending, rendering, draft, scheduled, selected
  - Red: failed, rejected
  - Gray: new

## DESIGN NOTES
- Make it look like a production dashboard, not a prototype
- Use cards with subtle shadows for metric tiles
- Tables should be clean with hover states
- Mobile-responsive but optimized for desktop (this is an operator tool)
- No authentication needed for now (single user)
