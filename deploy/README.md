# Deploying HomeBase Desktop

Runbook for the Linux PC (hub) and the Raspberry Pi 3 B (screen). Every step is
written to follow README §7 (security standards).

## 0. Dependencies (already pinned)

Lockfiles are committed, so builds use `npm ci` with exact versions. To update
(weekly, or immediately for a security fix), on a machine with Node 24.11+:

```bash
./scripts/update-deps.sh      # latest versions ≥7 days old, exact pins, audit gate
cd server && npm run typecheck && npm run lint && npm test && cd ..
cd web && npm run check && npm run lint && npm run build && cd ..
git add server/package*.json web/package*.json && git commit -m "Update dependencies"
```

`npm audit --omit=dev --audit-level=high` must report **0 high/critical**.
Also run `osv-scanner --lockfile server/package-lock.json --lockfile web/package-lock.json`
if you have it installed.

## 1. Linux PC: host hardening

```bash
sudo apt update && sudo apt install -y unattended-upgrades ufw
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
# Firewall: SSH + hub ports from the home LAN only (adjust the subnet).
sudo ufw default deny incoming
sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp
sudo ufw enable
```

SSH: put your public key in `~/.ssh/authorized_keys`, then set
`PasswordAuthentication no` and `PermitRootLogin no` in
`/etc/ssh/sshd_config.d/10-hardening.conf` and `sudo systemctl reload ssh`.

Docker publishes ports through its own iptables rules, which bypass ufw. Keep the
PC on your LAN only (no port forwarding on the router), or bind the published
ports to the LAN address in `docker-compose.yml` (for example `"192.168.1.20:8080:3000"`).

## 2. Linux PC: run the hub

```bash
git clone <this repo> homebase-desktop && cd homebase-desktop/deploy
./pin-images.sh                     # base images pinned by digest → deploy/.env
cp hub.env.example hub.env && chmod 600 hub.env
$EDITOR hub.env                     # JWT_SECRET, HOME_LAT/LON, TRACKER_URL, ADSB_CONTACT …
mkdir -p data && sudo chown -R 10001:10001 data && sudo chmod 700 data
docker compose build
docker compose up -d
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

## 3. Raspberry Pi 3 B screen

1. Flash Raspberry Pi OS (Bookworm, with desktop) and boot it on your network.
2. In the hub on a computer: **Settings → Screens → Create link**. Copy the link.
3. On the Pi:
   ```bash
   # from the Linux PC (or any machine with the repo):
   scp deploy/kiosk/setup-pi.sh pi@<pi-ip>:
   # then on the Pi:
   sudo bash setup-pi.sh "http://<pc-ip>:8080/kiosk/pair?t=hbd_…"
   sudo reboot
   ```
The Pi boots straight into the hub full-screen. Change what it shows (start tab,
LED or Clean board, night mode, rotation) from **Settings → Screens** on any
computer; it updates within seconds.

## 4. Backups

The whole state is `deploy/data/homebase.db` plus `deploy/hub.env`. Nightly:

```bash
sqlite3 deploy/data/homebase.db ".backup /backup/homebase-$(date +%F).db" && chmod 600 /backup/homebase-*.db
```

## 5. Updating

```bash
git pull
./deploy/pin-images.sh            # monthly: newest patched base images
docker compose -f deploy/docker-compose.yml build --pull
docker compose -f deploy/docker-compose.yml up -d
```
