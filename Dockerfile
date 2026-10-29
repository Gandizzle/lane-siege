# The game server, as a container: what Railway, Fly.io, Render or your own
# server runs (docs/GO-LIVE.md §5). Not the game itself, which is static
# files (npm run build:web) or the Android app (npm run build:android).
#
# Everything the server keeps goes in DATA_DIR, so mount a volume there:
# players, Founders, saved builds, reports and crash reports (server/index.ts).

FROM node:22-slim

WORKDIR /app

# The server runs its TypeScript directly, through tsx, which is one of the
# development dependencies - so all of them are installed.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

ENV DATA_DIR=/data \
    PORT=2567 \
    NODE_ENV=production
EXPOSE 2567
VOLUME ["/data"]

# The host asks /health whether the server is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 2567) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Node itself as the first process, so a host's stop signal reaches the server.
CMD ["node", "--import", "tsx", "server/index.ts"]
