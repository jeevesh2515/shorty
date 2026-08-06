# Required Secrets — Shorts Autopilot

> Set these in your Base44 app under Security → Secrets (or Settings → Environment Variables)

## Critical (required for pipeline to work)

| Secret Name | Description | Where to Get It |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key for script generation | https://platform.openai.com/api-keys |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key (for search/trending) | Google Cloud Console → Enable YouTube Data API v3 → Create credentials |
| `YOUTUBE_ACCESS_TOKEN` | OAuth 2.0 access token for YouTube upload | Google OAuth 2.0 flow (see below) |
| `PEXELS_API_KEY` | Pexels API key for stock footage | https://www.pexels.com/api/ |
| `DOGRAH_API_URL` | Your Dograh instance URL | http://localhost:3010 (local) or your VPS URL |
| `VIDEO_RENDER_API_URL` | External video rendering service URL | See notes below |

## Optional

| Secret Name | Description |
|---|---|
| `DOGRAH_API_KEY` | Dograh API key (if using BYOK in Dograh config) |

## YouTube OAuth Setup (for upload function)

1. Go to Google Cloud Console → Credentials
2. Create OAuth 2.0 Client ID (type: Web application)
3. Add redirect URI: https://app.base44.com/auth/callback (or your app's URL)
4. Get `client_id` and `client_secret`
5. Run OAuth flow to get `refresh_token`
6. Exchange refresh token for access token before each upload
7. Store access token as `YOUTUBE_ACCESS_TOKEN`

Note: Access tokens expire after ~1 hour. For production, you'll want to use a refresh token flow. The backend function should handle token refresh automatically.

## Dograh Setup (TTS)

1. Self-host via Docker:
```bash
curl -o docker-compose.yaml https://raw.githubusercontent.com/dograh-hq/dograh/main/docker-compose.yaml && \
curl -o start_docker.sh https://raw.githubusercontent.com/dograh-hq/dograh/main/scripts/start_docker.sh && \
chmod +x start_docker.sh && ./start_docker.sh
```
2. Access at http://localhost:3010
3. Set `DOGRAH_API_URL` to your instance URL
4. If hosting on a VPS, use the VPS public URL instead

Note: Since Base44 backend functions run in the cloud, `http://localhost:3010` won't be accessible. You need either:
- A VPS with Dograh installed (public URL)
- A tunnel like ngrok to expose local Dograh
- Dograh cloud version at https://www.dograh.com

## Video Rendering Service

The `assembleVideo` function calls an external video rendering API. Options:
- Shotstack (https://shotstack.io) — API-based video rendering
- Creatomate (https://creatomate.com) — API-based video generation
- Bannerbear (https://bannerbear.com) — Image/video generation API
- Self-hosted FFmpeg server

Set `VIDEO_RENDER_API_URL` to whichever service's API endpoint you choose.
