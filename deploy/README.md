# Deploying HomeBase Desktop

Runbook for the Linux PC (hub) and the Raspberry Pi 3 B (screen). Every step
follows README §7 (security standards).

What runs on the PC (`docker compose`):

| Service | Does | Reachable at |
|---|---|---|
| `caddy` | HTTPS for every browser, using its own local certificate authority | `https://<pc>:8443`, `http://<pc>:8080` → redirects to https |
| `hub` | API, web app, sync for the iPhones, plane tracker + radar + calendar | `http://<pc>:3000` (the iPhone app's saved address) |
| `magicmirror` | MagicMirror² for the Mirror tab | nowhere directly: only through the hub at `/mirror/` |

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
for p in 22 8443 8080 3000; do sudo ufw allow from 192.168.1.0/24 to any port $p proto tcp; done
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
$EDITOR hub.env                     # JWT_SECRET, HOME_LAT/LON, TRACKER_URL, ADSB_CONTACT …
cp mirror.env.example mirror.env && chmod 600 mirror.env   # filled in at step 5
mkdir -p data backups caddy-data
sudo chown -R 10001:10001 data backups caddy-data && sudo chmod 700 data backups caddy-data
docker compose build
docker compose up -d hub caddy
docker compose run --rm logos       # fetch the airline logo set (re-run monthly)
docker compose logs -f hub
```

Check: `curl http://<pc-ip>:3000/health` → `{"ok":true}`.

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
  sign-up locks again (unless you set `ALLOW_REGISTRATION=true` in `hub.env`).
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

## 5. Plane tracker settings

**Settings → Plane tracker** (or the gear button on the Flights tab) edits the LED
tracker Pi's own settings: the same fields as its `http://<tracker>:8080/config`
page, saved on the tracker. It needs `TRACKER_URL` in `hub.env`. Most changes
apply straight away; LED RGB order and GPIO slowdown need **Restart tracker**.
That button only works if you did step 15 of the tracker's README ("Enable the
web UI restart button"); otherwise restart the tracker Pi.

## 6. MagicMirror (Mirror tab)

MagicMirror² 2.38.0 runs in its own container with no published port. The hub
forwards only what the page needs, to signed-in people and paired screens, and
blocks MagicMirror's `/cors` fetch-anything proxy. Its HomeBase panel (agenda,
reminders, pinned notes) reads the hub with a **read-only screen token**:

1. In the hub: **Settings → Screens** → name it `MagicMirror` → **Create link**.
2. Copy the part of the link after `t=` (it starts with `hbd_`) into
   `deploy/mirror.env` as `HOMEBASE_DEVICE_TOKEN=`, and fill in `HOME_LAT`/`HOME_LON`.
3. `docker compose build magicmirror && docker compose up -d magicmirror`

Weather comes from Open-Meteo (no key). To change modules, edit
`mirror/config/config.js` and `docker compose restart magicmirror`. The log lines
"Could not write config/basepath.js" and "unable to write js/positions.js" are
expected: the container is read-only and both files are prepared at build time.

## 7. Backups

The hub backs up its database every night (03:07 by default, `BACKUP_HOUR` in
`hub.env`) into `deploy/backups`, keeps the newest `BACKUP_KEEP` (14), and shows
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

Also keep `deploy/hub.env` and `deploy/mirror.env` somewhere safe (a password
manager): without `JWT_SECRET`/`SECRETS_KEY` the stored calendar addresses can't
be decrypted.

## 8. Updating

```bash
./deploy/update.sh
```

It backs up the database, pulls the code, re-pins the base images to their
newest patched digests, rebuilds (failing on known vulnerabilities), restarts
and shows the status. Run it monthly, or whenever `update-deps.sh` brought in a
security fix.
