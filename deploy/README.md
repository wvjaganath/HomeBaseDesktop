# Deploying HomeBase Desktop

Runbook for the Linux PC (hub) and the Raspberry Pi 3 B (screen). Every step
follows README §7 (security standards).

What runs on the PC (`docker compose`):

| Service | Does | Reachable at |
|---|---|---|
| `caddy` | HTTPS for every browser, using its own local certificate authority | `https://<pc>:8443`, `http://<pc>:8080` → redirects to https |
| `hub` | API, web app, sync for the iPhones, plane tracker + radar + calendar | `http://<pc>:3000` (the iPhone app's saved address) |
| `magicmirror` | MagicMirror² for the Mirror tab | nowhere directly: only through the hub at `/mirror/` |
| `tracker` | The plane tracker (its-a-plane-python, bundled in `tracker/`), headless: finds the flights, looks up routes, weather, alerts, ISS | nowhere directly: the hub reads it, and the LED board reads its feed on `http://<pc>:8081` |

## 0. Dependencies (already pinned)

Lockfiles are committed, so builds use `npm ci` with exact versions, and the
image builds stop on any known high/critical vulnerability (`npm audit`). To
update (weekly, or immediately for a security fix), on a machine with Node 24.11+:

```bash
./scripts/update-deps.sh      # latest versions ≥7 days old, exact pins, audit gate
cd server && npm run typecheck && npm run lint && npm test && cd ..
cd web && npm run check && npm run lint && npm run build && cd ..
git add server/package*.json web/package*.json && git commit -m "Update dependencies"
```

Also run `osv-scanner --lockfile server/package-lock.json --lockfile web/package-lock.json`
if you have it installed.

## 1. Linux PC: host hardening

```bash
sudo apt update && sudo apt install -y unattended-upgrades ufw
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
# Firewall: SSH + HomeBase from the home LAN only (adjust the subnet).
sudo ufw default deny incoming
for p in 22 8443 8080 3000 8081; do sudo ufw allow from 192.168.1.0/24 to any port $p proto tcp; done
sudo ufw enable
```

SSH: put your public key in `~/.ssh/authorized_keys`, then set
`PasswordAuthentication no` and `PermitRootLogin no` in
`/etc/ssh/sshd_config.d/10-hardening.conf` and `sudo systemctl reload ssh`.

Docker publishes ports through its own iptables rules, which bypass ufw. Keep the
PC on your LAN only (no port forwarding on the router), or bind the published
ports to the LAN address in `docker-compose.yml` (for example `"192.168.1.20:8443:8443"`).

## 2. Linux PC: run it

Needs Docker with **Compose v2 and buildx** (BuildKit). On Ubuntu/Debian with the
distribution's Docker: `sudo apt install docker.io docker-buildx docker-compose-v2`
(with Docker's own apt repo: `docker-ce docker-buildx-plugin docker-compose-plugin`).
Check: `docker compose version && docker buildx version`.

```bash
git clone <this repo> homebase-desktop && cd homebase-desktop/deploy
./pin-images.sh                     # base images pinned by digest → deploy/.env
$EDITOR .env                        # set HUB_HOSTS=192.168.1.20  (the PC's LAN IP, plus a name if you have one)
cp hub.env.example hub.env && chmod 600 hub.env
$EDITOR hub.env                     # JWT_SECRET (openssl rand -hex 32). That's all; the rest is in the browser.
mkdir -p data backups caddy-data tracker-data
sudo chown -R 10001:10001 data backups caddy-data tracker-data && sudo chmod 700 data backups caddy-data tracker-data
docker compose build
docker compose up -d tracker hub caddy
docker compose run --rm logos       # download the airline logo set (a fixed commit: LOGOS_COMMIT)
docker compose logs -f hub
```

Check: `curl http://<pc-ip>:3000/health` → `{"ok":true}`.

### Where each setting lives

| Where | What |
|---|---|
| **Settings → Hub** (browser) | Sign-up on/off, how long sign-ins last, radar on/off, area (the tracker's box or a circle), range and how often it asks for planes, the Home radar's range, ADS-B contact, the CARTO map key, the LED board's address, backups, log detail. Saved on the hub, applied straight away. |
| **Settings → Plane tracker** (browser) | Home location, units, zone, flights, API keys… The radar, maps and MagicMirror use this home location and units too, so they're set once. |
| `deploy/hub.env` | `JWT_SECRET` only (plus the optional `SECRETS_KEY`). They sign sign-ins and encrypt saved secrets, so they can't be stored in the database they protect. |
| `deploy/.env` | Docker-level: ports (`HTTPS_PORT`, `HTTP_PORT`, `TRACKER_FEED_PORT`), `HUB_HOSTS`, the time zone `TZ` (every container), image versions, `LOGOS_COMMIT`. A running app can't change these. |

Upgrading from a version with more lines in `hub.env`: on its first start the
hub copies those values into Settings once, and **Settings → Hub** lists the
lines you can then delete. `mirror.env` isn't used any more.

**After the first start**, in the browser:

1. **Settings → Plane tracker → Location:** home lat, lon and units (and the
   rest of the tracker's settings, §5).
2. **Settings → Hub → Radar & maps:** paste a free CARTO key from
   <https://carto.com/basemaps/apikey/> (no account; non-commercial use is free
   up to 5 million tiles a month). Without it the map background says
   "API KEY REQUIRED". It's stored encrypted on the hub. CARTO's terms require
   tiles to load straight from CARTO (no relaying or caching on a server), so
   each screen uses the key in its tile requests. If you limit the key to
   certain websites in CARTO's dashboard, add the address you open HomeBase on.

### Outside services and their terms

Checked 2026-10-18 against each service's published terms. All of this is
personal, non-commercial use on a home network.

| Service | Used by | Terms that apply | How HomeBase keeps to them |
|---|---|---|---|
| **Flightradar24 API** (your key) | tracker: route lookups, Track a flight, route search | Paid plan; personal or commercial use allowed; no reselling or redistributing raw data; data may be cached only "for a limited time as documented per endpoint" and no "persistent local copies" (T&C 2.4, 6.3.1) | Official API with your key, ~1 call per new flight (routes are remembered 1 hour, in memory). The tracker's own logs (flight counts, closest/farthest records, API log) keep route codes on disk: set **Flight log retention** in Plane tracker → Stats logging if you want them limited. |
| **adsb.lol** | tracker every 30 s; the hub's radar every 15 s (Settings → Hub) while a screen shows it, only the area around the tracker's box | Free, no key yet; data under ODbL (credit it); dynamic rate limits | Credited on every map/list that shows its data. |
| **adsb.fi** | Radar backup only | Personal, non-commercial only; max 1 request/second; cite adsb.fi with a link | Only when adsb.lol fails or has asked the hub to slow down (then for 10 minutes), ≤ 1 per 5 s; linked credit on the Radar map. |
| **OpenSky** (anonymous) | tracker backup only, when adsb.lol fails | 400 credits/day without an account; non-commercial | Pauses for as long as OpenSky asks once the allowance is used (patch). |
| **CARTO** basemaps (your key) | maps in the browser | Free non-commercial ≤ 5M tiles/month; **no server-side proxying or caching**; browser cache ≤ 30 days; prominent OpenStreetMap + CARTO credit | Tiles load straight from CARTO in the browser; readable credit on every map. |
| **Planespotters.net** | aircraft photos in the browser | Photographer credit next to the photo, link to the photo page, images loaded from their URLs (never stored or proxied), browser sends Origin/Referer | All of these; only the JSON answer is kept in the page's memory. |
| **adsbdb.com** | Radar plane details; the usual route and aircraft type of a plane in your box when the tracker's lookup has none | Free public API (no published limits) | One lookup per plane, cached 6 hours by the hub; after an error it waits a minute before asking again. |
| **weather.gov** | tracker weather alerts | Open data, any use; User-Agent required | Sends one; every 10 min. Turn off in Plane tracker → Flights. |
| **CelesTrak** | tracker ISS passes | Download each data set at most once per update (GP: every 2 h); stop on errors | Once every 12 h; backs off on errors. Turn off in Plane tracker → Flights. |
| **FAA NAS status** | tracker airport delays | US government public data | Every 5 min, only with an airport watch list. |
| **Tomorrow.io** (needs a key) | tracker temperature/forecast | Free plan 25 calls/hour, 500/day | ~7/hour when a key is set; **no calls without a key** (patch). |
| **OpenStreetMap Nominatim** | tracker place names for the LED panel | ≤ 1 request/s, identify the app, cache, credit OSM | Not used on the server (nothing displays it) (patch). |
| **Open-Meteo** | MagicMirror weather | Free non-commercial < 10,000 calls/day; CC BY 4.0 credit | ~150 calls/day; "Weather data by Open-Meteo.com" shown under the forecast. |
| **RainViewer** | optional rain layer (desktop Radar) | Free for personal use; max zoom 7; 100 requests/min per IP | Zoom capped at 7; credited on the map; off unless you turn it on. |
| **GitHub** | airline logos (pinned commit), tracker airport/airline lists | Public repositories | Downloaded when needed only. |


HomeBase uses port **8443** for HTTPS (not 443, so it never clashes with another
web server on the PC). If Caddy fails with `address already in use`, something
else has 8443 or 8080: `sudo ss -ltnp 'sport = :8443'` shows what. Pick free
ports with `HTTPS_PORT=…` / `HTTP_PORT=…` in `deploy/.env`, then
`docker compose up -d caddy`.

### Moving the existing HomeBase server

Copy the **existing database and secret** so the iPhones stay logged in and keep
their sync position (a fresh DB would make them miss data):

```bash
# on the old machine, with the old server stopped:
sqlite3 HomeBase/server/homebase.db ".backup homebase.db"   # consistent copy
scp homebase.db <pc>:homebase-desktop/deploy/data/homebase.db
# copy JWT_SECRET from the old server/.env into deploy/hub.env
sudo chown 10001:10001 deploy/data/homebase.db && sudo chmod 600 deploy/data/homebase.db
```

Then on each iPhone: HomeBase → Settings → Server → `http://<pc-ip>:3000` →
Test connection. No app update is needed.

### Accounts (add one, reset a password)

In the browser (no PC needed):

- **Add a person:** Settings → People → Add a person (name, email, a starting
  password they then change).
- **Change your password:** Settings → Account → Change password. Your phones
  and other browsers are signed out and ask for the new one.
- **First account:** on a hub with no accounts, the sign-in screen opens on
  *Set up HomeBase*, so you can create yours in the browser. After that,
  sign-up locks again (unless you turn it on in **Settings → Hub → Sign-in**).
  The iPhone app's sign-up follows the same rule.

  If you're moving the old HomeBase server, copy its database first (§2,
  *Moving the existing HomeBase server*) instead of creating new accounts:
  new accounts start empty and the iPhones' existing data stays in the old file.

**Forgot password** (the sign-in screen shows these steps too): HomeBase sends no
email, so whoever runs the hub makes a one-time link on the PC:

```bash
docker compose exec hub node dist/scripts/users.js reset-link wife@example.com
```

Open the printed link (put your hub's address in place of `<your hub address>`,
e.g. `192.168.1.20:8443`) and choose a new password. It works once, for 30
minutes, and signs that account out everywhere. Nobody can reset *someone
else's* password from the browser, so one account can't take over another.

Other commands (`list`, `add`, and `reset-password`, which sets a password right
there without a link):

```bash
docker compose exec hub node dist/scripts/users.js list
docker compose exec hub node dist/scripts/users.js add wife@example.com "Wife"
docker compose exec hub node dist/scripts/users.js reset-password you@example.com
```

## 3. HTTPS: trust the hub once per computer

Caddy made a private certificate authority for your house the first time it
started. Its private key never leaves `deploy/caddy-data` (owner-only; never
share or commit it). Export the public certificate and note its fingerprint:

```bash
cd deploy
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./homebase-ca.crt
openssl x509 -in homebase-ca.crt -noout -fingerprint -sha256
```

Install `homebase-ca.crt` on each computer that opens the hub in a browser,
checking the fingerprint matches:

- **Mac:** double-click it → Keychain Access → System → open "HomeBase Local CA"
  → Trust → *Always Trust*.
- **Windows:** double-click → Install Certificate → Local Machine → *Trusted Root
  Certification Authorities*.
- **Linux desktop (Chrome/Chromium):** `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "HomeBase Local CA" -i homebase-ca.crt`
  (Firefox: Settings → Certificates → Import).
- **Raspberry Pi screen:** handled by `setup-pi.sh --ca` (step 4).

Then open `https://<pc-ip>:8443` (or the name you put in `HUB_HOSTS`). Signing in
over HTTPS gives the browser Secure, `__Host-` cookies. The hub only trusts
`X-Forwarded-*` headers from Caddy's fixed address, so nobody on the LAN can
fake being on HTTPS. The iPhone app keeps using `http://<pc-ip>:3000`.

Changing `HUB_HOSTS` later: edit `deploy/.env`, then `docker compose up -d caddy`.

## 4. Raspberry Pi 3 B screen

1. Flash Raspberry Pi OS (Bookworm, with desktop) and boot it on your network.
2. On a computer, open the hub at `https://<pc-ip>:8443` → **Settings → Screens →
   Create link**, and copy the command it shows.
3. On the Pi:
   ```bash
   # from the Linux PC:
   scp deploy/kiosk/setup-pi.sh deploy/homebase-ca.crt pi@<pi-ip>:
   # then on the Pi:
   sudo bash setup-pi.sh --ca homebase-ca.crt "https://<pc-ip>:8443/kiosk/pair?t=hbd_…"
   sudo reboot
   ```
   The script prints the certificate fingerprint; check it matches step 3.
The Pi boots straight into the hub full-screen. Change what it shows (start tab,
LED or Clean board, night mode, rotation) from **Settings → Screens** on any
computer; it updates within seconds.

## 5. Plane tracker

The tracker runs on this PC as the `tracker` service: the original
its-a-plane-python code, copied into `tracker/app` (see `tracker/UPSTREAM.md`),
with no LED panel attached. It keeps its state (settings, API keys, caches,
flight counts, records, logs) in `deploy/tracker-data`, starts empty, and has
email alerts turned off. Its own web page isn't published; HomeBase is the UI.

**First setup:** open **Settings → Plane tracker** (or the gear on the Flights
tab) and fill in home location and zone, the API keys (AirLabs / FlightAware /
FR24, OpenSky, Tomorrow.io) and the source order, then **Save & apply**.
The tracker reads these only when it starts, so the hub restarts it after a
save that changed something (flights pause for about 20 seconds). Within a
minute or two, flights show on Home and Flights.

**The zone (box) is the server's.** The LED board shows the planes in the
*server* tracker's box: a box saved on the board itself isn't used while it
follows the server. A plane in the box whose route the lookup can't find
still shows. The hub then fills in the flight's usual route from adsbdb's
schedule data (marked "Usual route" on the card, since a flight can fly a
different leg that day); "Route not found" means neither knew it. If the
tracker's own lookup never finds routes, check the
FR24 key and credits (`docker compose logs tracker | grep FR24` shows the
HTTP status) and the API call log on the tracker's stats page.

**Stats & records** (the chart button on Flights, or `#/tracker`): flights per
day and per hour with each day's list, API usage, the closest and farthest
flights on maps, **Track a flight** (look up a callsign or search a route, pick
the leg; it costs API credits, so it's for signed-in people only), and the API
call log.

### The LED board follows the server

The LED Pi keeps running the original tracker, as a **slave** of this one: it
only draws, spends no API credits and needs no keys.

1. Open the board's own page (`http://<board-pi>:8080/config`), set **Master
   tracker hostname** to `http://<pc-ip>:8081` (the PC's LAN address; the
   `8081` is `TRACKER_FEED_PORT` in `deploy/.env`), save, and restart it.
   You can remove its API keys now.
2. Optional, to manage the board from HomeBase too: put its address
   (`http://<board-pi-ip>:8080`) in **Settings → Hub → LED board**.
   **Settings → Plane tracker** then has a
   **This server / LED board** switch; the board side has the display, panel
   and Wi-Fi settings, and a **Follow this server** button that fills in step 1.

`:8081` is Caddy answering only the six read-only feed paths a slave needs
(`/overhead/json`, `/tracked/json/live`, `/weather/json`, `/clock/json`,
`/iss/json`, `/airport-status/json`), only to private-network addresses; every
other path is a 404. Check from the board: `curl http://<pc-ip>:8081/clock/json`.

Logs: `docker compose logs -f tracker` (API keys are replaced by `[hidden]`; still, don't post these logs publicly). Restart: **Restart tracker** in Settings,
or `docker compose restart tracker`. Start over: `docker compose stop tracker`,
empty `deploy/tracker-data`, `docker compose up -d tracker`.

## 6. MagicMirror (Mirror tab)

MagicMirror² 2.38.0 runs in its own container with no published port. The hub
forwards only what the page needs, to signed-in people and paired screens, and
blocks MagicMirror's `/cors` fetch-anything proxy. Its HomeBase panel (agenda,
reminders, pinned notes) reads the hub with a **read-only screen token**:

`docker compose build magicmirror && docker compose up -d magicmirror`. That's
all: at start it asks the hub for its screen token (read-only, belonging to the
hub's first account, listed under **Settings → Screens** as
"MagicMirror (built in)"), home location and units. The hub answers only the
MagicMirror container's fixed address. When the home location or units change
in Settings, MagicMirror restarts itself within a minute to use them.

Weather comes from Open-Meteo (no key). To change modules, edit
`mirror/config/config.js` and `docker compose restart magicmirror`. The log lines
"Could not write config/basepath.js" and "unable to write js/positions.js" are
expected: the container is read-only and both files are prepared at build time.

## 7. Backups

The hub backs up its database every night (03:07 by default) into
`deploy/backups`, keeps the newest 14 (both in **Settings → Hub → Backups**), and shows
the last one in **Settings → Status**, which also has **Back up now**. Files are
owner-only SQLite copies made with SQLite's online backup API, so the hub keeps
running. From the shell:

```bash
docker compose exec hub node dist/scripts/backup.js
```

Keep a copy **off the PC** too (a backup on the same disk doesn't survive the
disk). For example, a nightly cron entry on the PC (`crontab -e`):

```cron
30 3 * * * rsync -a --chmod=F600 ~/homebase-desktop/deploy/backups/ /mnt/nas/homebase/
```

To restore: `docker compose stop hub`, copy a backup over `deploy/data/homebase.db`
(owner 10001, mode 600), delete `homebase.db-wal`/`-shm` if present, `docker compose start hub`.

Also keep `deploy/hub.env` somewhere safe (a password manager): without
`JWT_SECRET`/`SECRETS_KEY` the saved calendar addresses and map key can't be
decrypted (everything else is in the database backups).

## 8. Updating

```bash
./deploy/update.sh
```

It backs up the database, pulls the code, re-pins the base images to their
newest patched digests, rebuilds (failing on known vulnerabilities), restarts
and shows the status. Run it monthly, or whenever `update-deps.sh` brought in a
security fix.

## 9. Stopping and starting

```bash
./deploy/stop.sh      # backup, then stop the hub, Caddy, the tracker and MagicMirror
./deploy/start.sh     # start them again and wait for the hub
```

`stop.sh` takes a database backup first (`--no-backup` skips it), stops the
front door (Caddy) before the rest, and takes a few seconds. Nothing is
deleted: data, backups, settings and the built containers stay, so `start.sh`
brings everything back as it was. Once stopped, HomeBase **stays off after a
reboot** until you run `start.sh`. If you just turn the PC off without
stopping HomeBase, it comes back by itself when the PC starts.

While it's off, an open screen (the Pi included) keeps showing the last data
with the **Live** dot grey, and a freshly opened one says "Can't reach the hub,
retrying every 10 seconds"; both pick up again by themselves once it's back.
The iPhone app can't sync and the LED board has no feed until then.

**From Portainer.** HomeBase was started with `docker compose`, so Portainer
lists it under **Stacks** as `deploy` (named after the folder) with "This stack
was created outside of Portainer. Control over this stack is limited." You can
still stop it there: open the stack (or **Containers**, filtered by stack
`deploy`), tick `deploy-hub-1`, `deploy-caddy-1`, `deploy-tracker-1` and
`deploy-magicmirror-1`, and press **Stop**; tick them again and press **Start**
to bring them back. That's the same as `stop.sh` without the backup (the
nightly backups still run). Don't use **Remove**, and don't have Portainer
redeploy the stack from its editor or from Git: the stack builds its images
from this folder and uses files beside it (`hub.env`, `.env`, `data/`,
`caddy/`, `../mirror/config`), which a Portainer-deployed copy wouldn't have.
Keep `update.sh`, `stop.sh` and `start.sh` as the way to change it, and
Portainer for watching it, logs, and stop/start.
