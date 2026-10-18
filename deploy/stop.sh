#!/usr/bin/env bash
# Stop HomeBase on the Linux PC: hub, HTTPS front door (Caddy), plane tracker
# and MagicMirror. Takes a database backup first. Nothing is deleted: data,
# backups, settings and the containers themselves stay, so ./start.sh brings
# everything back as it was.
#
#   ./deploy/stop.sh               # from anywhere in the repo
#   ./deploy/stop.sh --no-backup   # skip the backup
#
# HomeBase stays off after a reboot until you run ./deploy/start.sh
# (the containers are "restart: unless-stopped").
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"

backup=1
for arg in "$@"; do
  case "$arg" in
    --no-backup) backup=0 ;;
    -h|--help) sed -n '2,11p' "$here/stop.sh" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

running=$(docker compose ps --status running --services 2>/dev/null || true)
if [ -z "$running" ]; then
  echo "HomeBase is already stopped."
  exit 0
fi

if [ "$backup" = 1 ]; then
  echo "==> Backup"
  if grep -qx hub <<<"$running"; then
    docker compose exec -T hub node dist/scripts/backup.js \
      || echo "    backup failed; stopping anyway (nightly backups are in ./backups)"
  else
    echo "    hub not running; skipping"
  fi
fi

echo "==> Stopping"
# Front door first so screens stop sending requests, then the rest.
docker compose stop --timeout 20 caddy
docker compose stop --timeout 20

echo "==> Status"
docker compose ps --all --format 'table {{.Service}}\t{{.Status}}'
echo
echo "HomeBase is stopped. Start it again with ./deploy/start.sh"
