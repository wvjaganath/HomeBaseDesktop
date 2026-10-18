#!/usr/bin/env bash
# Start HomeBase on the Linux PC again after ./deploy/stop.sh. Uses the
# containers as they were built; ./deploy/update.sh is for new code.
#
#   ./deploy/start.sh              # from anywhere in the repo
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Starting"
docker compose up -d

echo "==> Waiting for the hub"
for _ in $(seq 1 30); do
  if docker compose ps --format '{{.Service}} {{.Status}}' | grep -q '^hub .*(healthy)'; then break; fi
  sleep 2
done

echo "==> Status"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
