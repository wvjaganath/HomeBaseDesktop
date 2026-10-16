#!/usr/bin/env bash
# Resolve every dependency to its latest release that is at least 7 days old
# (README §7.2 rule 4: cooling-off period), pin exact versions, regenerate the
# lockfiles, then run the audit gate. Use for first setup and the weekly update.
#
#   ./scripts/update-deps.sh            # both packages
#   COOL_OFF_DAYS=0 ./scripts/update-deps.sh   # only for an urgent security fix
set -euo pipefail
cd "$(dirname "$0")/.."

DAYS="${COOL_OFF_DAYS:-7}"
BEFORE="$(date -u -d "-${DAYS} days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-"${DAYS}"d +%Y-%m-%dT%H:%M:%SZ)"
echo "Resolving versions published before ${BEFORE}"

SERVER_DEPS=(@fastify/cookie @fastify/helmet @fastify/rate-limit @fastify/static argon2 better-sqlite3 fastify jose node-ical sharp zod)
SERVER_DEV=(@eslint/js @types/better-sqlite3 @types/node eslint eslint-plugin-security globals tsx typescript typescript-eslint vitest)
WEB_DEPS=(@fontsource-variable/instrument-sans @fontsource/dotgothic16 @fontsource/ibm-plex-mono leaflet)
WEB_DEV=(@eslint/js @sveltejs/vite-plugin-svelte @types/leaflet eslint eslint-plugin-svelte globals svelte svelte-check typescript typescript-eslint vite)

latest() { local out=(); for p in "$@"; do out+=("${p}@latest"); done; printf '%s\n' "${out[@]}"; }

install() {
  local dir="$1"; shift
  local -n deps="$1"; local -n dev="$2"
  echo "==> ${dir}"
  ( cd "$dir"
    # shellcheck disable=SC2046
    npm install --save-exact --before="$BEFORE" $(latest "${deps[@]}")
    # shellcheck disable=SC2046
    npm install --save-exact --save-dev --before="$BEFORE" $(latest "${dev[@]}")
    npm rebuild --ignore-scripts=false better-sqlite3 argon2 2>/dev/null || true
    npm audit --omit=dev --audit-level=high
  )
}

install server SERVER_DEPS SERVER_DEV
install web WEB_DEPS WEB_DEV

echo
echo "Done. Review the version changes (git diff */package.json), run the tests, then commit the lockfiles."
