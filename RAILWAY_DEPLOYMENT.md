# Railway Deployment Guide — Shorts Autopilot

This guide walks you through deploying **Shorts Autopilot** to [Railway](https://railway.com/) as a single unified service (serving both the React dashboard UI and the Node.js API server with embedded FFmpeg & SQLite).

---

## 1. Prerequisites

1. A [Railway](https://railway.com) account.
2. Your code pushed to a GitHub repository (`shorts-autopilot` or your custom repo name).

---

## 2. Deploying on Railway

### Step 1: Create a New Project on Railway
1. Go to [railway.com/dashboard](https://railway.com/dashboard).
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select your repository (`shorty` / `shorts-autopilot`).

### Step 2: Add a Persistent Volume (For SQLite & Rendered Videos)
> ⚠️ **Crucial**: Without a persistent volume, Railway's ephemeral container disk resets on redeploys, wiping your database and rendered video files.

1. Click on your deployed service in the Railway canvas.
2. Click **+ Add Volume** (or go to **Volumes** tab).
3. Set the Mount Path to:
   ```text
   /app/data
   ```
4. Railway will automatically persist `/app/data/shorts-autopilot.sqlite` and `/app/data/media/`.

### Step 3: Configure Environment Variables
In Railway → Service Settings → **Variables**, add the following:

#### Required Core Settings:
| Variable | Value | Description |
|---|---|---|
| `DATA_DIR` | `/app/data` | Path to persistent storage volume |
| `LLM_PROVIDER` | `groq` | Options: `groq`, `openrouter`, `nvidia`, `gemini`, `openai`, `local` |

#### LLM Provider Key (Choose at least one):
| Variable | Example Value | Description |
|---|---|---|
| `GROQ_API_KEY` | `gsk_...` | Free 14.4k req/day at [console.groq.com](https://console.groq.com) |
| `OPENROUTER_API_KEY` | `sk-or-...` | Free models at [openrouter.ai](https://openrouter.ai) |
| `NVIDIA_API_KEY` | `nvapi-...` | Free credits at [build.nvidia.com](https://build.nvidia.com) |
| `GEMINI_API_KEY` | `AIzaSy...` | Low cost ($0.002/script) at Google AI Studio |

#### Visuals & Search (Optional but Recommended):
| Variable | Description |
|---|---|
| `PEXELS_API_KEY` | Stock video/image assets (Free 200 req/hr at [pexels.com/api](https://www.pexels.com/api)) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key for discovery |

#### YouTube Automatic Publishing (Optional):
| Variable | Description |
|---|---|
| `YOUTUBE_CLIENT_ID` | OAuth2 Client ID from Google Cloud Console |
| `YOUTUBE_CLIENT_SECRET` | OAuth2 Client Secret |
| `YOUTUBE_REFRESH_TOKEN` | OAuth2 Refresh Token |

#### Automation (Optional):
| Variable | Value | Description |
|---|---|---|
| `ENABLE_SCHEDULER` | `true` | Enable the hourly scheduler for automated runs |
| `DEFAULT_NICHE` | `Productivity` | Default niche for automated topic discovery |
| `REVIEW_HOUR_LONDON` | `9` | Hour (London time) when the scheduler runs |
| `AUTO_APPROVE` | `true` | Auto-approve videos after render |
| `AUTO_PUBLISH` | `true` | Auto-publish approved uploads to YouTube |

> **Note:** `AUTO_APPROVE` and `AUTO_PUBLISH` can also be toggled from the Settings page in the dashboard.

### YouTube OAuth Setup

To enable actual YouTube uploads (not just scheduled placeholders):

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**.
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Add your Railway domain to **Authorized redirect URIs**:
   ```
   https://<your-railway-app>.railway.app/api/auth/youtube/callback
   ```
4. Copy the **Client ID** and **Client Secret** into Railway variables:
   - `YOUTUBE_CLIENT_ID`
   - `YOUTUBE_CLIENT_SECRET`
5. In the dashboard Settings, click **Connect YouTube** and complete the OAuth flow.
6. The refresh token is stored securely in the SQLite database.

### YouTube Data API Setup (for topic discovery)

1. In Google Cloud Console, enable **YouTube Data API v3**.
2. Create an **API Key** and restrict it to YouTube Data API v3.
3. Add `YOUTUBE_API_KEY` to Railway variables.

---

## 3. How the Build Works Automatically

Railway uses the project's [`railway.json`](file:///Users/jeeveshsingale/shorty/railway.json) and [`Dockerfile`](file:///Users/jeeveshsingale/shorty/Dockerfile):

1. **Stage 1 (Build)**: Compiles React UI into static files (`dist/`) and compiles server TypeScript into production JavaScript (`dist-server/`).
2. **Stage 2 (Runtime)**: Installs `ffmpeg`, `ca-certificates`, `sqlite3`, and `python3/make/g++` for native `better-sqlite3` execution.
3. **Healthcheck**: Railway polls `/api/health` automatically to confirm the app is live before routing traffic.

---

## 4. Verifying Deployment

Once deployed, Railway generates a URL for your service (e.g. `https://shorts-autopilot-production.up.railway.app`).

1. Open the domain in your browser — the dark amber **Shorts Autopilot Dashboard** will load.
2. Go to **Settings** — verify your active LLM provider shows a green **Ready** dot.
3. (Optional) Click **Connect YouTube** and complete the OAuth flow to enable publishing.
4. (Optional) Enable **Auto-approve** and **Auto-publish** in Settings for fully autonomous operation.
5. Click **Run manual Short** — your production container will generate a topic, script, render video with FFmpeg, generate an AI thumbnail concept, and show it on your dashboard!
