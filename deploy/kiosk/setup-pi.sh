#!/usr/bin/env bash
# HomeBase kiosk setup for a Raspberry Pi 3 B (1 GB) running Raspberry Pi OS
# Bookworm with the desktop (labwc/Wayland or the older X11 session).
#
# Usage (on the Pi, as a sudo-capable user):
#   sudo bash setup-pi.sh --ca homebase-ca.crt "https://<linux-pc-ip>:8443/kiosk/pair?t=hbd_xxxxxxxx"
#
# --ca installs the hub's local HTTPS certificate authority (see
# deploy/README.md §3) so Chromium trusts https://<pc>:8443. Without it, use the
# plain http://<pc>:3000/kiosk/pair?t=… link instead.
#
# Get the pairing link from the hub: Settings → Screens → Add screen.
# What it does:
#   - creates a dedicated, password-less, non-sudo "kiosk" user with autologin
#   - installs Chromium and launches it full-screen at the pairing link
#   - restarts Chromium if it exits, and once a day at 04:00 to clear memory creep
#   - enables zram swap, turns off screen blanking, enables automatic security updates
#   - hardens SSH (key-only) if an authorized_keys file already exists
set -euo pipefail

CA_FILE=""
if [[ "${1:-}" == "--ca" ]]; then
  CA_FILE="${2:-}"
  shift 2 || true
fi
PAIR_URL="${1:-}"
if [[ ! "$PAIR_URL" =~ ^https?://[A-Za-z0-9._:-]+/kiosk/pair\?t=hbd_[A-Za-z0-9_-]{43}$ ]]; then
  echo "Usage: sudo bash $0 [--ca homebase-ca.crt] \"https://<hub>:8443/kiosk/pair?t=hbd_…\"" >&2
  exit 1
fi
if [[ "$PAIR_URL" == https://* && -z "$CA_FILE" ]]; then
  echo "An https:// link needs the hub's certificate: add --ca homebase-ca.crt (deploy/README.md §3)." >&2
  exit 1
fi
if [[ -n "$CA_FILE" ]]; then
  if [[ ! -f "$CA_FILE" ]] || ! openssl x509 -in "$CA_FILE" -noout -subject 2>/dev/null | grep -q "HomeBase Local CA"; then
    echo "$CA_FILE is not the HomeBase local CA certificate." >&2
    exit 1
  fi
fi
if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi

KIOSK_USER=kiosk
echo "==> Packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  chromium unattended-upgrades zram-tools fonts-noto-color-emoji libnss3-tools openssl
apt-get -y full-upgrade

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> zram swap (helps a 1 GB Pi)"
cat > /etc/default/zramswap <<'EOF'
ALGO=zstd
PERCENT=50
PRIORITY=100
EOF
systemctl enable --now zramswap || true

echo "==> Kiosk user"
if ! id "$KIOSK_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "HomeBase kiosk" "$KIOSK_USER"
fi
# Video/render access only; never sudo.
usermod -aG video,render,input "$KIOSK_USER"
deluser "$KIOSK_USER" sudo 2>/dev/null || true

KHOME="/home/$KIOSK_USER"
install -d -m 700 -o "$KIOSK_USER" -g "$KIOSK_USER" "$KHOME/.homebase"
# The pairing link is the screen's credential: owner-only file.
install -m 600 -o "$KIOSK_USER" -g "$KIOSK_USER" /dev/null "$KHOME/.homebase/url"
printf '%s\n' "$PAIR_URL" > "$KHOME/.homebase/url"

cat > /usr/local/bin/homebase-kiosk <<'EOF'
#!/usr/bin/env bash
# Launch Chromium full-screen at the hub; relaunch if it exits.
URL="$(cat "$HOME/.homebase/url")"
PROFILE="$HOME/.homebase/chromium"
mkdir -p "$PROFILE"
# Clear the "Chromium didn't shut down correctly" bubble after power loss.
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"Crashed"/"exit_type":"Normal"/' \
  "$PROFILE/Default/Preferences" 2>/dev/null || true
while true; do
  chromium \
    --user-data-dir="$PROFILE" \
    --kiosk --noerrdialogs --disable-infobars --no-first-run \
    --disable-features=Translate,MediaRouter,OptimizationHints \
    --disable-component-update --disable-background-networking \
    --disable-sync --password-store=basic --check-for-update-interval=31536000 \
    --renderer-process-limit=2 --enable-low-end-device-mode \
    --overscroll-history-navigation=0 --disable-pinch \
    "$URL"
  sleep 3
done
EOF
chmod 755 /usr/local/bin/homebase-kiosk

if [[ -n "$CA_FILE" ]]; then
  echo "==> Trusting the hub's HTTPS certificate"
  echo "    Fingerprint (compare with the one shown on the PC):"
  openssl x509 -in "$CA_FILE" -noout -fingerprint -sha256 | sed 's/^/    /'
  # System store (curl etc.) …
  install -m 644 "$CA_FILE" /usr/local/share/ca-certificates/homebase-local-ca.crt
  update-ca-certificates >/dev/null
  # … and Chromium's own NSS store for the kiosk user.
  install -d -m 700 -o "$KIOSK_USER" -g "$KIOSK_USER" "$KHOME/.pki/nssdb"
  if [[ ! -f "$KHOME/.pki/nssdb/cert9.db" ]]; then
    sudo -u "$KIOSK_USER" certutil -d "sql:$KHOME/.pki/nssdb" -N --empty-password
  fi
  sudo -u "$KIOSK_USER" certutil -d "sql:$KHOME/.pki/nssdb" -D -n "HomeBase Local CA" 2>/dev/null || true
  sudo -u "$KIOSK_USER" certutil -d "sql:$KHOME/.pki/nssdb" -A -t "C,," -n "HomeBase Local CA" -i "$CA_FILE"
fi

echo "==> Autostart"
# labwc (Wayland, current Raspberry Pi OS default)
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$KHOME/.config/labwc"
cat > "$KHOME/.config/labwc/autostart" <<'EOF'
/usr/local/bin/homebase-kiosk &
EOF
# X11 / LXDE session (older images)
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$KHOME/.config/lxsession/LXDE-pi"
cat > "$KHOME/.config/lxsession/LXDE-pi/autostart" <<'EOF'
@xset s off
@xset -dpms
@xset s noblank
@/usr/local/bin/homebase-kiosk
EOF
chown -R "$KIOSK_USER:$KIOSK_USER" "$KHOME/.config"

echo "==> Desktop autologin as $KIOSK_USER, screen blanking off"
if command -v raspi-config >/dev/null; then
  raspi-config nonint do_boot_behaviour B4 || true
  raspi-config nonint do_blanking 1 || true
fi
for f in /etc/lightdm/lightdm.conf; do
  [[ -f $f ]] && sed -i "s/^#\?autologin-user=.*/autologin-user=$KIOSK_USER/" "$f"
done

echo "==> Daily Chromium restart at 04:00 (memory hygiene)"
cat > /etc/cron.d/homebase-kiosk <<EOF
0 4 * * * root pkill -u $KIOSK_USER -f 'chromium.*--kiosk' || true
EOF
chmod 644 /etc/cron.d/homebase-kiosk

echo "==> SSH hardening"
if compgen -G "/home/*/.ssh/authorized_keys" >/dev/null; then
  install -d /etc/ssh/sshd_config.d
  cat > /etc/ssh/sshd_config.d/10-homebase.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  systemctl reload ssh || true
  echo "    Password SSH logins disabled (key-only)."
else
  echo "    No authorized_keys found; leaving SSH password login as is. Add a key, then re-run to harden."
fi

echo
echo "Done. Reboot to start the kiosk:  sudo reboot"
