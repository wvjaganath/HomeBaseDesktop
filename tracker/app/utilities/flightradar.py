"""
flightradar.py — Route lookup via FlightRadar24 API.
Uses flight-summary/full (HomeBase patch; upstream used /light): 2 credits per flight
returned, with IATA codes, the flight number, registration, runways and distances.
Requires a paid FR24 subscription.

Set in config.py:
    FLIGHTRADAR24_KEY = "your-key-here"
"""

import json
import os
import requests
from datetime import datetime, timezone, timedelta
from time import time

try:
    from config import FLIGHTRADAR24_KEY as FR24_API_KEY
except (ImportError, ModuleNotFoundError, NameError):
    try:
        from config import FR24_API_KEY
    except (ImportError, ModuleNotFoundError, NameError):
        FR24_API_KEY = None

BASE_URL = "https://fr24api.flightradar24.com/api"

from utilities.airports import get_airport_coords as _airport_coords
from utilities.airports import icao_to_iata as _icao_to_iata
from utilities.airlines import get_airline_name as _lookup_airline

_cache    = {}
_warned_no_key = False  # HomeBase patch
CACHE_TTL = 3600  # 1 hour
MISS_TTL  = 120   # HomeBase patch: "no flights yet" (e.g. just took off) is retried after 2 minutes


def _to_unix(dt_str):
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(str(dt_str).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def is_available():
    return bool(FR24_API_KEY)


class FR24Client:

    def __init__(self):
        pass

    @property
    def ok(self):
        return bool(FR24_API_KEY)

    def get_flight_details(self, callsign, plane_lat, plane_lon,
                           plane_type="", registration="", distance=0.0):
        if not FR24_API_KEY:
            # HomeBase patch: say so (once) instead of failing silently.
            global _warned_no_key
            if not _warned_no_key:
                print("[FR24] No FlightRadar24 key loaded; restart the tracker after adding one")
                _warned_no_key = True
            return {}

        now = time()
        cached = _cache.get(callsign)
        if cached and (now - cached["ts"]) < (CACHE_TTL if cached["data"] else MISS_TTL):
            return cached["data"]

        try:
            # Use a 12-hour window around now to catch the current flight
            now_utc   = datetime.now(timezone.utc)
            # HomeBase patch: UTC times written with "Z", as FR24's examples are.
            from_utc  = (now_utc - timedelta(hours=12)).strftime("%Y-%m-%dT%H:%M:%SZ")
            to_utc    = (now_utc + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")

            r = requests.get(
                f"{BASE_URL}/flight-summary/full",
                headers={
                    "Accept": "application/json",
                    "Accept-Version": "v1",
                    "Authorization": f"Bearer {FR24_API_KEY}",
                },
                params={
                    "callsigns":            callsign,
                    "flight_datetime_from": from_utc,
                    "flight_datetime_to":   to_utc,
                    "limit":                2,  # HomeBase patch: credits are per flight returned
                    "sort":                 "desc",
                },
                timeout=10,
            )

            if r.status_code != 200:
                # HomeBase patch: say why (401 bad key, 402 no credits left, 429 too many requests).
                print(f"[FR24] Route lookup for {callsign} failed: HTTP {r.status_code}")
                return {}

            flights = r.json().get("data", [])
            if not flights:
                print(f"[FR24] {callsign}: FR24 found no flight with this callsign")  # HomeBase patch
                _cache[callsign] = {"data": {}, "ts": now}
                return {}

            # Prefer live flight (flight_ended=false), then most recent
            f = (
                next((fl for fl in flights if not fl.get("flight_ended", True)), None)
                or flights[0]
            )

            # HomeBase patch: /full gives IATA codes; convert ICAO ones only when it doesn't.
            origin_icao = f.get("orig_icao", "") or ""
            dest_icao   = f.get("dest_icao_actual", "") or f.get("dest_icao", "") or ""

            origin      = f.get("orig_iata") or (_icao_to_iata(origin_icao) if origin_icao else "?")
            destination = (f.get("dest_iata_actual") or f.get("dest_iata")
                           or (_icao_to_iata(dest_icao) if dest_icao else "?"))

            painted_as   = f.get("painted_as", "")   # marketing brand e.g. "AAL"
            operating_as = f.get("operating_as", "") or f.get("operated_as", "")  # operator e.g. "ENY"

            # Display name from painted_as, logo from operating_as
            airline_name = _lookup_airline(painted_as) or painted_as
            logo_icao    = operating_as or painted_as

            origin_coords = _airport_coords(origin) or _airport_coords(origin_icao) or {}
            dest_coords   = _airport_coords(destination) or _airport_coords(dest_icao) or {}

            takeoff_ts = _to_unix(f.get("datetime_takeoff"))
            landed_ts  = _to_unix(f.get("datetime_landed"))


            result = {
                "airline_name": airline_name,
                "airline_icao": logo_icao,
                "airline_iata": "",
                "origin_iata":  origin,
                "origin_lat":   origin_coords.get("lat"),
                "origin_lon":   origin_coords.get("lon"),
                "dest_iata":    destination,
                "dest_lat":     dest_coords.get("lat"),
                "dest_lon":     dest_coords.get("lon"),
                "plane_type":   f.get("type", plane_type),
                "time_scheduled_departure": takeoff_ts,
                "time_scheduled_arrival":   landed_ts,
                "time_real_departure":      takeoff_ts,
                "time_estimated_arrival":   landed_ts,
                "trail":        [],
                # HomeBase patch: more of what /full returns, for HomeBase's screens.
                "fr24": {
                    "flight":          f.get("flight") or "",
                    "registration":    f.get("reg") or "",
                    "type":            f.get("type") or "",
                    "runway_takeoff":  f.get("runway_takeoff") or "",
                    "planned_dest":    f.get("dest_iata") or "",
                    "diverted":        bool(f.get("dest_iata_actual") and f.get("dest_iata") and f.get("dest_iata_actual") != f.get("dest_iata")),
                    "circle_distance": f.get("circle_distance"),
                    "actual_distance": f.get("actual_distance"),
                    "first_seen":      _to_unix(f.get("first_seen")),
                },
            }

            _cache[callsign] = {"data": result, "ts": now}
            return result

        except Exception as e:
            print(f"[FR24] {callsign}: error — {e}")
            return {}

    def get_tracked_flight(self, callsign):
        if not FR24_API_KEY:
            return None

        result = self.get_flight_details(callsign, None, None)
        if not result or result.get("origin_iata") in ("?", "", None):
            return None

        return {
            "callsign":      callsign,
            "number":        callsign,
            "airline_name":  result.get("airline_name", ""),
            "is_live":       True,
            "origin":        result.get("origin_iata", ""),
            "destination":   result.get("dest_iata", ""),
            "dest_lat":      result.get("dest_lat"),
            "dest_lon":      result.get("dest_lon"),
            "aircraft_type": result.get("plane_type", ""),
            "altitude":      0,
            "ground_speed":  0,
            "heading":       0,
            "latitude":      None,
            "longitude":     None,
            "time_scheduled_departure": result.get("time_scheduled_departure"),
            "time_scheduled_arrival":   result.get("time_scheduled_arrival"),
            "time_real_departure":      result.get("time_real_departure"),
            "time_estimated_arrival":   result.get("time_estimated_arrival"),
        }
