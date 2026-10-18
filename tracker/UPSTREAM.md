# Plane tracker (bundled)

`tracker/app` is a copy of **its-a-plane-python** from
[c0wsaysmoo/plane-tracker-rgb-pi](https://github.com/c0wsaysmoo/plane-tracker-rgb-pi),
commit `c64ca80965848e98efced536edb807e22954ef64` (2026-09-28). The upstream repo
has no licence file; this copy is for the owner's private use.

It runs headless on the HomeBase server (`deploy/tracker.Dockerfile`) as the
**master** tracker: it finds overhead flights, looks up routes with your API
keys, and fetches weather, alerts and ISS passes. The LED board (Pi) runs the
original tracker as a **slave** of it, so it only draws and holds no API keys.
HomeBase is the only web UI.

## What HomeBase changed in the copy

Kept to a minimum so updating stays easy (each change is marked `HomeBase` in the code):

| File | Change | Why |
| --- | --- | --- |
| `setup/email_alerts.py` | `_send()` does nothing | Upstream emails from the author's shared Gmail account with its password in the code. The account and password are removed; email alerts are off. |
| `web/upload_helper.py` | Returns an empty link | Upstream uploads the closest/farthest maps (which show your home area) to the author's server. Nothing is uploaded. |
| `web/apppublic.py` | Adds `GET /homebase/tracked/live` | The tracked flight's live position (the file `overhead.py` already writes each cycle) for HomeBase's Track a flight screen. Read-only, and not part of the LED feed. |
| `utilities/temperature.py` | No Tomorrow.io request without a key | Upstream sends the location every 10 minutes even with no key, only to be refused. |
| `utilities/landmarks.py` | No place-name lookups when `HOMEBASE_HEADLESS=1` | On the server nothing displays them, so there's no reason to query OpenStreetMap's Nominatim. |
| `utilities/opensky.py` | Pauses OpenSky after HTTP 429 | The anonymous backup (used only when adsb.lol fails) would otherwise retry every 30 s after the daily allowance is used up. |
| `utilities/routelookup.py` | A cached "route not found" keeps the plane | Upstream caches a failed lookup as `{}`, and `overhead.py` then drops that plane for an hour, so a plane in your box vanished from every board. It now gets the same "route unknown" entry as on the first miss. |
| `utilities/flightradar.py` | Logs FR24's HTTP status when a lookup fails | Upstream returned nothing silently, so a bad key or used-up credits couldn't be seen in `docker compose logs tracker`. |
| `logos/` | Only `default.png` | The server draws nothing; the LED board has its own logo set. |
| `fonts/` | Not copied | The headless stand-in doesn't read fonts. |

Everything else is byte-for-byte upstream. HomeBase's own pieces live outside
`app/`:

- `headless/rgbmatrix/`: a no-op stand-in for the LED panel library, so the
  tracker's display loop (which also schedules its data updates) runs unchanged.
- `headless/bin/sudo`: fails on purpose, so the web UI's Restart falls back to
  `.restart_requested`, which the supervisor watches.
- `headless/homebase_run.py`: keeps the code read-only and the tracker's
  state (config, caches, logs, counters, maps) on the `/data` volume,
  restarts it on request, and hides API keys in its log output (upstream's
  error messages can include a request URL with the key in it).
- `requirements.txt`: the Python packages it imports, exact versions with hashes.

## Updating to a newer upstream version

```bash
git clone https://github.com/c0wsaysmoo/plane-tracker-rgb-pi /tmp/pt && cd /tmp/pt && git log -1
# copy its-a-plane-python over tracker/app (skip __pycache__, fonts, config/*.json),
# then re-apply the patches above and check:
grep -rn "gmail\|ddnsgeek\|smtplib.SMTP" tracker/app   # must print nothing
```

Then update the commit above, re-check `requirements.txt` against its imports,
rebuild (`docker compose build tracker`) and watch `docker compose logs tracker`.

## Settings take effect only after a restart

The tracker's web app (which receives a settings save) runs as a separate
process from the flight loop, and the flight loop reads its settings once at
start (`from config import ZONE_HOME`, the API keys, sources, altitude
filter…). Upstream's settings page still says "Changes are live immediately".
HomeBase therefore restarts the tracker (or the LED board) after a save that
changed something.
