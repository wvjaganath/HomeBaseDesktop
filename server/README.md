# HomeBase hub server

Sync + accounts server for the HomeBase iOS app, and the backend for the
HomeBase Desktop web app (served from `web-dist/`). Still self-contained: after
`npm run build` in `../web`, this folder can be copied anywhere on its own.
For production use the Docker setup in `../deploy` (see `../deploy/README.md`).

```bash
npm ci                      # lockfile created by ../scripts/update-deps.sh
cp .env.example .env && chmod 600 .env   # set JWT_SECRET (openssl rand -hex 32)
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

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/web/login` · `/auth/web/refresh` · `/auth/web/logout` | — / cookie | httpOnly SameSite=Strict cookie sessions |
| GET | `/auth/me` | user or screen | Who am I (+ screen settings) |
| GET | `/api/stream?topics=tracker,radar,items,calendar` | user or screen | Server-Sent Events |
| GET | `/api/config` · `/api/tracker` · `/api/radar` · `/api/lists` | user or screen | Dashboard data |
| GET | `/api/radar/details/:hex?callsign=` | user or screen | Route + airframe (adsbdb, cached) |
| GET | `/api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` | user or screen | Expanded calendar events |
| GET | `/api/logo/:icao?kind=square\|banner&h=96` | user or screen | Resized airline logo (WebP) |
| GET/POST/PATCH/DELETE | `/api/calendars[/:id]` | user | Google iCal sources (URLs write-only, encrypted) |
| GET/POST/PATCH/DELETE | `/api/devices[/:id]`, POST `/api/devices/:id/reload` | user | Kiosk screens |
| GET | `/kiosk/pair?t=…` | — | Pairing link → read-only screen cookie |
| GET | `/legacy/` | — | The original weight-loss/nutrition tracker website |

"Screen" principals (kiosk device tokens) can only call read-only routes.

## Security

See README §7. In short: argon2id, rotating hashed refresh tokens, cookie
sessions with an Origin-check CSRF guard, strict CSP, rate limits, zod
validation of every input including upstream API responses, SSRF-guarded
outbound fetches with host allow-lists, encrypted calendar URLs, no query
strings in logs. **LAN only. Never port-forward this to the internet.**
