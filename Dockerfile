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

RUN mkdir -p /app/data/media

ENV NODE_ENV=production
ENV PORT=8787
ENV DATA_DIR=/app/data
ENV SHORTS_DB_PATH=/app/data/shorts-autopilot.sqlite
ENV MEDIA_DIR=/app/data/media
ENV STATIC_DIR=/app/dist

EXPOSE 8787

CMD ["node", "dist-server/index.js"]
