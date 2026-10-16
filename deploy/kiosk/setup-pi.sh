#!/usr/bin/env bash
# HomeBase kiosk setup for a Raspberry Pi 3 B (1 GB) running Raspberry Pi OS
# Bookworm with the desktop (labwc/Wayland or the older X11 session).
#
# Usage (on the Pi, as a sudo-capable user):
#   sudo bash setup-pi.sh "http://<linux-pc-ip>:8080/kiosk/pair?t=hbd_xxxxxxxx"
#
# Get the pairing link from the hub: Settings → Screens → Add screen.
# What it does:
#   - creates a dedicated, password-less, non-sudo "kiosk" user with autologin
#   - installs Chromium and launches it full-screen at the pairing link
#   - restarts Chromium if it exits, and once a day at 04:00 to clear memory creep
#   - enables zram swap, turns off screen blanking, enables automatic security updates
#   - hardens SSH (key-only) if an authorized_keys file already exists
set -euo pipefail

PAIR_URL="${1:-}"
if [[ ! "$PAIR_URL" =~ ^https?://[A-Za-z0-9._:-]+/kiosk/pair\?t=hbd_[A-Za-z0-9_-]{43}$ ]]; then
  echo "Usage: sudo bash $0 \"http://<hub>:8080/kiosk/pair?t=hbd_…\"" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi

KIOSK_USER=kiosk
echo "==> Packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  chromium unattended-upgrades zram-tools fonts-noto-color-emoji
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
