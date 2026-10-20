# HomeBase Desktop

The browser-based companion to the HomeBase iOS app. It's one home **hub server** on the Linux PC that holds everything: your HomeBase data, the plane tracker, the radar, the calendar and MagicMirror. Any browser on the home network can open it, whether that's a laptop, a desktop (installable as an app window), or a Raspberry Pi 3 B running Chromium full-screen on a monitor.

> **Purpose of this README:** like `../HomeBase/README.md`, this is the canonical, complete plan. If Claude (or anyone) loses context, feeding this single file back restores the decisions, architecture, phases and current status. **Start with** §3 (architecture as it is now), §4 (decisions; later ones replace earlier ones where marked), §8 (phases) and §10 (status log, newest last). The runbook is `deploy/README.md`, the bundled tracker's patches are in `tracker/UPSTREAM.md`, and `CLAUDE.md` has the working rules for AI assistants.

---

## 1. Goals

1. **Desktop HomeBase.** Everything the phone app does (notes, reminders, health charts, weight loss, nutrition, calendar) available in a browser, reading and writing the same data the phones sync.
2. **One backend.** The HomeBase sync server moves into this repo and runs on the Linux PC as the hub server. The iOS app keeps working **unchanged** (same routes, same protocol).
3. **HD plane tracker.** The flight board from [c0wsaysmoo/plane-tracker-rgb-pi](https://github.com/c0wsaysmoo/plane-tracker-rgb-pi), redrawn natively in the browser at full resolution. It uses crisp vector text, high-res airline logos and aircraft photos, not a scaled-up 64×32 pixel grid.
4. **Live radar map.** A dark map centred on home showing every aircraft nearby. It highlights the flight the tracker is announcing, and you can click any plane for its details.
5. **MagicMirror-style home page.** Clock, weather, Google Calendar, HomeBase notes and reminders, and the live flight, on one glanceable page. The full [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) runs on the server as an optional tab for community modules (see §6.4 for why it isn't the home page itself).
6. **Light enough for a Pi 3 B.** The server does all the heavy lifting; the Pi only renders. There's a hard memory and CPU budget (§6.7).

### Non-goals (for now)
- Internet exposure. The hub stays **LAN-only**, same posture as today.
- Replacing the LED matrix. The Pi 3 A+ tracker keeps running; the browser board is an addition.
- A native desktop app (Electron/Tauri). See D15: the browser plus an installable PWA is lighter and gives the same "app" feel.
- Multi-user visibility rules for the new sections. Your wife's account just sees the HomeBase modules as today; per-user section access is a later add.

---

## 2. Why the current mirror looks blurry (and the fix)

The tracker's `/display` page (`web/templates/display.html`) fetches `/overhead/json`, `/clock/json` and `/weather/json`. It then **re-draws them onto a canvas sized to the 64×32 LED grid** and scales that up, so every glyph and logo is a fat pixel. The 16×16 airline logos in `logo/` make it worse.

The data is already clean JSON (callsign, origin/destination, delays, `plane_latitude`/`plane_longitude`, `heading`, `altitude`, `vertical_speed`, distance, direction, weather, alerts). So the fix is **not** a better upscaler. The hub reads the same JSON and lays it out with plain HTML/CSS/SVG at native resolution. Text is vector, so it stays sharp at any screen size, and plain DOM is also far cheaper for a Pi 3 B than redrawing a canvas.

---

## 3. Architecture

Current as of 2026-10-18. (The first plan had the LED Pi as the master tracker and the hub on ports 3000 + 8080 with no HTTPS; D18 and D19 replaced that.)

```
Linux PC: Docker Compose, LAN only (deploy/docker-compose.yml)

  iPhones (HomeBase iOS) ── :3000 (plain HTTP, Bearer tokens) ───────────┐
  Browsers + Pi 3 B kiosk ─ :8443 HTTPS ─► caddy (local CA) ──────────────┤
                            :8080 → 308 redirect to :8443                 ▼
                                               hub  (Fastify 5 + SQLite, TypeScript, Node 26)
                                                ├─ web app (Svelte 5 SPA, PWA) and /api/stream (SSE push)
                                                ├─ /auth /sync /shares /users  (unchanged for iOS)
                                                ├─ settings in SQLite (Settings → Hub), applied live
                                                ├─ radar poller ─────────────► adsb.lol (adsb.fi fallback)
                                                ├─ route + airframe lookup ──► adsbdb
                                                ├─ Google calendars (iCal) ──► calendar.google.com
                                                ├─ /api/tracker*, /api/tracker-admin/* ──► tracker
                                                └─ /mirror/* proxy (+ websocket) ───────► magicmirror
                                               tracker  (its-a-plane-python, headless, MASTER)
                                                └─ adsb.lol (OpenSky fallback), FR24 / AirLabs / FlightAware
                                                   (your keys), Tomorrow.io (if key), NWS, FAA, CelesTrak
                                               magicmirror  (MagicMirror² 2.38, serveronly, no published port)
                                                └─ api.open-meteo.com (weather module)
  LED board Pi 3 A+ ─────── :8081 ─► caddy: 6 read-only GET feed paths, LAN only ─► tracker
  (runs its-a-plane as a SLAVE of this PC: draws only, holds no API keys)

  Straight from each browser, never through the hub (CARTO's and Planespotters' terms require it):
    map tiles   basemaps.cartocdn.com  (CARTO key from Settings → Hub)
    photos      Planespotters (thumbnail + credit link)
    rain radar  RainViewer (desktop only)
```

Key properties:
- **One address for people:** `https://<linux-pc>:8443`. The tracker and MagicMirror are reached *through* the hub (`/api/tracker…`, `/mirror/…`), so there's no CORS and neither has a published port. The iPhones keep `http://<linux-pc>:3000`.
- **One tracker, on the server.** The bundled tracker is the master: it does every lookup with your API keys once, and both the hub and the LED board read from it. So the LED board and the hub never spend extra API credits.
- **Settings live in the database**, edited in the browser and applied without a restart. `deploy/hub.env` holds only `JWT_SECRET` (and the optional `SECRETS_KEY`) (D20).
- **The server does the work, the Pi only paints.** Polling, merging, route lookups, image resizing and the maths happen on the Linux PC; screens get small pushed updates over Server-Sent Events.

---

## 4. Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Repo | `HomeBaseDesktop/` becomes the home of the **server** + **web app** + **mirror config** + **deploy scripts**. `HomeBase/` keeps only the iOS app. | You asked to move the backend here, and the server was already designed to be copyable. |
| D2 | Moving the server | Use `git subtree split --prefix=server` (or `git filter-repo --path server/`) so the server's history comes along. | Keeps blame/history; the iOS repo's README then points here. |
| D3 | Server stack | Keep **Node + Fastify 5 + better-sqlite3 + zod + jose + argon2** (TypeScript via tsx). Add `@fastify/http-proxy`, `@fastify/cookie`, `node-ical`, `sharp`. | Already proven and tested; no rewrite. |
| D4 | Web app | **Vite + TypeScript + Svelte 5**, built into `server/web-dist/`. | Svelte compiles to small plain JS with no virtual DOM, giving the lowest browser RAM of the mainstream options. Target JS bundle under 150 KB gzip. |
| D5 | Map | **Leaflet** with dark **raster** tiles (CARTO Dark Matter, now with a key: D21) and one canvas layer for aircraft. | A Pi 3 B's GPU can't run WebGL maps (MapLibre) smoothly. Raster tiles plus canvas are cheap, and the server pre-computes everything. |
| D6 | Live aircraft feed | Hub polls **adsb.lol** `/v2/lat/{lat}/lon/{lon}/dist/{nm}` every 5 s (the same provider the tracker already uses), with **adsb.fi** as fallback. | Free and no key. One request per 5 s is well under limits. Personal/non-commercial use only; credit adsb.lol/adsb.fi on the map. |
| D7 | Logos | High-res logos keyed by **ICAO** (same keys the tracker uses) from [Jxck-S/airline-logos](https://github.com/Jxck-S/airline-logos), downloaded by a script and **resized server-side by `sharp`** to exactly the size each screen needs. Falls back to the tracker's 16 px logo with `image-rendering: pixelated`. | Sharp on any display without making the Pi decode huge images. Fair-use/identification only, so personal use. |
| D8 | Aircraft photos | [Planespotters.net photo API](https://www.planespotters.net/photo/api), called **from the browser** (by hex), small thumbnail, photographer credit plus a link. | Their terms forbid proxying or re-hosting images and require visible attribution. |
| D9 | Weather overlay (optional, desktop only) | RainViewer past-radar tiles (free for personal use; max zoom 7). Off on the Pi. | An extra tile layer is too much for a Pi 3 B. |
| D10 | Auth for browsers | Move the web session from `localStorage` to an **httpOnly cookie** (same JWT/refresh logic). Add long-lived, **read-only device tokens** for kiosks. | The kiosk never needs a login, and an iframe (MagicMirror tab) can't send Bearer headers. |
| D11 | Server host | **Linux PC, Docker Compose**: `hub`, `caddy` (D19), `tracker` (D18), `magicmirror` (optional). | One `docker compose up -d`, easy updates, and backup is one SQLite file plus the config folder. |
| D12 | Ports | *Replaced by D19.* Originally: the hub on both `:3000` and `:8080`. | |
| D13 | Display hardware | **Pi 3 B (1 GB)** as the kiosk. The Pi 3 A+ (512 MB) stays the LED tracker. | See the budget in §6.7. |
| D14 | Layout | **Home dashboard + tabs** (§6.1). | Best fit for a single Pi screen, and works the same on a desktop. |
| D15 | Browser vs. desktop app | **Browser.** On desktops/laptops, install it as a **PWA** (Chrome/Edge "Install app") for its own window, icon and no browser bars. **No Electron.** | Electron ships its own Chromium plus Node per app, so it uses *more* RAM and wouldn't run well on a Pi 3 B. A PWA gives the app feel for free, and updates are instant because it's served by the hub. |
| D16 | Calendar | **Google Calendar via its "secret address in iCal format"** (read-only, no OAuth), fetched by the server every 5 minutes. Several calendars can be added. | Simplest and safe. Two-way (adding events from the hub) would need Google OAuth and is a later add. |
| D17 | Theme | **Dark mode only**, everywhere. No light theme, no toggle. | User preference (2026-10-16). Also simpler: one palette to tune and test. |
| D18 | Plane tracker | **Bundled** (2026-10-17): its-a-plane-python copied into `tracker/app` and run headless in the `tracker` container as the **master**; the LED Pi runs the original as a **slave** of it via Caddy `:8081` (six read-only GET paths, private addresses only). Upstream's email (shared Gmail password in the code) and map uploads to the author's server are switched off; every change is listed in `tracker/UPSTREAM.md`. HomeBase is its only UI (the Flights section's tracker page `#/tracker` for stats, records, tracking and the API log; Settings → Plane tracker). | All API keys and lookups in one place; the 512 MB Pi only drives LEDs; nothing about your home leaves the house. |
| D19 | HTTPS and ports | **Caddy** with its own local CA on **8443** (443 is used by other software on the PC), **8080** redirects to it, **3000** stays plain HTTP for the iPhones, **8081** is the LED feed. The hub trusts `X-Forwarded-*` only from Caddy's fixed address. | `Secure`/`__Host-` cookies and HSTS for browsers without breaking the phones' saved address. |
| D20 | Where settings live | **The database, edited in Settings → Hub** (2026-10-17): sign-up, session lengths, radar on/off and range, ADS-B contact, CARTO key (encrypted, write-only), LED board address (home-network addresses only), backups, log level. `hub.env` keeps only `JWT_SECRET` and the optional `SECRETS_KEY`, because they protect the database itself. Home location and units come from **Plane tracker → Location**. MagicMirror gets its token, home and units from the hub at start (`/internal/mirror/bootstrap`, answered only to its fixed container address) and restarts itself when they change. On first start old `hub.env` values are imported once. | The owner asked for one place to change things; env files drift and are hard to track. |
| D21 | Map tiles | **Straight from CARTO in the browser**, keyed URL `basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=…`, no hub relay or cache (2026-10-18). Readable "© OpenStreetMap contributors © CARTO" on every map. | CARTO's basemap terms forbid server-side proxying or caching. The key is therefore visible to signed-in browsers and screens; restrict it to your hub's address in CARTO's dashboard. |
| D22 | Outside services | Stay within each one's free terms; the table is in `deploy/README.md` ("Outside services and their terms"). Credit adsb.lol / adsb.fi (linked), Open-Meteo, Planespotters, CARTO/OSM. | The owner asked that nothing breaks a service's terms or free-usage limits. |
| D23 | Aircraft icons | **Original** top-down silhouettes (not copied from Flightradar24 or anyone), 12 classes chosen from the ICAO type code, else the ADS-B emitter category: light, turboprop, business jet, regional, narrowbody twin, widebody twin, four-engine, helicopter, glider, military jet, balloon, ground vehicle. Size scales with the class. `web/src/lib/aircraftShapes.ts`. | Recognisable at a glance (a 747/A380 shows four engines) without using anyone's artwork. |
| D24 | Git | Commit to the owner's **local** repo only; **never push**, never rewrite history. The owner pushes. See `CLAUDE.md`. | Owner's rule. |
| D25 | Stopping it | `deploy/stop.sh` / `deploy/start.sh`. Portainer may stop/start the containers (the stack shows as `deploy`, "created outside of Portainer") but must not remove or redeploy it. | The stack builds from the repo and uses files beside it that a Portainer-deployed copy wouldn't have. |

---

## 5. Repository layout

```
HomeBaseDesktop/
├── README.md                    ← this file (canonical plan, decisions, status log)
├── CLAUDE.md, AGENTS.md         ← orientation + the owner's git rule for AI assistants
├── server/                      ← hub server (from HomeBase/server, history preserved), still standalone
│   ├── src/
│   │   ├── index.ts, app.ts     # bootstrap; helmet/CSP, rate limits, static web-dist, settings hooks
│   │   ├── env.ts               # zod-parsed env (now mostly first-run import + test defaults, D20)
│   │   ├── db.ts                # SQLite schema, append-only migrations
│   │   ├── routes/              # auth, sync, shares (UNCHANGED for iOS) + new:
│   │   │   ├── stream.ts        #   GET /api/stream (SSE fan-out)
│   │   │   ├── dashboard.ts     #   /api/config, tracker, radar (+details), lists, calendar(s)
│   │   │   ├── devices.ts       #   kiosk screens: tokens, pairing, screen settings
│   │   │   ├── hubSettings.ts   #   Settings → Hub (GET/PUT /api/hub-settings)
│   │   │   ├── people.ts        #   Settings → People
│   │   │   ├── trackerData.ts   #   tracker stats, records, tracked flight, route search, API log
│   │   │   ├── trackerSettings.ts # Settings → Plane tracker (+ LED board), Wi-Fi, restart
│   │   │   ├── logos.ts         #   sharp-resized airline logos
│   │   │   ├── mirror.ts        #   /mirror/* allow-listed proxy (http + ws) to MagicMirror
│   │   │   ├── mirrorBootstrap.ts # /internal/mirror/* start-up settings for MagicMirror
│   │   │   └── status.ts        #   /api/status + "back up now"
│   │   ├── services/            # hubSettings, home (location/units), tracker adapter + admin + data,
│   │   │                        # radar (ADS-B), routeLookup (adsbdb), calendar (iCal), lists, backup, userAdmin
│   │   ├── security/            # principals + cookies, CSRF guard, SSRF-safe fetch (lanOnly option), secret box
│   │   └── scripts/             # backup.ts, users.ts (list / add / reset-password / reset-link)
│   ├── test/                    # vitest + Fastify inject (86 tests)
│   └── web-dist/                # built web app (gitignored; produced by web/)
├── web/                         ← Vite + Svelte 5 SPA (PWA manifest), dark only
│   ├── scripts/check-csp.mjs    # fails the build on anything the CSP would block
│   └── src/
│       ├── screens/             # Home, Flights, PlaneLog (tracker stats/records/tracking), Radar, CalendarPage,
│       │                        # Notes, Reminders, Fitness, Nutrition, Health, Mirror, Settings, TrackerSettings, Login, ResetPassword
│       ├── components/          # MiniRadar (live Home map), RecordMap, FlightHero, MonthCalendar, HubSettingsPanel,
│       │                        # StatusPanel, PeoplePanel, charts, dialogs…
│       ├── lib/                 # api client, SSE hub store, sync store, router, planeLayer (canvas aircraft),
│       │                        # aircraftShapes (D23), format (tileUrl, MAP_CREDIT)
│       └── data/                # exercise library, default plan, recipes
├── tracker/                     ← bundled plane tracker (D18)
│   ├── app/                     # its-a-plane-python at a pinned upstream commit, minimal patches
│   ├── headless/                # homebase_run.py supervisor, no-op rgbmatrix stand-in, failing sudo
│   ├── requirements.txt         # exact versions with hashes
│   └── UPSTREAM.md              # source commit, every patch, how to update
├── mirror/                      ← MagicMirror² for the Mirror tab
│   ├── homebase-start.cjs       # gets token/home/units from the hub, then starts serveronly (D20)
│   ├── config/                  # config.js (basePath "/mirror/"), basepath.js, custom.css
│   ├── modules/MMM-HomeBase/    # agenda, reminders, pinned notes via a read-only screen token
│   └── patch-index.cjs          # image-build patch: no inline script, pre-generated positions.js
├── deploy/
│   ├── docker-compose.yml       # hub + caddy + tracker + magicmirror (+ logos tool)
│   ├── hub/caddy/tracker/mirror .Dockerfile
│   ├── caddy/Caddyfile          # HTTPS (local CA) :8443, :8080 redirect, :8081 LED feed
│   ├── hub.env.example          # JWT_SECRET (+ optional SECRETS_KEY) only
│   ├── pin-images.sh, update.sh, stop.sh, start.sh
│   ├── kiosk/setup-pi.sh        # Pi 3 B: Chromium kiosk, CA trust, memory tuning, auto-restart
│   └── README.md                # the runbook (setup, settings table, outside services' terms, backups, updating, stopping)
└── scripts/update-deps.sh       # latest versions ≥ 7 days old, exact pins, audit gate
```

**Server copyability rule (carried over):** `server/` never imports from outside itself. `web/` builds *into* `server/web-dist/`, so after a build you can still copy `server/` alone to any box.

---

## 6. Feature design

### 6.1 Layout: home dashboard + tabs

One app, the same on the Pi and on a desktop. A slim **tab bar** (left rail on wide screens, hidden on the kiosk until you move the mouse) and a **Home** tab that is the glanceable, MagicMirror-style page:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 9:41 PM                Fri, Oct 16 ◐          72°  ☀  Sat 75° Sun 68° Mon 70° │  clock · date · moon · weather
├──────────────────────────────┬───────────────────────────────────────────────┤
│ CALENDAR (Google)            │ ✈ OVERHEAD NOW                                │
│ Today                        │ [Southwest logo]   MDW ━━━━━━✈━━━━ ONT        │
│  10:00  Dentist              │ Chicago Midway      ▸ 41% ▸     Ontario, CA   │
│  18:30  Dinner w/ Raj        │ SWA3508 · Boeing 737-800 · 7,875 ft ↑ · 4 mi S│
│ Tomorrow                     │ (idle: "Clear skies — next plane soon" +      │
│  09:00  Gym                  │  mini radar of nearby traffic)                │
├──────────────────────────────┼───────────────────────────────────────────────┤
│ REMINDERS                    │ NOTES (pinned)                                │
│  ☐ Pay electricity  (today)  │  Groceries   ☐ milk ☐ eggs ☑ rice             │
│  ☐ Call mom  (overdue)       │  Packing list  3/12                           │
├──────────────────────────────┴───────────────────────────────────────────────┤
│ ⚠ ORD ground delay 45 min · ISS overhead in 6 min                             │  alerts ticker
└──────────────────────────────────────────────────────────────────────────────┘
 Tabs: Home · Flights · Radar · Calendar · Notes · Reminders · Fitness · Nutrition · Health · Mirror · Settings
```

- **Home calendar is a full month grid** (2026-10-16, for the 27" kiosk screen): event chips in each day, previous/next month and Today buttons, colour per calendar (Google calendars + HomeBase workouts + holidays). Reminders, a pinned note and a sky card with a **live mini radar** (2026-10-18: a small round map with moving planes, not a picture; tap it for the Radar tab) sit in a right-hand column. The wireframe above shows the older agenda version; the mockup canvas is the current reference.
- **Home** is the default on the Pi. When a flight enters the tracker's box, the flight card grows to take most of the screen (**auto-focus**) and shrinks back when the plane leaves. You get the full plane board without switching tabs.
- **Flights** is the full-screen HD board (§6.2), **Radar** the map (§6.3). The others are the HomeBase modules.
- Same brand as iOS: teal `#0F9D8F`, H monogram, module accents (Health coral, Notes amber, Reminders violet, Weight loss blue, Nutrition orange, Home indigo). **Dark mode only** (D17), on the kiosk and on desktop. No light theme is built.
- Data access uses the **existing sync protocol** (`/sync/pull` + `/sync/push`, LWW). That's the same approach `server/public/js/storage.js` uses today, so phones and browser stay in sync with no new data model.

### 6.2 HD plane board (Flights tab, and the Home card when auto-focused)
Data: the tracker's overhead, clock, weather, tracked-flight, ISS, NWS and airport-status feeds, read and validated by the hub (`server/src/services/tracker.ts`), served as `/api/tracker` and pushed over SSE. The tracker's own pages (stats, closest/farthest records with maps, Track a flight, API call log) are rebuilt as a page under Flights (`#/tracker`, `PlaneLog.svelte`, `/api/tracker/*`).

- **Header:** high-res airline banner/logo (server-resized), airline name, flight number, and an aircraft photo thumbnail with credit.
- **Route hero:** large `MDW → ONT` with city names underneath (from the tracker's `airports.json`). Codes keep the tracker's **delay colour semantics** (green/yellow/orange/red/purple/blue, grey = unknown). The arrow becomes a real **progress bar** from red at departure to green at arrival, with the aircraft icon moving along it.
- **Stats row:** distance from home, direction (mini compass), altitude with a climb/descent arrow, ground speed, and the aircraft type full name (from `aircraft_types.json`, e.g. "Boeing 737-800" instead of "B738").
- **Multiple planes:** shown as a stacked list instead of one scrolling line.
- **Idle:** large clock, date with moon phase, temperature (humidity-tinted like the LED), and forecast following the tracker's 3-day/daily/hybrid setting.
- **Tracked flight:** progress, ETA, speed and altitude, with a small route map.
- **Themes:** *Classic LED* (a vector dot-matrix font with a glow that keeps the LED look but stays sharp) and *Clean*. The LED glow uses `text-shadow` only, with no blur filters (Pi budget).

### 6.3 Radar map (Radar tab, plus a live mini map on Home)
- Leaflet with dark CARTO raster tiles loaded straight from CARTO (D21), centred on home, range rings at 5/10/25 mi and a home marker. Map and aircraft credits are shown on every map.
- Aircraft drawn on **one canvas layer** (`web/src/lib/planeLayer.ts`) as heading-rotated **original silhouettes per aircraft type** (D23, `web/src/lib/aircraftShapes.ts`): light single, turboprop, business jet, regional jet, narrowbody twin (737/A320), widebody twin (787/777/A350), four-engine (747/A380/A340), helicopter, glider, military jet, balloon, ground vehicle. Chosen from the ICAO type code, else the ADS-B emitter category; bigger classes draw bigger. Colour-coded by altitude, with callsign labels. Short **trails** (last ~3 min) are kept server-side so a freshly opened screen shows history.
- **Highlight:** the flight the tracker is announcing gets a ring and the brand accent colour. A tracked flight gets its route line (solid flown, dashed remaining).
- **Tap a plane** for a side panel: logo, route (from tracker data if it's the overhead flight, otherwise a free [adsbdb](https://www.adsbdb.com) callsign lookup done and cached by the server), type, registration, altitude/speed/vertical rate, distance, photo.
- **Radar tab, Pi mode:** redraws only when new data arrives (every 5 s), no weather layer. **Desktop mode:** planes glide between polls (dead reckoning from ground speed and track at ~20 fps, capped at 15 s, paused in background tabs) and an optional **RainViewer** rain overlay (button on the map; latest frame, native zoom ≤ 7 as the free API allows, refreshed every 10 min, tile host checked before use).
- **Home mini map** (`web/src/components/MiniRadar.svelte`, lazy-loaded): the same tiles and plane layer, round, non-interactive, 25 mi radius with rings at thirds, smaller icons and no labels. Planes glide at 5 fps on the kiosk and 20 fps on a computer.
- The ADS-B poller (`server/src/services/radar.ts`) only polls while a screen is watching, every 15 s by default (Settings → Hub: 10/15/30/60 s, one request at a time), adsb.fi only when adsb.lol fails or answers 429. Settings → Status says why the radar is off when it is (no home location yet, or switched off).

### 6.4 MagicMirror
**What changed after choosing a Pi 3 B.** Embedding the real MagicMirror on the home page means the Pi runs two full web apps at once: the hub, plus MagicMirror's own client, modules and socket connection. On 1 GB that's the quickest way to a sluggish or crashing kiosk. So:

- **The Home tab *is* the MagicMirror-style screen**, built natively in the hub with the same widgets (clock, weather, calendar, compliments/news optional) plus things MagicMirror can't do out of the box: HomeBase notes/reminders and the live flight.
- **The real MagicMirror² (v2.38.0, pinned to its release commit) still runs on the Linux PC** in `serveronly` mode, behind the hub at `/mirror/` (`basePath: "/mirror/"`, websocket proxied). It's a **Mirror tab** that only loads when you open it and unloads when you leave, for any of the 1,000+ community modules you want later.
- **How the proxy is locked down** (`server/src/routes/mirror.ts`): only signed-in people and paired screens get through; only the paths the page needs are forwarded (an allow-list, with encoded/dot-segment tricks rejected), so MagicMirror's open `/cors` fetch proxy, `/reload` and test fixtures are unreachable; GET/HEAD only (POST just for Socket.IO); any request carrying an `Origin` (and every websocket upgrade) must come from the hub's own origin; the hub's cookies and tokens are stripped before forwarding; and the hub serves it under its own CSP (`script-src 'self' 'unsafe-eval'`, needed by MagicMirror's nunjucks templates; inline scripts stay blocked because the image build moves MagicMirror's one inline script into a file).
- **`MMM-HomeBase`** (custom module, built here) puts HomeBase reminders and pinned notes into MagicMirror too, in case you ever run a dedicated mirror screen.
- If you decide the community modules aren't needed, the MagicMirror container is simply left out of Compose. Nothing else depends on it.

### 6.5 Calendar (Google)
- Each Google calendar's "Secret address in iCal format" (Google Calendar → Settings → the calendar → Integrate calendar) is pasted into hub Settings and **stored server-side only**.
- The server fetches every 5 minutes, expands recurring events, and merges them with HomeBase reminders and workouts. The result feeds the Home widget, the Calendar tab (month grid + day list, like the iOS Calendar screen) and `MMM-HomeBase`.
- Each calendar keeps its own colour.

### 6.6 Kiosk and screen settings
- The Pi opens `https://<linux-pc>:8443/kiosk/pair?t=<token>` once (set by `setup-pi.sh`, which also trusts the hub's local CA). From then on, the **Settings → Screens** page in the hub controls it: start tab, auto-focus on/off, which tabs to rotate through (optional), night schedule (dim or black between set hours, like the LED's night brightness), and a "reload" button. No SSH needed.
- `deploy/kiosk/setup-pi.sh` for the Pi 3 B: Raspberry Pi OS (Bookworm, 32-bit or 64-bit Lite plus a minimal desktop), Chromium `--kiosk --noerrdialogs --disable-infobars --disable-features=Translate`, screen blanking off, zram swap, GPU memory 128 MB, auto-restart Chromium if it exits, and a daily 4 AM browser restart to clear any memory creep.

### 6.7 Pi 3 B performance budget
These are acceptance criteria for every screen, checked on the real Pi:

| Budget | Target |
|---|---|
| Chromium total RSS (kiosk running Home for 24 h) | ≤ 450 MB, no upward creep |
| JS bundle (gzip, initial load) | ≤ 150 KB; Radar/Leaflet and Mirror tabs lazy-loaded |
| Idle CPU on Home | ≤ 15 % average |
| Update traffic | SSE only; the server sends **diffs**, at most every 5 s |
| Images | Served at exact display size (logos, photo thumbnails), WebP |
| Effects | Only `transform`/`opacity` animations; no `backdrop-filter`, `filter: blur`, or large box-shadows |
| Fonts | 1 self-hosted variable font (woff2) + the LED font |
| Resolution | Design at 1920×1080 and verify at 1280×720 (a Pi 3 B runs noticeably better at 720p if the monitor allows) |

### 6.8 Security (carried over and extended)
- LAN-only, never port-forwarded. HTTPS for every browser via Caddy and its own local CA (`tls internal`), which gives `Secure`, `__Host-` cookies; the iPhones keep plain HTTP on :3000 (bearer tokens, LAN only).
- **Tracker display data is read-only GETs** (`/overhead/json`, `/clock/json`, `/weather/json`, `/tracked/json/live`, `/iss/*`, `/nws/json`, `/airport_status/json`, `/logo/*`), available to people and paired screens.
- **Tracker settings (Settings → Plane tracker)**, added 2026-10-17 at the owner's request: the hub calls the tracker's `/api/config`, `/api/restart`, `/api/system`, `/api/usage` and `/api/wifi/{status,scan,connect}` on the owner's behalf, through fixed paths on `TRACKER_URL`'s host only. Only signed-in people can use them (never kiosk screens), behind the CSRF guard and rate limits. Every value is validated against the tracker page's own allowed values before it is sent, and settings the page doesn't show (such as `route_cache`) are kept. API keys stay masked the way the tracker masks them, and Wi-Fi passwords are passed through, never logged or stored. The tracker's own web UI still has no login, so anyone on the Wi-Fi can reach it directly; that is unchanged.
- **Bundled tracker (2026-10-17):** its-a-plane-python runs in its own container on the server: read-only code, non-root, no capabilities, its state on `deploy/tracker-data`, on an internal network the hub and Caddy share with it; its port isn't published. Two upstream behaviours are switched off in the copy: emailing through the author's shared Gmail account (its password was in the code) and uploading the closest/farthest maps, which show your home area, to the author's server. The LED board reads only six read-only feed paths through Caddy `:8081`, from private addresses. The stats screens' reads go through fixed paths and every field is parsed and size-capped before it reaches a browser; **Track a flight** spends API credits, so it's for signed-in people only and rate limited, and the hub keeps the looked-up legs itself so a browser can only pick one of them, not write arbitrary data into the tracker's files. The LED board's address (Settings → Hub, optional) lets the settings screen edit the board too, with the same validation; the hub only ever contacts home-network addresses for it.
- Device tokens are hashed at rest, scoped `display:read`, and revocable from Settings → Screens.
- Google iCal secret URLs are stored only on the server, never sent to browsers.
- **Settings → Hub** (D20) is for signed-in people only. Secrets in it (the CARTO key) are encrypted with the secret box and write-only: the page only ever shows a hint. The LED board address is fetched with `safeFetch({ lanOnly: true })`, which refuses loopback, link-local and public addresses. MagicMirror's start-up settings (`/internal/mirror/*`) are answered only to its fixed container address `172.30.88.30`.
- The CARTO key is the one secret a browser sees, because CARTO's terms require tiles to load straight from CARTO (D21). Restrict it to your hub's address in CARTO's dashboard.
- MagicMirror is only reachable through the authenticated hub proxy.

---

## 7. Engineering standards and security (apply to every phase)

Adopted 2026-10-16. Nothing ships, and no phase is ticked off, unless it meets this section.

### 7.1 Versions: latest stable, pinned

Checked 2026-10-16 against each project's GitHub release tags. Re-check at the start of every phase and use whatever is newest then.

| Component | Version to use | Notes |
|---|---|---|
| Node.js | **26.x** (26.12.0 today) | Enters LTS this month (October 2026); supported until April 2029. Node 24 (24.22.0) is the fallback if a native module lags. MagicMirror supports both. |
| fastify | 5.12.5 (pinned) | The 7-day cooling-off rule picked 5.12.5 over 5.12.7 (published this week); audit and OSV both clean. The old server ran 5.8.5. |
| @fastify/static | 10.1.6 | The current server runs **8.3.0**. 2026 path-traversal / route-guard-bypass advisories (e.g. CVE-2026-15074, high) are fixed in 10.1.x. |
| @fastify/http-proxy | 11.6.4 | **CVE-2026-16117 (critical, CVSS 10)**: prefix-rewrite bypass via URL-encoded paths in ≤ 11.5.0. Fixed in 11.6.0. Never use anything older. |
| @fastify/helmet | 13.1.2 (pinned) | Newest release older than 7 days. |
| @fastify/rate-limit | 11.2.1 | Current: 11.0.0. |
| @fastify/cookie | 11.1.3 | New. |
| better-sqlite3 | 13.0.3 | Current: 12.10.0. Bundles SQLite, so updates also bring SQLite security fixes. |
| argon2 | 0.45.1 | Current: 0.44.0. |
| jose | 6.2.12 | Current: 6.2.3. |
| zod | 4.6.5 (pinned) | Upgraded from 3.25.76; IDs validated with `z.guid()` so existing iOS IDs stay valid. |
| dotenv | **remove** | Node's built-in `--env-file` replaces it: one less dependency. |
| tsx | dev only | Production runs compiled JS (`tsc` → `dist/`, then `node dist/index.js`). |
| TypeScript | 6.0.3 (pinned) | TypeScript 7 exists, but typescript-eslint and svelte-check don't support it yet (peer range < 6.1). Move to 7 when they do. |
| Svelte | 5.57.2 | |
| Vite | 8.3.4 | 2026 dev-server CVEs (e.g. CVE-2026-39363, file read via WebSocket) are fixed in 8.0.5+. The dev server is only ever run on the dev machine, bound to localhost, and is never deployed. |
| Leaflet | 1.9.4 | Latest stable (2.x is not stable yet). Self-hosted, not from a CDN. |
| sharp | 0.35.5 | Bundles libvips; keep current. |
| node-ical | 0.27.3 | |
| pino (logging) | 10.4.0 | Already used by Fastify. |
| vitest / ESLint | 5.0.3 / 10.12.0 (pinned) | Dev only. |
| MagicMirror² | **2.38.0** | **CVE-2026-63641**: Socket.IO ignored `ipWhitelist` in < 2.37.0, which let a LAN client trigger server-side requests and, in one case, command execution via `updatenotification`. Never run < 2.37.0. |

### 7.2 Supply-chain rules

1. **Exact pins + lockfile.** `save-exact=true` in `.npmrc`; `package-lock.json` committed; installs use `npm ci` only.
2. **No install scripts by default.** `ignore-scripts=true` in `.npmrc`. The native modules that need a build step (`better-sqlite3`, `argon2`, `sharp`) are rebuilt explicitly with `npm rebuild <name>`.
3. **Audit gate before every deploy:** `npm audit --omit=dev --audit-level=high` must report **zero high/critical**. Also run `osv-scanner` on the lockfile and `trivy image` on the built containers. Moderate findings are reviewed and noted in the status log.
4. **Cooling-off period:** don't adopt a release that is under 7 days old (except for a security fix). This protects against hijacked-package attacks like the 2025 npm worm incidents.
5. **Fewest dependencies possible.** Prefer Node built-ins (`fetch`, `--env-file`, `node:crypto`). Every new dependency needs a reason in the PR/commit message.
6. **No runtime CDNs.** Fonts, Leaflet, icons and the LED font are all self-hosted and served by the hub.
7. **Update cadence:** a weekly check (`npm outdated` + audit); high/critical fixes applied within 48 hours. Use Renovate or Dependabot if the repo is pushed to GitHub.
8. **SBOM:** `npm sbom --sbom-format cyclonedx` saved with each release.
9. **Docker images pinned by digest**, rebuilt monthly to pick up OS patches.

### 7.3 Code standards

- **TypeScript strict everywhere:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. No `any` without a comment explaining why.
- **ESLint 10 flat config** with `typescript-eslint`, `eslint-plugin-security`, `eslint-plugin-svelte` (including `svelte/no-at-html-tags`: no raw HTML rendering), plus Prettier. Lint and typecheck must pass.
- **Validate everything that crosses a boundary with zod**, not only request bodies: tracker JSON, ADS-B responses, adsbdb lookups, iCal data and env vars are all treated as untrusted input.
- **Tests:**
  - Vitest unit tests.
  - Fastify `inject` integration tests for every route, especially auth, refresh-token reuse detection, share ACLs and the tracker allow-list.
  - Playwright smoke tests for each kiosk screen.
  - The Pi performance budget (§6.7) checked on the real Pi.
- **Errors:** clients get generic messages; details only in server logs; no stack traces in responses.
- **Logging:** pino structured logs with `redact` for `authorization`, cookies, passwords, tokens and iCal URLs.
- **Commits:** small, one concern each, with a clear message. Secrets scanned with `gitleaks` in a pre-commit hook.

### 7.4 Application security

**Authentication and sessions**
- Passwords: argon2id at or above the OWASP baseline (use m = 64 MiB, t = 3, p = 1).
- Access JWTs: HS256 with a ≥ 32-byte random secret, verified with an explicit `algorithms` allow-list plus `iss`/`aud` checks, valid for 15 minutes.
- Refresh tokens: rotating, hashed at rest, with reuse detection (already in place; keep the tests).
- Browser sessions: `httpOnly`, `SameSite=Strict` cookies (`Secure` + `__Host-` prefix once HTTPS is on). State-changing requests also require a matching `Origin` header (CSRF defence in depth). The iOS app keeps Bearer tokens.
- Kiosk device tokens: random 256-bit, stored hashed, scope `display:read` only (cannot write data), revocable, last-used time shown in Settings → Screens.
- Rate limits: `/auth/*` 5/min/IP; device-token pairing 3/min; a global limit elsewhere. Failed logins are logged.

**Browser hardening (the hub's own pages)**
- Strict CSP: `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`; `img-src 'self' data:` plus `basemaps.cartocdn.com`, `*.plnspttrs.net` and `tilecache.rainviewer.com`; `connect-src 'self'` plus `api.planespotters.net` and `api.rainviewer.com` (`server/src/app.ts`; `web/scripts/check-csp.mjs` checks the build against it).
- No inline scripts. Svelte escapes output by default, and raw HTML (`{@html}`) is banned by lint.
- Helmet defaults, plus HSTS once HTTPS is on. `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, and a `Permissions-Policy` that disables camera, microphone and geolocation.

**Server-side requests (SSRF)**
- **Tracker proxy:** the upstream host comes from server config only; requests are an **exact-path allow-list of read-only GETs**; paths are matched after normalisation and decoding (the class of bug behind CVE-2026-16117 / CVE-2026-15074), with an integration test for encoded-path bypasses. Writes (`/api/config`, `/api/restart`, `/wifi/connect`) are never reachable.
- **Google iCal fetches:** host allow-list (`calendar.google.com`), HTTPS only, no redirects to other hosts, 5 s timeout, 5 MB size cap. iCal URLs are stored server-side and never sent to browsers.
- **ADS-B / adsbdb:** fixed hosts only, timeouts, response size caps, and zod-validated responses.
- No endpoint ever fetches a URL supplied by a client.

**Data**
- SQL: parameterised statements only (better-sqlite3 prepared statements); no string-built SQL. The ACL check stays server-side on every pull/push.
- The SQLite DB and `.env` are `chmod 600`, owned by the service user. Nightly backups (SQLite online backup API) are `chmod 600` in a `700` directory; keep an off-machine copy (deploy/README.md §7).

### 7.5 Infrastructure security

**Containers (Docker Compose on the Linux PC)**
- Every container runs as a non-root user, with `read_only: true` root filesystem (only the data volume writable), `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, memory/CPU limits and healthchecks.
- Published ports: Caddy 8443 (HTTPS; not 443, which other software on the PC uses) and 8080 (redirect to HTTPS); the hub 3000 (for the iPhones). MagicMirror has **no published port**: it sits on its own Docker network shared only with the hub and is reachable solely through the authenticated hub proxy (including its Socket.IO). That network keeps outbound internet only because the weather module needs it.
- The hub trusts `X-Forwarded-*` only from Caddy's fixed address (`TRUST_PROXY=172.30.87.10`; `true` is refused at startup), so a LAN client on :3000 can't pretend to be on HTTPS or spoof its IP for rate limits.
- Caddy runs unprivileged on 8080/8443 inside its container (the image build removes the binary's file capability, which `cap_drop: ALL` + `no-new-privileges` would otherwise refuse to exec), with the admin API off and versions below 2.11.4 rejected at build time.
- MagicMirror: `updatenotification` and the sample modules removed from the image; `ipWhitelist` limited to the hub's network; config mounted read-only; no third-party modules without a review of their code.
- Image builds fail on any high/critical `npm audit` finding (hub server, web app, MagicMirror).

**Linux PC (host)**
- Automatic security updates (`unattended-upgrades`).
- Firewall (`ufw`): allow 8443/8080/3000 only from the home LAN subnet, plus SSH.
- SSH key-only (password login off, root login off).

**Pi kiosk**
- Dedicated non-sudo kiosk user, automatic security updates, SSH key-only.
- Chromium kept current via apt.
- Holds only a read-only device token.

**Network**
- LAN-only, no port forwarding, unchanged.
- HTTPS (Caddy + local CA) is moved up from "optional" to **Phase 7, required**, since it enables `Secure` cookies and HSTS.

**Plane trackers**
- The server's tracker (D18) has no published port; its unauthenticated Flask UI is reachable only on the internal Docker network, and HomeBase's Settings → Plane tracker is the way in. The LED board gets six read-only paths through Caddy :8081 from private addresses.
- The LED board Pi's own Flask web UI (:8080) still has no authentication, so anyone on your Wi-Fi can change its settings and Wi-Fi config. Locking down the board itself is a possible later task.

### 7.6 Existing server: findings and Phase 0 fixes

**Resolved 2026-10-16.** All dependencies were re-resolved with `scripts/update-deps.sh` (latest release at least 7 days old, exact pins, lockfiles committed). `npm audit` (prod + dev): **0 vulnerabilities** in server and web. OSV.dev batch check of all 485 locked package versions: **0 known vulnerabilities**.

Comparing the lockfile against published advisories and releases:
- `@fastify/static` **8.3.0 → 10.1.6**: two majors behind; 2026 path-traversal fixes are in 10.1.x.
- `fastify` **5.8.5 → 5.12.7**: newer 2026 security fixes in the 5.x line.
- `zod` 3 → 4, `better-sqlite3` 12 → 13, `argon2`, `jose`, `@fastify/helmet`, `@fastify/rate-limit`: catch up to latest.
- Remove `dotenv`; run compiled JS in production instead of `tsx`.

Phase 0 is done only when the audit gate (§7.2.3) is clean and the existing curl/sync tests still pass against the upgraded server.

---

## 8. Phases

`[x]` done and verified · `[~]` code written, not yet verified on real hardware · `[ ]` not started

Each phase ends with a verification step: curl, a desktop browser, and **the real Pi 3 B against the §6.7 budget**, and meets every rule in §7 (versions, audit gate, tests).

- [~] **Phase 0 — Move the backend to the Linux PC.** *(Code done 2026-10-16: server imported with history, dependencies upgraded and pinned with lockfiles, Docker + runbook in `deploy/`. Remaining: deploy on the Linux PC, verify the iPhones.)* `git init` here. Bring `server/` over with history. Docker Compose with ports 3000 + 8080. Copy the **existing SQLite DB and `.env` (same `JWT_SECRET`)** to the Linux PC, so accounts, refresh tokens and each phone's sync cursor stay valid. A fresh DB would leave the phones' cursors ahead of the server and they'd miss data. **iOS app:** no code change needed. The server address is entered in the app (Settings → Server, stored in UserDefaults `serverURL`), so on each iPhone change it to `http://<linux-pc>:3000` and tap Test connection. The app's ATS setting (`NSAllowsLocalNetworking`) already allows plain HTTP on the LAN. **HomeBase repo:** update its README to say the backend now lives in `HomeBaseDesktop/server`, then remove `HomeBase/server/` once the Linux PC is verified. Optional: add `NSLocalNetworkUsageDescription` to the iOS Info.plist before Phase 11 (real-device install) so the local-network permission prompt has a proper message. **Verify:** the iOS app syncs a note both ways against the Linux PC, and `:8080/` serves the old tracker website.
- [~] **Phase 1 — Hub shell.** *(Code done 2026-10-16: cookie sessions + CSRF guard, kiosk device tokens + pairing, SSE stream, Svelte app with tab rail, PWA manifest, Pi setup script. Remaining: build + verify on the Pi.)* Vite/Svelte app, tab bar, theme, cookie session (keeping Bearer for iOS), SSE `/api/stream`, device tokens, PWA manifest, Pi setup script. **Verify:** the Pi boots straight into the hub, survives a reboot, and is under budget with an empty Home.
- [~] **Phase 2 — Home dashboard.** *(Code done 2026-10-16: month calendar with month navigation, Google iCal sources (encrypted), reminders + pinned note, weather/moon from the tracker, alerts bar, sky card. Remaining: verify with real calendars.)* Clock, weather (from the tracker's cache), Google Calendar widget + `/api/calendar`, reminders and pinned-notes widgets, alerts ticker, and a compact flight card. **Verify:** a reminder added on the phone appears on the Pi within seconds, and a Google event appears within 5 minutes.
- [~] **Phase 3 — HD plane board.** *(Code done 2026-10-16: allow-listed tracker adapter (tested against a fake tracker), logo resizing from Jxck-S/airline-logos, Flights tab in LED + Clean, auto-focus on Home, Planespotters photos. Remaining: side-by-side check with the LED panel.)* Tracker adapter (allow-list, cache, SSE diffs), logo fetch + `sharp` resizing, Flights tab, auto-focus on Home, tracked-flight view, both themes. **Verify:** side by side with the LED matrix, the same flight, colours and progress, sharp on the monitor.
- [~] **Phase 4 — Radar.** *(Code done 2026-10-16: demand-driven adsb.lol/adsb.fi poller with trails, Leaflet + single canvas layer, highlight/follow, detail panel with adsbdb route + airframe. RainViewer overlay and desktop glide added 2026-10-17. Live mini map on Home and per-type aircraft silhouettes added 2026-10-18. Remaining: Pi performance check, including the Home mini map's 5 fps glide.)* ADS-B poller + trails, Leaflet canvas layer, overhead/tracked highlight, detail panel + photos, Pi vs. desktop modes, idle mini-radar on Home. **Verify:** a busy sky on the Pi stays within the CPU budget.
- [~] **Phase 5 — HomeBase modules on the web.** *(Code done 2026-10-16: Notes (checklists, pin, share read/write), Reminders (repeat rolls forward like iOS), Weight loss (weigh-ins, workouts, weekly plan, exercise library, goals), Nutrition (meal log, recipes, targets), Health charts; same sync protocol as the iPhones; `/legacy` retired. Verified browser ↔ iPhone API round trips (14/14). Remaining: check with the real iPhones.)* Notes (checklists, pin, share), Reminders, Calendar tab, then port Weight loss and Nutrition from `public/` (retire `/legacy` at parity), then read-only Health charts. **Verify:** edits round-trip phone ↔ browser.
- [~] **Phase 6 — MagicMirror tab (optional).** *(Code done 2026-10-17: `magicmirror` Compose service (MagicMirror 2.38.0, read-only, unprivileged), allow-listed authenticated proxy with websockets, `MMM-HomeBase` (agenda, reminders, pinned notes via a read-only screen token). Verified in the full Docker stack over HTTPS: page, data and `wss://` socket load with no CSP errors; `/cors`, `/reload`, traversal and cross-site upgrades blocked. Remaining: memory check on the Pi.)* Compose service, reverse proxy (+ws), config, `MMM-HomeBase`. **Verify:** the tab loads on demand and memory returns to baseline after leaving it.
- [~] **Phase 7 — Ops + HTTPS.** *(Code done 2026-10-17: Caddy with a local CA (8443 + 8080 redirect), `COOKIE_SECURE=auto`, `TRUST_PROXY` limited to Caddy, nightly backups + **Back up now**, Settings → Status, `deploy/update.sh`, CA install in `setup-pi.sh`, firewall/SSH checklist in deploy/README.md. Verified by building and running the Compose stack. 2026-10-17/18: every setting except `JWT_SECRET` moved into Settings → Hub (D20); terms check of every outside service (D21, D22); `deploy/stop.sh` / `start.sh` (D25). Remaining: deploy on the Linux PC.)* Nightly backup, a status panel in Settings (tracker reachable? ADS-B ok? calendar ok?), update script, **HTTPS via Caddy + local CA (required, §7.5)**, host firewall and SSH hardening checklist.
- [x] **Headless tracker on the Linux PC.** *(Done 2026-10-17: its-a-plane-python copied into `tracker/` and run by the `tracker` compose service; HomeBase screens for its stats, records, tracking and API log; LED board as a slave via Caddy :8081. See deploy/README.md §5.)* Run `its-a-plane-python` in a container with a stub for `rgbmatrix`, as the **master**, and make the LED Pi 3 A+ a **slave** of it. All API keys and lookups then live on the server, and the 512 MB Pi only drives the LEDs.

---

## 9. Answers so far (2026-10-16)

1. **Server:** a Linux PC, so Docker Compose (D11).
2. **Displays:** a Pi 3 B kiosk; the Pi 3 A+ stays the LED tracker. This drove D5, D13 and §6.7.
3. **Layout:** Home dashboard + tabs, with auto-focus to the plane board (D14, §6.1).
4. **Calendar:** Google, via secret iCal URL (D16).
5. **Wife's access to new sections:** not needed now; add later.
6. **Framework:** anything light, so Svelte (D4). Browser + PWA, not a desktop app (D15).

Still open (non-blocking):
- The monitor's resolution for the Pi (1080p or 720p).
- Whether you want the MagicMirror tab at all once Home exists (Phase 6 is optional).

---

## 10. Status log

| Date | Note |
|---|---|
| 2026-10-16 | Plan written. Reviewed `../HomeBase` (iOS app + Fastify server + tracker website), `c0wsaysmoo/plane-tracker-rgb-pi` (its-a-plane-python; Flask on :8080 already exposes JSON for slaves) and `MagicMirrorOrg/MagicMirror` v2.38 (supports `serveronly`, `basePath`, frameguard override). |
| 2026-10-16 | Revised after answers: Linux PC server, Pi 3 B kiosk (memory budget added, Leaflet instead of MapLibre, server-side image resizing), Home dashboard + tabs, Google iCal, MagicMirror moved to an optional on-demand tab, PWA instead of a desktop app, hub on ports 3000 + 8080. Nothing built yet. |
| 2026-10-16 | Mockups made (Home idle, Home with plane overhead, Flights board in LED and Clean themes, Radar, desktop Notes). Home changed to a full month calendar with month navigation at the user's request. |
| 2026-10-16 | Dark mode only (D17). Confirmed the iOS app needs no code change for the move: its server URL is user-entered in Settings. Phase 0 now says to copy the DB + `.env` so the phones keep their logins and sync cursors. |
| 2026-10-16 | Added §7 Engineering standards and security: latest pinned versions, supply-chain rules, audit gate, code standards, app/infra security. Existing server is behind on security fixes (`@fastify/static` 8.3.0, `fastify` 5.8.5); upgrades are part of Phase 0. HTTPS is now required (Phase 7). |
| 2026-10-16 | Implementation started. Phases 0–4 code written (server, web app, Docker, kiosk script) with tests. Tracker adapter, radar ingest, env/schema parsing (zod v4), SSRF helpers and secret box verified by running them; the full test suite, type-check and build still need `npm install`, which was blocked in the build environment (npm registry not reachable). |
| 2026-10-16 | npm access opened. Dependencies pinned (lockfiles committed), audit + OSV clean. Server: type-check clean, ESLint (strict + security plugin) clean with 0 warnings, **26/26 tests pass** on Node 26.12. Web: svelte-check 0 errors / 0 warnings, ESLint + CSP check clean, production build 36 KB JS + 5 KB CSS gzipped initial (radar lazy-loaded). End-to-end in headless Chromium at 1920×1080 against a fake tracker and recorded-format ADS-B data: login, Home (idle + plane overhead), Flights (LED), Calendar, Radar with selection, Settings and kiosk pairing all work, with no CSP violations; session cookies are httpOnly + SameSite=Strict and unreadable from page JS. Fixed during testing: aircraft-name race at startup, Home flight-card overflow, kiosk tab rail visible on load. |
| 2026-10-16 | Phase 5 done in code: Notes, Reminders, Weight loss, Nutrition and Health in the web app, on the same sync protocol as the iPhones; `/legacy` retired. Browser edits verified through the iPhone API (14/14 checks). |
| 2026-10-17 | Phases 6 and 7 done in code, plus the desktop Radar extras. **Mirror:** MagicMirror 2.38.0 behind an allow-listed, authenticated proxy (tests found and fixed: `config/` needed a trailing-slash rule; MagicMirror's own Origin check needed the hub to own that check; `MMM-HomeBase` must not overwrite MagicMirror's `this.data`; a read-only container needs `js/positions.js` pre-generated). **HTTPS:** Caddy with a local CA on 443, 8080 redirects, `COOKIE_SECURE=auto`, `TRUST_PROXY` limited to Caddy (found: Caddy's file capability can't exec under `cap_drop: ALL`, so the image strips it). **Ops:** nightly backups + Back up now, Settings → Status, `update.sh`, Pi CA install. **Radar:** RainViewer overlay and plane glide on desktop only. Checks: server 41/41 tests, type-check and lint clean; web svelte-check, lint, CSP check and build clean; `npm audit` 0 in server, web and MagicMirror; OSV.dev 0 for server + web (MagicMirror's lockfile has 2 advisories in dev-only packages, katex and source-map-js, confirmed absent from the image). Built all three images and ran the Compose stack: HTTPS login with `__Host-` Secure cookies, Mirror page + `wss://` socket + HomeBase data with no CSP errors, `/cors` blocked, read-only filesystems, backups written 600. |
| 2026-10-17 | HTTPS moved to port **8443** by default (443 is used by another application on the Linux PC); `HTTPS_PORT`/`HTTP_PORT` in `deploy/.env` still override. Added the `users` command (list, add, reset-password) since sign-up is off and there's no reset page. |
| 2026-10-17 | Accounts in the browser: sign-in screen has **Forgot password?** (one-time 30-minute reset link made on the PC with `users.js reset-link`) and **Create an account** (only with `ALLOW_REGISTRATION=true`); Settings → **People** (list, add a person) and **Change password** (ends other sessions). Resetting another person's password stays PC-only so one account can't take over another. Server 51/51 tests; browser test 16/16. |
| 2026-10-17 | First account can be created from the sign-in screen ("Set up HomeBase") when the hub has none; sign-up locks again afterwards unless `ALLOW_REGISTRATION=true`. Same rule for the iPhone app's sign-up; a race for the first account lets only one through. Server 54/54 tests; browser test 5/5. |
| 2026-10-17 | **Plane tracker settings in the browser** (Settings → Plane tracker, or the gear on Flights): every setting from the tracker's own `/config` page (location & zone, display & night dimming, flights, stats logging, master/slave, API sources with priority order and keys), its system status & API usage cards, Wi-Fi scan/connect, and Restart, saved on the LED Pi through the hub. Server 60/60 tests (6 new, against a stand-in that behaves like the tracker's Flask app); browser test 22/22. |
| 2026-10-17 | **The plane tracker runs on the server.** its-a-plane-python (commit c64ca80) copied into `tracker/app` and run headless by a new `tracker` compose service (Python 3.14, hash-pinned dependencies, OSV clean), starting fresh with email alerts off. The LED board becomes a slave of it through Caddy `:8081`. New HomeBase screens rebuild the tracker's own pages: **Stats** (per day, per hour, each day's flights, API usage), **Closest & farthest** with maps, **Track a flight** (callsign lookup or route search, pick the leg, live progress) and the **API call log**. Settings → Plane tracker hides the LED-only sections for the bundled tracker and, with `LED_BOARD_URL`, switches to the board (with **Follow this server**). Server 71/71 tests; browser test 21/21 against the real tracker code. |
| 2026-10-17 | Security review of everything from outside (tracker copy byte-for-byte upstream apart from 3 patches; 0 known vulnerabilities in 354 npm, 213 MagicMirror and 18 Python packages; no secrets in git history). Airline logos pinned to a commit and read as plain PNG files only; tracker logs hide API keys. |
| 2026-10-17 | *(The tile relay described here was removed on 2026-10-18 for CARTO's terms; see below and D21.)* **Map tiles need a key now:** CARTO stamps "API KEY REQUIRED" on keyless tiles (since late Aug 2026). Tiles go through the hub (`/api/tiles`, disk cache) with `CARTO_API_KEY` from hub.env, so the key never reaches a browser. The radar takes home from the plane tracker's settings when `HOME_LAT`/`HOME_LON` aren't set, and Settings → Status says why it's off. Server 79/79 tests. |
| 2026-10-17 | **Settings in the browser, not in files.** Everything the hub reads except `JWT_SECRET` (and the optional `SECRETS_KEY`) moved from `hub.env` to **Settings → Hub**, stored in the database and applied without a restart: sign-up, session lengths, radar on/off and range, ADS-B contact, the CARTO key (encrypted, write-only), the LED board address (home-network addresses only), backups, log detail. Home location and units come from **Plane tracker → Location** (one place). MagicMirror needs no `mirror.env`: it gets a read-only token, home and units from the hub (answered only to its container address) and restarts itself when they change. First start copies the old `hub.env` values in once and lists the lines to delete. Server tests all pass. |
| 2026-10-17 | *(Superseded on 2026-10-18: no hub tile relay or cache any more.)* Map key fix: tiles come from CARTO's documented keyed address (`basemaps.cartocdn.com/rastertiles/dark_all/…?key=`, old per-subdomain address as fallback). CARTO's "API KEY REQUIRED" tile is recognised (ETag `wm-…`) and never cached; tile URLs carry a fingerprint of the key so browsers drop old tiles at once; the old hub tile cache is cleared. Settings → Status shows CARTO's last answer (working / still watermarked / refused / unreachable). Server 87/87 tests. |
| 2026-10-18 | **Terms check of every outside service** (table in deploy/README.md). CARTO's basemap terms forbid relaying or caching tiles on a server, so the hub's tile relay is gone: maps load tiles straight from CARTO with the saved key, and the stored tiles are deleted. Readable OpenStreetMap/CARTO credit on every map; adsb.lol/adsb.fi credited (with links, as adsb.fi asks); Open-Meteo credited on MagicMirror. Tracker: no Tomorrow.io calls without a key, no Nominatim lookups on the server, OpenSky backs off after HTTP 429. |
| 2026-10-18 | **Live radar on Home and plane shapes by type.** The Home radar is now a small live map (same CARTO tiles and plane layer as the Radar tab): planes glide between updates (5 frames a second on the Pi kiosk, 20 on a computer); tap it to open the Radar tab. Every map now draws an original top-down outline per aircraft type, chosen from the ICAO type code and, when that's unknown, the ADS-B category: light single (C172), turboprop (DH8D, ATR), business jet, regional jet (CRJ, E-jets), twin-engine narrowbody (737/A320), twin-engine widebody (787/777/A350), four-engine (747, A380, A340), helicopter, glider, military jet, balloon and ground vehicle; bigger aircraft draw bigger. Checked in headless Chromium against 13 fake planes. Server 86/86 tests; web check, lint, CSP check and build clean. |
| 2026-10-18 | **Stop and start scripts.** `deploy/stop.sh` backs up the database and stops the hub, Caddy, the tracker and MagicMirror (nothing deleted; stays off across reboots); `deploy/start.sh` brings them back. MagicMirror now exits at once on a stop request instead of waiting out Docker's 10-second timeout. deploy/README §9 covers stopping from Portainer (the stack shows there as `deploy`, created outside Portainer: stop/start its containers, don't remove or redeploy it). Scripts checked with shellcheck and a stand-in `docker`. |
| 2026-10-18 | **Docs brought up to date with the code** so a fresh reader (or another AI model) sees the system as it is. README: §3 architecture redrawn (bundled tracker as master, LED board as slave on :8081, Caddy HTTPS :8443, settings in the database, what browsers load directly); §4 decisions D18–D25 added (bundled tracker, HTTPS/ports, settings in the DB, CARTO tiles straight from CARTO, outside services' terms, original aircraft icons, local-only git, stopping), D5/D11/D12 marked as replaced; §5 layout matches the files; §6.3 radar, §6.8 and §7.5 security, §7.4 CSP and §8 phases updated; the two tile-relay log rows marked superseded. `server/README.md` lists every route and who may call it. `CLAUDE.md` now has a start-here guide, the rules that are easy to break, and the checks to run; `AGENTS.md` points other assistants to it. |
| 2026-10-18 | **Fix: planes in the box not showing.** Two causes found. (1) Saving Settings → Plane tracker said "applied", but the tracker only reads its box corners, API keys, sources and altitude filter when it starts (its web app is a separate process), so new corners or a new FR24 key weren't used until a restart. The hub now restarts the tracker (or the LED board) after a save that changed something, and says so. (2) Upstream bug: when a route lookup failed, the tracker cached the miss and then dropped that plane from the in-box list for an hour, so it never reached the board, Home or the LED display. Patched to keep the plane with "route unknown"; FR24 failures now log their HTTP status. Screens show an unknown route as "Route not found" instead of "Private ? → ?". Server 87/87 tests. |
| 2026-10-19 | **Fix: a plane in the box showed no from/to, "0 mi" and no speed.** The tracker looked each plane up once: a plane caught just after takeoff (before FR24 lists it) kept "no route" for an hour. Patched to retry a missing route every 2 minutes while the plane is in the box, and to send ground speed. The hub shows unknown airport distances as blank, not 0 mi. Open screens now reload themselves when the hub serves a new build (the live stream's hello carries it), so the kiosk picks up updates without a manual refresh. Checked in headless Chromium (reload after a hub update; the card for a plane with no route). Server 87/87 tests. |
| 2026-10-19 | **Routes for planes in the box when the tracker's lookup has none.** The hub fills the usual route (airports, distances, progress, airline, flight number) from adsbdb's free schedule data by callsign, only when the plane is plausibly between the two airports, and the aircraft type by hex; the card says "Usual route for this flight (adsbdb schedule data)". adsbdb lookups are cached 6 h and pause a minute after an error. Server 88/88 tests. |
| 2026-10-19 | **adsb.lol answering HTTP 429 (too many requests).** The tracker log showed every zone fetch refused, so the tracker fell back to OpenSky's small anonymous allowance. The hub's radar polls adsb.lol every 5 s from the same home address; it now leaves a provider that answers 429 alone for 10 minutes and uses adsb.fi meanwhile, so the tracker's own adsb.lol requests get through. Tracker patch: FR24 also logs "found no flight with this callsign" and a missing key, so every lookup outcome is visible. Server 89/89 tests. |
| 2026-10-19 | **Radar back to showing every plane in range; slower polling kept.** At the owner's request, undid the two changes from earlier today that limited the radar: the Home radar's 10-mile range (and its setting) and the "tracker's box only" radar area. Home is back to 25 miles and the Radar tab to its full range (Radar range in Settings → Hub). Kept: the hub asks for planes every 15 s instead of 5 (Settings → Hub → Ask for planes every: 10/15/30/60 s, one request at a time), and the 10-minute backoff from a feed that answers 429. Server 90/90 tests. |
| 2026-10-20 | **Fix: a plane inside the box didn't bring up the Plane overhead screen.** The overhead screen comes from the tracker, whose only backup when adsb.lol refuses (HTTP 429, as the log showed) was OpenSky's ~400 free requests a day; once those ran out it saw no planes at all, while the hub's radar (on adsb.fi) still showed them. Tracker patch: it now asks adsb.fi when adsb.lol fails, before OpenSky, and leaves adsb.lol alone for 10 minutes after a 429. Checked against the tracker's own code with a faked network. |
| 2026-10-20 | **Tracing the missing FR24 routes.** The tracker log showed no FR24 lines at all while planes were in the box; run against a faked FR24 answer, the tracker's code finds the route (EWR → ORD for UAL1738), and adsbdb's schedule for that flight (MCO → EWR) was correctly rejected as not fitting the plane's position. Tracker patch: the remaining silent cases (FR24 client didn't load, source not available, answer without an origin airport, route that doesn't fit) now log. New `tracker/headless/fr24_check.py` asks FR24 about one callsign exactly as the tracker does and prints the raw answer. |
