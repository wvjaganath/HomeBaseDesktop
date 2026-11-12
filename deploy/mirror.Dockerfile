# syntax=docker/dockerfile:1
#
# MagicMirror² (serveronly) for the HomeBase Mirror tab (README §6.4).
# Pinned to the v2.38.0 release commit; CVE-2026-63641 is fixed from 2.37.0.
# Built from the repo root:  docker compose -f deploy/docker-compose.yml build magicmirror
ARG NODE_IMAGE=node:26-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /opt/magic_mirror
# Release commit for v2.38.0 (tags can move; commits can't).
ADD --keep-git-dir=false https://github.com/MagicMirrorOrg/MagicMirror.git#f138f5b690ceab6450f55c852ac81d268363f563 .
# HomeBase: upstream's lockfile with security fixes inside MagicMirror's own
# version ranges (`npm audit fix`), so the audit below passes on a release whose
# dependencies got advisories after it shipped. It must belong to this release:
# regenerate it whenever the commit above changes (deploy/README.md §0).
COPY mirror/package-lock.json ./package-lock.json
RUN node -e "const p=require('./package.json'),l=require('./package-lock.json'); \
      if (p.version !== l.version) { console.error('mirror/package-lock.json is for MagicMirror ' + l.version + ', not ' + p.version + '; regenerate it (deploy/README.md section 0)'); process.exit(1); }"
# Production dependencies only, no Electron (serveronly), no install scripts.
RUN npm ci --omit=dev --omit=optional --ignore-scripts \
 && npm audit --omit=dev --audit-level=high
COPY mirror/patch-index.cjs /tmp/patch-index.cjs
RUN node /tmp/patch-index.cjs /opt/magic_mirror \
 # Remove modules and fixtures this setup never serves.
 && rm -rf tests defaultmodules/updatenotification defaultmodules/helloworld

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /opt/magic_mirror
COPY --from=build /opt/magic_mirror ./
COPY mirror/modules/MMM-HomeBase ./modules/MMM-HomeBase
# Gets the screen token, home and units from the hub (no mirror.env).
COPY mirror/homebase-start.cjs ./homebase-start.cjs
# config/ is mounted read-only from deploy (see docker-compose.yml).
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "homebase-start.cjs"]
