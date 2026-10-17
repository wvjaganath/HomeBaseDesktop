# syntax=docker/dockerfile:1
#
# HomeBase hub: Fastify server + built web app in one small image.
# Build from the repo root:  docker compose -f deploy/docker-compose.yml build
#
# Pin the base image by digest before deploying (README §7.2 rule 9):
#   docker buildx imagetools inspect node:26-bookworm-slim   → copy the sha256 digest
#   then set NODE_IMAGE=node:26-bookworm-slim@sha256:<digest> in deploy/.env
ARG NODE_IMAGE=node:26-bookworm-slim

# ---- build ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /src
# No compiler toolchain: better-sqlite3, argon2 and sharp ship prebuilt binaries
# inside their npm packages, and install scripts stay disabled (.npmrc).
COPY server/package.json server/package-lock.json server/.npmrc server/
RUN cd server && npm ci

COPY web/package.json web/package-lock.json web/.npmrc web/
RUN cd web && npm ci

COPY server/ server/
COPY web/ web/
# The web build writes into server/web-dist.
RUN cd web && npm run build
RUN cd server && npm run build && npm prune --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app

# Application files are owned by root and read-only to the service user.
COPY --from=build /src/server/package.json ./package.json
COPY --from=build /src/server/node_modules ./node_modules
COPY --from=build /src/server/dist ./dist
COPY --from=build /src/server/web-dist ./web-dist

# Unprivileged runtime user (matches `user:` in docker-compose.yml).
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
