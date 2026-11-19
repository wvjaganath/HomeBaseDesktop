#!/usr/bin/env bash
# Optional, on each Raspberry Pi: tells node_exporter whether the Pi has been
# slowed down (heat) or had a weak power supply, for the House tab and alerts.
# Writes vcgencmd's throttle bitmask as `homebase_rpi_throttled` into
# node_exporter's textfile directory (Debian / Raspberry Pi OS default below).
#
# Install (as root):
#   install -m 755 rpi-throttled.sh /usr/local/bin/homebase-rpi-throttled
#   echo '* * * * * root /usr/local/bin/homebase-rpi-throttled' > /etc/cron.d/homebase-rpi-throttled
set -euo pipefail

DIR="${TEXTFILE_DIR:-/var/lib/prometheus/node-exporter}"
out="$(vcgencmd get_throttled)"          # e.g. throttled=0x50000
hex="${out#*=}"
[[ "$hex" =~ ^0x[0-9a-fA-F]+$ ]] || { echo "unexpected vcgencmd output: $out" >&2; exit 1; }

tmp="$(mktemp "$DIR/.homebase_rpi.XXXXXX")"
{
  echo "# HELP homebase_rpi_throttled vcgencmd get_throttled bitmask (0 = all good)."
  echo "# TYPE homebase_rpi_throttled gauge"
  echo "homebase_rpi_throttled $((hex))"
} > "$tmp"
chmod 644 "$tmp"
mv "$tmp" "$DIR/homebase_rpi.prom"       # atomic, so node_exporter never reads half a file
