# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    SEARCHHUB_HOME=/data

WORKDIR /app

RUN groupadd --system --gid 10001 searchhub \
    && useradd --system --uid 10001 --gid 10001 --home-dir /data --no-create-home searchhub \
    && mkdir -p /data \
    && chown -R searchhub:searchhub /data

COPY --from=build --chown=searchhub:searchhub /app/package.json /app/package-lock.json ./
COPY --from=build --chown=searchhub:searchhub /app/node_modules ./node_modules
COPY --from=build --chown=searchhub:searchhub /app/dist ./dist
COPY --from=build --chown=searchhub:searchhub /app/web/dist ./web/dist
COPY --from=build --chown=searchhub:searchhub /app/.env.example ./.env.example

USER searchhub
EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
