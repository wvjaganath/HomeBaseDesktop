"""HomeBase: Govee room sensors over Bluetooth.

Listens for the readings Govee thermometer-hygrometers (H5075, H5072, H5074,
H5101, H5102, H5104, H5174, H5177, H5179 and others) broadcast over Bluetooth
every few seconds, decodes them with govee-ble (the decoder Home Assistant
uses), and keeps the latest reading per sensor in memory. The hub asks for
them with GET /readings once a minute.

It only listens: it never connects to a sensor, never writes to one and never
contacts the internet. It talks to the host's Bluetooth service (BlueZ) over
D-Bus, and answers HTTP on the Docker network the hub shares with it (or the
home network, when run on a Pi).

Settings (environment):
  GOVEE_PORT     port to answer on (default 8686)
  GOVEE_ADAPTER  Bluetooth adapter, e.g. hci1 (default: the system's default)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import time

from bleak import BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData
from govee_ble import GoveeBluetoothDeviceData
from home_assistant_bluetooth import BluetoothServiceInfo

PORT = int(os.environ.get("GOVEE_PORT", "8686"))
ADAPTER = os.environ.get("GOVEE_ADAPTER") or None
MAX_SENSORS = 64
FORGET_AFTER_S = 3600
RETRY_S = 15
MAX_REQUEST = 4096

log = logging.getLogger("govee")

# address -> decoder (one per sensor: some models spread a reading over
# several broadcasts) and address -> latest reading.
parsers: dict[str, GoveeBluetoothDeviceData] = {}
readings: dict[str, dict] = {}
# Addresses already found not to be Govee, so they aren't decoded again.
not_govee: set[str] = set()
state = {"scanning": False, "error": None}


def on_advertisement(device: BLEDevice, adv: AdvertisementData) -> None:
    addr = device.address.upper()
    if addr in not_govee or not adv.manufacturer_data:
        return
    info = BluetoothServiceInfo(
        name=adv.local_name or device.name or "",
        address=addr,
        rssi=adv.rssi,
        manufacturer_data=dict(adv.manufacturer_data),
        service_data=dict(adv.service_data),
        service_uuids=list(adv.service_uuids),
        source="local",
    )
    parser = parsers.get(addr)
    if parser is None:
        parser = GoveeBluetoothDeviceData()
        if not parser.supported(info):
            if len(not_govee) < 5000:
                not_govee.add(addr)
            return
        if len(parsers) >= MAX_SENSORS:
            return
        parsers[addr] = parser
    try:
        update = parser.update(info)
    except Exception:  # a malformed broadcast must never stop the listener
        return
    values = {key.key: value.native_value for key, value in update.entity_values.items()}
    if "temperature" not in values and "humidity" not in values and "battery" not in values:
        return
    model = next((d.model for d in update.devices.values() if d.model), None)
    prev = readings.get(addr, {})

    def num(key: str, lo: float, hi: float):
        v = values.get(key)
        if isinstance(v, (int, float)) and lo <= v <= hi:
            return v
        return prev.get({"temperature": "temperatureC"}.get(key, key))

    battery = num("battery", 0, 100)
    readings[addr] = {
        "address": addr,
        "model": model or prev.get("model"),
        "name": (info.name or "")[:40],
        "temperatureC": num("temperature", -60, 100),
        "humidity": num("humidity", 0, 100),
        "battery": int(battery) if isinstance(battery, (int, float)) else None,
        "rssi": adv.rssi,
        "seenAt": time.time(),
    }


async def scan_forever(stop: asyncio.Event) -> None:
    """Keep a scan running; restart it if Bluetooth goes away and comes back."""
    while not stop.is_set():
        try:
            kwargs = {"detection_callback": on_advertisement}
            if ADAPTER:
                kwargs["adapter"] = ADAPTER
            async with BleakScanner(**kwargs):
                state.update(scanning=True, error=None)
                log.info("scanning for Govee sensors%s", f" on {ADAPTER}" if ADAPTER else "")
                while not stop.is_set():
                    await asyncio.sleep(30)
                    cutoff = time.time() - FORGET_AFTER_S
                    for addr in [a for a, r in readings.items() if r["seenAt"] < cutoff]:
                        readings.pop(addr, None)
                        parsers.pop(addr, None)
        except Exception as err:  # BlueZ restarted, adapter unplugged, no permission…
            state.update(scanning=False, error=str(err)[:200] or err.__class__.__name__)
            log.warning("Bluetooth scan stopped (%s); retrying in %ss", state["error"], RETRY_S)
            try:
                await asyncio.wait_for(stop.wait(), RETRY_S)
            except asyncio.TimeoutError:
                pass
    state["scanning"] = False


def response(status: str, body: bytes, content_type: str = "application/json") -> bytes:
    head = (
        f"HTTP/1.1 {status}\r\n"
        f"Content-Type: {content_type}\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Cache-Control: no-store\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "Connection: close\r\n\r\n"
    )
    return head.encode() + body


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """A deliberately tiny HTTP server: GET /readings and GET /health only."""
    try:
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError):
            return
        if len(head) > MAX_REQUEST:
            writer.write(response("431 Request Header Fields Too Large", b""))
            return
        parts = head.split(b"\r\n", 1)[0].decode("latin-1").split(" ")
        method, path = (parts[0], parts[1]) if len(parts) >= 2 else ("", "")
        if method != "GET":
            writer.write(response("405 Method Not Allowed", b""))
        elif path == "/readings":
            body = {
                "scanning": state["scanning"],
                "adapter": ADAPTER,
                "error": state["error"],
                "sensors": sorted(readings.values(), key=lambda r: r["address"]),
            }
            writer.write(response("200 OK", json.dumps(body).encode()))
        elif path == "/health":
            writer.write(response("200 OK", b"ok", "text/plain"))
        else:
            writer.write(response("404 Not Found", b""))
        await writer.drain()
    finally:
        writer.close()


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    server = await asyncio.start_server(handle, host="0.0.0.0", port=PORT, limit=MAX_REQUEST)
    log.info("answering on port %s", PORT)
    async with server:
        await scan_forever(stop)


if __name__ == "__main__":
    asyncio.run(main())
