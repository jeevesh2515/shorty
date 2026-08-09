# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    # fontconfig lets libass resolve caption faces by family name. Without it the `ass`
    # filter silently substitutes whatever it finds. fonts-dejavu-core is the guaranteed
    # fallback face when the Anton download below is unavailable.
    fontconfig \
    fonts-dejavu-core \
    python3 \
    make \
    g++ \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

# Caption typeface. Anton (SIL OFL 1.1) is fetched at build time rather than committed —
# a 170KB binary in git is awkward to review and to push through tooling.
#
# The build must NOT fail if this download does: `|| true` degrades to DejaVu Sans Bold,
# and resolveCaptionFont() in server/captions.ts checks for the file on disk so the ASS we
# emit only ever names a face that actually exists.
RUN mkdir -p /app/assets/fonts \
    && (curl -fsSL --max-time 30 -o /app/assets/fonts/Anton-Regular.ttf \
         https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf \
       && curl -fsSL --max-time 30 -o /app/assets/fonts/OFL.txt \
         https://raw.githubusercontent.com/google/fonts/main/ofl/anton/OFL.txt \
       || echo "WARN: Anton download failed - captions will use DejaVu Sans") \
    && fc-cache -f /app/assets/fonts || true

# Shadowed at runtime when a Railway Volume is mounted at /app/data; the app recreates
# the media dir on boot via mkdirSync in server/index.ts.
RUN mkdir -p /app/data/media

ENV NODE_ENV=production
ENV PORT=8787
ENV DATA_DIR=/app/data
ENV SHORTS_DB_PATH=/app/data/shorts-autopilot.sqlite
ENV MEDIA_DIR=/app/data/media
ENV STATIC_DIR=/app/dist

EXPOSE 8787

CMD ["node", "dist-server/index.js"]
