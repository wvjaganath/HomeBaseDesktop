"""HomeBase: ask FlightRadar24 about one flight, exactly as the tracker does.

Shows whether the tracker's FR24 client and key are loaded, then FR24's raw
answer for the request the tracker sends (and the same with "Z" on the times),
so a missing route can be traced to the key, the plan or the request.

    docker compose exec -T tracker python /opt/tracker/headless/fr24_check.py UAL1738

Uses one FR24 lookup (credits) per request, so two in all. The key is never printed.
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

now = datetime.now(timezone.utc)
base = {
    "callsigns": callsign,
    "flight_datetime_from": (now - timedelta(hours=12)).strftime("%Y-%m-%dT%H:%M:%S"),
    "flight_datetime_to": (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S"),
    "limit": 5,
    "sort": "desc",
}
with_z = {**base, "flight_datetime_from": base["flight_datetime_from"] + "Z", "flight_datetime_to": base["flight_datetime_to"] + "Z"}
headers = {"Accept": "application/json", "Accept-Version": "v1", "Authorization": f"Bearer {fr.FR24_API_KEY}"}

for label, params in (("as the tracker sends it", base), ('with "Z" on the times', with_z)):
    try:
        r = requests.get(f"{fr.BASE_URL}/flight-summary/light", params=params, headers=headers, timeout=15)
        print(f"--- {label}: HTTP {r.status_code}")
        print(r.text[:800].replace(fr.FR24_API_KEY, "[hidden]"))
    except requests.RequestException as e:
        print(f"--- {label}: request failed: {e}")
