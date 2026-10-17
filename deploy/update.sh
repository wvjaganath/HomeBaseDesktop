#!/usr/bin/env bash
# Update HomeBase on the Linux PC: newest code, newest patched base images,
# rebuilt containers. Takes a database backup first. Safe to re-run.
#
#   ./deploy/update.sh            # from anywhere in the repo
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Backup before updating"
if docker compose ps --status running --services 2>/dev/null | grep -qx hub; then
  docker compose exec -T hub node dist/scripts/backup.js
else
  echo "    hub not running; skipping (nightly backups are in ./backups)"
fi

echo "==> Code"
git -C .. pull --ff-only

echo "==> Base images (by digest)"
./pin-images.sh

echo "==> Build"
# --pull: re-resolve the pinned base images; the Dockerfiles' npm audit
# steps fail the build on any known high/critical vulnerability.
docker compose build --pull

echo "==> Restart"
docker compose up -d --remove-orphans
docker image prune -f >/dev/null

echo "==> Status"
for _ in $(seq 1 30); do
  if docker compose ps --format '{{.Service}} {{.Status}}' | grep -q '^hub .*(healthy)'; then break; fi
  sleep 2
done
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
