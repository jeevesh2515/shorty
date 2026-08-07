FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/tsconfig.server.json ./tsconfig.server.json
RUN mkdir -p /app/data/media
ENV NODE_ENV=production
ENV PORT=8787
ENV STATIC_DIR=/app/dist
EXPOSE 8787
CMD ["node", "--import", "tsx", "server/index.ts"]
