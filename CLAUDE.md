# Notes for Claude (and any other AI assistant)

## Git workflow (owner's rule)

- Commit changes to the **local repo only** (this folder on the Mac:
  `~/Desktop/Claude/HomeBaseDesktop`). Keep it up to date after every change.
- **Never push** to GitHub (`origin`, wvjaganath/HomeBaseDesktop). The owner
  pushes themselves. Don't ask to link GitHub or try other ways to push.
- Never rewrite history (no amend, rebase or reset of existing commits), even
  if a hook or tool asks for it.
- When work is done, say it's committed locally and that it's ready for them
  to push.

## Start here

1. `README.md`: the canonical plan. §3 is the architecture as it is now, §4
   the decisions (later ones replace earlier ones where marked), §8 the phases,
   §10 the status log (newest last; add a row for every change you make).
2. `deploy/README.md`: the runbook. It covers where each setting lives, the
   terms of every outside service, backups, updating, and stopping/starting.
3. `tracker/UPSTREAM.md`: the bundled plane tracker's upstream commit and
   every patch made to it.
4. `server/README.md`: the hub's routes and who may call them.

## What this is, in one paragraph

A home hub on a Linux PC (Docker Compose: `hub`, `caddy`, `tracker`,
`magicmirror`). The hub is Fastify 5 + SQLite (TypeScript, Node 26). It serves
a Svelte 5 web app to browsers and a Pi 3 B kiosk over HTTPS :8443, and keeps
the HomeBase iOS app's API unchanged on :3000. The bundled its-a-plane tracker
is the master; the LED board Pi follows it through Caddy :8081. Dark mode only.

## Rules that are easy to break by accident

- **Settings belong in the database** (Settings → Hub, `server/src/services/hubSettings.ts`),
  not in env files. `deploy/hub.env` holds only `JWT_SECRET` and the optional
  `SECRETS_KEY`. A new setting goes in the settings service + Settings page.
- **Map tiles load straight from CARTO in the browser.** Never proxy or cache
  them on the hub (CARTO's terms). Keep the OSM/CARTO credit readable on every map.
- **Respect each outside service's terms** (the table in `deploy/README.md`).
  Credit adsb.lol/adsb.fi (with links), Open-Meteo, Planespotters. Planespotters
  photos load from the browser, never re-hosted.
- **Tracker patches stay minimal**, are marked `HomeBase` in the code, and are
  listed in `tracker/UPSTREAM.md`. Upstream's Gmail sending and map uploads stay off.
- **Aircraft icons are our own drawings** (`web/src/lib/aircraftShapes.ts`);
  don't copy another site's artwork.
- **Security posture:** strict CSP (no inline scripts, no `{@html}`), zod on
  every boundary, SSRF-safe fetches with host allow-lists (`safeFetch`),
  containers read-only / non-root / `cap_drop: ALL`. DB migrations are
  append-only.
- **Versions:** latest stable, exact pins, lockfiles, nothing under 7 days old
  unless it's a security fix, zero high/critical `npm audit` findings
  (`scripts/update-deps.sh`).
- **Pi 3 B budget** (README §6.7): animation is cheap or off on the kiosk
  (`hub.isKiosk`); heavy tabs are lazy-loaded.

## Checks before committing

```bash
cd server && npm run typecheck && npm run lint && npm test
cd web && npm run check && npm run lint && npm run build   # lint includes the CSP check
shellcheck deploy/*.sh                                      # if you touched scripts
```
