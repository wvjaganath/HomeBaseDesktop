# Deploying HomeBase Desktop

Runbook for the Linux PC (hub) and the Raspberry Pi 3 B (screen). Every step
follows README §7 (security standards).

What runs on the PC (`docker compose`):

| Service | Does | Reachable at |
|---|---|---|
| `caddy` | HTTPS for every browser, using its own local certificate authority | `https://<pc>` (443), `http://<pc>:8080` → redirects to https |
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
for p in 22 443 8080 3000; do sudo ufw allow from 192.168.1.0/24 to any port $p proto tcp; done
sudo ufw enable
```

SSH: put your public key in `~/.ssh/authorized_keys`, then set
`PasswordAuthentication no` and `PermitRootLogin no` in
`/etc/ssh/sshd_config.d/10-hardening.conf` and `sudo systemctl reload ssh`.

Docker publishes ports through its own iptables rules, which bypass ufw. Keep the
PC on your LAN only (no port forwarding on the router), or bind the published
ports to the LAN address in `docker-compose.yml` (for example `"192.168.1.20:443:8443"`).

## 2. Linux PC: run it

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

Then open `https://<pc-ip>` (or the name you put in `HUB_HOSTS`). Signing in
over HTTPS gives the browser Secure, `__Host-` cookies. The hub only trusts
`X-Forwarded-*` headers from Caddy's fixed address, so nobody on the LAN can
fake being on HTTPS. The iPhone app keeps using `http://<pc-ip>:3000`.

Changing `HUB_HOSTS` later: edit `deploy/.env`, then `docker compose up -d caddy`.

## 4. Raspberry Pi 3 B screen

1. Flash Raspberry Pi OS (Bookworm, with desktop) and boot it on your network.
2. On a computer, open the hub at `https://<pc-ip>` → **Settings → Screens →
   Create link**, and copy the command it shows.
3. On the Pi:
   ```bash
   # from the Linux PC:
   scp deploy/kiosk/setup-pi.sh deploy/homebase-ca.crt pi@<pi-ip>:
   # then on the Pi:
   sudo bash setup-pi.sh --ca homebase-ca.crt "https://<pc-ip>/kiosk/pair?t=hbd_…"
   sudo reboot
   ```
   The script prints the certificate fingerprint; check it matches step 3.
The Pi boots straight into the hub full-screen. Change what it shows (start tab,
LED or Clean board, night mode, rotation) from **Settings → Screens** on any
computer; it updates within seconds.

## 5. MagicMirror (Mirror tab)

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

## 6. Backups

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

## 7. Updating

```bash
./deploy/update.sh
```

It backs up the database, pulls the code, re-pins the base images to their
newest patched digests, rebuilds (failing on known vulnerabilities), restarts
and shows the status. Run it monthly, or whenever `update-deps.sh` brought in a
security fix.
