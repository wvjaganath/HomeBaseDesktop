"""HomeBase: ask FlightRadar24 about one flight, exactly as the tracker does.

Shows whether the tracker's FR24 client and key are loaded, then FR24's raw
answers for the request the LED board's original tracker sends (light) and the
one this server's tracker sends (full), so a missing route can be traced to
the key, the plan or the request.

    docker compose exec -T tracker python /opt/tracker/headless/fr24_check.py UAL1738

Uses two FR24 lookups (light, then full: a few credits). The key is never printed, only its first and last 4 characters.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

APP = os.environ.get("TRACKER_DATA", "/data/app")
callsign = (sys.argv[1] if len(sys.argv) > 1 else "").strip().upper()
if not callsign.isalnum() or not 3 <= len(callsign) <= 8:
    sys.exit("Give a callsign, e.g.: fr24_check.py UAL1738")

sys.path.insert(0, APP)
os.chdir(APP)

import requests  # noqa: E402

from utilities import routelookup as rl  # noqa: E402
import utilities.flightradar as fr  # noqa: E402

print(f"FR24 client loaded: {rl._has_fr24} | key loaded: {bool(fr.FR24_API_KEY)}")
if not fr.FR24_API_KEY:
    sys.exit("No FR24 key in the tracker's settings (Settings -> Plane tracker -> API keys).")

# A fingerprint of the key, to compare with the LED board's (Settings -> Plane tracker
# shows both masked the same way: first 4 and last 4 characters).
k = fr.FR24_API_KEY
print(f"key: {k[:4]}****{k[-4:]}  ({len(k)} characters)" if len(k) > 8 else "key: (too short to be an FR24 token)")

now = datetime.now(timezone.utc)
headers = {"Accept": "application/json", "Accept-Version": "v1", "Authorization": f"Bearer {k}"}
# 1) exactly what the original tracker (the LED board) sends; 2) what this server's tracker sends now.
board = {
    "callsigns": callsign,
    "flight_datetime_from": (now - timedelta(hours=12)).strftime("%Y-%m-%dT%H:%M:%S"),
    "flight_datetime_to": (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S"),
    "limit": 5,
    "sort": "desc",
}
server = {**board, "flight_datetime_from": board["flight_datetime_from"] + "Z", "flight_datetime_to": board["flight_datetime_to"] + "Z", "limit": 2}

for label, path, params in (("like the LED board (light)", "light", board), ("like this server (full)", "full", server)):
    try:
        r = requests.get(f"{fr.BASE_URL}/flight-summary/{path}", params=params, headers=headers, timeout=15)
    except requests.RequestException as e:
        print(f"--- {label}: request failed: {e}")
        continue
    print(f"--- {label}: HTTP {r.status_code}")
    print(r.text[:900].replace(k, "[hidden]"))
    try:
        answered = {str(f.get("callsign") or "").strip().upper() for f in r.json().get("data", [])}
    except (ValueError, AttributeError):
        answered = set()
    if answered and callsign not in answered:
        print(f"!!! answered about {', '.join(sorted(answered))}, not {callsign}: FR24's sample data, as a sandbox token gets.")
    elif r.status_code == 200 and not answered:
        print(f"(no flight {callsign} in the last 12 hours)")
