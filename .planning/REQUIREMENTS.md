# Shorts Autopilot — Requirements

## Functional requirements

### Data model

- **REQ-DATA-01**: Topic stores title, niche, source, status, metrics, rationale, and timestamps.
- **REQ-DATA-02**: Script references a Topic and stores text, duration, hook, CTA, metadata suggestions, status, and timestamps.
- **REQ-DATA-03**: Video references a Script and stores audio, visual assets, final video, thumbnail, status, and timestamps.
- **REQ-DATA-04**: Upload references a Video and stores YouTube metadata, scheduling, tags, thumbnail, status, and timestamps.
- **REQ-DATA-05**: Analytics references an Upload and stores views, retention, swipe-away rate, engagement, subscriber gain, revenue, and fetch time.

### Operator shell

- **REQ-UX-01**: Sidebar navigation exposes Dashboard, Topics, Videos, and Uploads.
- **REQ-UX-02**: Dashboard is the default route/view.
- **REQ-UX-03**: Status badges use consistent semantic colors.
- **REQ-UX-04**: Layout is optimized for desktop and remains usable on mobile.

### Dashboard

- **REQ-DASH-01**: Show next scheduled Short or an empty state.
- **REQ-DASH-02**: Show most recent published Short with a YouTube link.
- **REQ-DASH-03**: Show last-30-day published count, views, average view duration, and subscribers gained.
- **REQ-DASH-04**: Expose manual run and pause/resume controls.
- **REQ-DASH-05**: Show failed uploads and videos as actionable alerts.

### Topics

- **REQ-TOPIC-01**: List topics sorted newest first with title, niche, source, and status.
- **REQ-TOPIC-02**: Filter by niche and status.
- **REQ-TOPIC-03**: Open a topic detail view with formatted metrics, rationale, and linked script.
- **REQ-TOPIC-04**: Allow local script generation and topic rejection actions.

### Videos

- **REQ-VIDEO-01**: List videos sorted newest first with linked script title, status, and created date.
- **REQ-VIDEO-02**: Open detail view with script, audio, visuals, final video, thumbnail, and status.
- **REQ-VIDEO-03**: Allow re-render/retry action for failed or pending media.

### Uploads

- **REQ-UPLOAD-01**: List uploads sorted newest first with title, thumbnail, YouTube link, status, schedule, and analytics views.
- **REQ-UPLOAD-02**: Filter by upload status.
- **REQ-UPLOAD-03**: Open detail view with metadata, tags, thumbnail, YouTube URL, and analytics snapshot.
- **REQ-UPLOAD-04**: Allow analytics resync and failed re-upload actions.

### Pipeline

- **REQ-PIPE-01**: Provide a local end-to-end manual run that creates linked topic, script, video, upload, and analytics records.
- **REQ-PIPE-02**: Keep provider calls behind server-side adapter boundaries for future LLM, Dograh, visuals, rendering, YouTube, and analytics integrations.
- **REQ-PIPE-03**: Make retry paths idempotent and status-driven.
- **REQ-PIPE-04**: Surface human approval points for script and media before publication.

## Non-functional requirements

- **REQ-NFR-01**: No provider secret is placed in browser-delivered source.
- **REQ-NFR-02**: UI state is deterministic and testable with seeded data.
- **REQ-NFR-03**: Build must pass strict TypeScript validation.
- **REQ-NFR-04**: The design must remain legible at narrow desktop and mobile widths.
- **REQ-NFR-05**: Documentation must identify implemented behavior versus live-integration work.
- **REQ-NFR-06**: Logs/status changes must support debugging and recovery.
