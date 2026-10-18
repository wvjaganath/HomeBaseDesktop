# HomeBase hub server

Sync + accounts server for the HomeBase iOS app, and the backend for the
HomeBase Desktop web app (served from `web-dist/`). Still self-contained: after
`npm run build` in `../web`, this folder can be copied anywhere on its own.
For production use the Docker setup in `../deploy` (see `../deploy/README.md`).

```bash
npm ci                      # lockfile created by ../scripts/update-deps.sh
cp .env.example .env && chmod 600 .env   # JWT_SECRET (openssl rand -hex 32); the rest is in Settings → Hub
npm run dev                 # development (tsx watch)
npm run build && npm start  # production: compiled JS, Node --env-file
npm test                    # vitest
```

Requires Node 24.11+ (Node 26 recommended). No `dotenv`: Node loads `.env` itself.

## API

### Unchanged (iOS app)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | Reachability probe |
| POST | `/auth/register` | — | Create account (when `ALLOW_REGISTRATION=true`) |
| POST | `/auth/login` | — | Access + refresh tokens (JSON) |
| POST | `/auth/refresh` | — | Rotate refresh token (reuse detection) |
| POST | `/auth/logout` | — | Revoke session chain |
| GET | `/users` | Bearer | The two accounts (share picker) |
| POST | `/sync/push` | Bearer | Batched upserts, LWW by `updatedAt` |
| GET | `/sync/pull?since=N` | Bearer | Delta changes you own or that are shared with you |
| POST | `/shares` | Bearer | Share a note/reminder |
| DELETE | `/shares/:id` | Bearer | Unshare |

### New (web app and screens)

"Viewer" = a signed-in person **or** a paired screen (read-only kiosk token).
"Person" = signed-in people only. Every state-changing browser request also
passes the Origin-check CSRF guard.

| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/auth/web/login` · `/auth/web/refresh` · `/auth/web/logout` | — / cookie | httpOnly SameSite=Strict cookie sessions |
| GET | `/auth/web/options` | — | Sign-in screen: is first-account setup / sign-up open? |
| POST | `/auth/web/register` | — | First account, or sign-up when allowed in Settings → Hub |
| POST | `/auth/web/reset` | — | Use a one-time reset link (made on the PC with `users.js reset-link`) |
| POST | `/auth/web/password` | person | Change password (ends other sessions) |
| GET | `/auth/me` | viewer | Who am I (+ screen settings) |
| GET | `/api/stream?topics=tracker,radar,items,calendar` | viewer | Server-Sent Events |
| GET | `/api/config` · `/api/tracker` · `/api/radar` · `/api/lists` | viewer | Dashboard data (`/api/config` includes the CARTO tile URL, home, units, why the radar is off) |
| GET | `/api/radar/details/:hex?callsign=` | viewer | Route + airframe (adsbdb, cached) |
| GET | `/api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` | viewer | Expanded calendar events |
| GET/POST/PATCH/DELETE | `/api/calendars[/:id]` | person | Google iCal sources (URLs write-only, encrypted) |
| GET | `/api/logo/:icao?kind=square\|banner&h=96` | viewer | Resized airline logo (WebP) |
| GET | `/api/tracker/stats[/:date]` · `/records` · `/tracked` | viewer | The tracker's stats, closest/farthest records, tracked flight |
| GET | `/api/tracker/api-log` | person | The tracker's API call log |
| POST/DELETE | `/api/tracker/tracked[/lookup]` · POST `/api/tracker/route-search` | person, rate limited | Track a flight (spends API credits) |
| GET/PUT | `/api/tracker-admin/settings` · GET `/status` `/wifi` · POST `/restart` `/wifi/scan` `/wifi/connect` | person | Settings → Plane tracker (server tracker or LED board), validated against the tracker's allowed values |
| GET/PUT | `/api/hub-settings` | person | Settings → Hub (secrets write-only) |
| GET/POST | `/api/people` | person | Settings → People (list, add) |
| GET · POST | `/api/status` · `/api/status/backup` | person | Settings → Status; back up now |
| GET/POST/PATCH/DELETE | `/api/devices[/:id]`, POST `/api/devices/:id/reload` | person | Kiosk screens |
| GET | `/kiosk/pair?t=…` | — | Pairing link → read-only screen cookie |
| GET | `/mirror/*` (+ websocket) | viewer | Allow-listed proxy to MagicMirror |
| GET | `/internal/mirror/bootstrap` · `/internal/mirror/config` | MagicMirror container only | Its token, home and units (answered only to `MIRROR_CLIENT_IP`) |
| GET | `/legacy`, `/legacy/*` | — | Redirect to the Weight loss tab (the old website is retired) |

Screens (kiosk device tokens) can only call read-only routes.

## Settings

Everything except `JWT_SECRET` (and the optional `SECRETS_KEY`) lives in the
database and is edited in **Settings → Hub** (`src/services/hubSettings.ts`).
`src/env.ts` still parses the old variables: on the very first start their
values are imported once, and tests use them as defaults. See
`../deploy/README.md` → "Where each setting lives".

## Security

See README §7. In short: argon2id, rotating hashed refresh tokens, cookie
sessions with an Origin-check CSRF guard, strict CSP, rate limits, zod
validation of every input including upstream API responses, SSRF-guarded
outbound fetches with host allow-lists, encrypted calendar URLs, no query
strings in logs. **LAN only. Never port-forward this to the internet.**
