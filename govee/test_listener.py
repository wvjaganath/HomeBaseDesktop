"""Tests for listener.py without Bluetooth hardware.

  python -m unittest govee/test_listener.py   (with govee-ble installed)

bleak is replaced by a stub, so this runs on any computer: it checks that a
real H5075 broadcast is decoded, that other devices are ignored, and that the
HTTP endpoint answers only GET /readings and /health.
"""

import asyncio
import json
import sys
import types
import unittest
from pathlib import Path

# Use the real bleak when it's installed (no scan is started); stub it otherwise.
try:
    import bleak  # noqa: F401
except ImportError:
    bleak = types.ModuleType("bleak")
    bleak.BleakScanner = bleak.BleakClient = object
    backends = types.ModuleType("bleak.backends")
    device_mod = types.ModuleType("bleak.backends.device")
    device_mod.BLEDevice = object
    scanner_mod = types.ModuleType("bleak.backends.scanner")
    scanner_mod.AdvertisementData = object
    sys.modules.update({"bleak": bleak, "bleak.backends": backends, "bleak.backends.device": device_mod, "bleak.backends.scanner": scanner_mod})
sys.path.insert(0, str(Path(__file__).parent))

import listener  # noqa: E402


class Dev:
    def __init__(self, address, name=""):
        self.address = address
        self.name = name


class Adv:
    def __init__(self, name, rssi, manufacturer_data, service_uuids=()):
        self.local_name = name
        self.rssi = rssi
        self.manufacturer_data = manufacturer_data
        self.service_data = {}
        self.service_uuids = list(service_uuids)


# A real H5075 broadcast: 21.3 °C, 44.2 %, battery 100 %.
H5075 = {60552: b"\x00\x03A\xc2d\x00"}


class ListenerTests(unittest.TestCase):
    def setUp(self):
        listener.parsers.clear()
        listener.readings.clear()
        listener.not_govee.clear()

    def test_decodes_h5075(self):
        listener.on_advertisement(Dev("a4:c1:38:00:27:62"), Adv("GVH5075_2762", -63, H5075, ["0000ec88-0000-1000-8000-00805f9b34fb"]))
        r = listener.readings["A4:C1:38:00:27:62"]
        self.assertEqual(r["model"], "H5075")
        self.assertAlmostEqual(r["temperatureC"], 21.3)
        self.assertAlmostEqual(r["humidity"], 44.2)
        self.assertEqual(r["battery"], 100)
        self.assertEqual(r["rssi"], -63)

    def test_ignores_other_devices(self):
        listener.on_advertisement(Dev("11:22:33:44:55:66"), Adv("Pixel Buds", -70, {224: b"\x01\x02\x03"}))
        self.assertEqual(listener.readings, {})
        self.assertIn("11:22:33:44:55:66", listener.not_govee)

    def test_http(self):
        listener.on_advertisement(Dev("A4:C1:38:00:27:62"), Adv("GVH5075_2762", -63, H5075, ["0000ec88-0000-1000-8000-00805f9b34fb"]))

        async def run():
            server = await asyncio.start_server(listener.handle, "127.0.0.1", 0)
            port = server.sockets[0].getsockname()[1]

            async def get(line):
                r, w = await asyncio.open_connection("127.0.0.1", port)
                w.write(line.encode())
                await w.drain()
                data = await r.read()
                w.close()
                return data.decode()

            out = {
                "readings": await get("GET /readings HTTP/1.1\r\nHost: x\r\n\r\n"),
                "health": await get("GET /health HTTP/1.1\r\n\r\n"),
                "post": await get("POST /readings HTTP/1.1\r\n\r\n"),
                "other": await get("GET /etc/passwd HTTP/1.1\r\n\r\n"),
            }
            server.close()
            await server.wait_closed()
            return out

        out = asyncio.run(run())
        self.assertTrue(out["readings"].startswith("HTTP/1.1 200"))
        body = json.loads(out["readings"].split("\r\n\r\n", 1)[1])
        self.assertEqual(body["sensors"][0]["address"], "A4:C1:38:00:27:62")
        self.assertTrue(out["health"].startswith("HTTP/1.1 200"))
        self.assertTrue(out["post"].startswith("HTTP/1.1 405"))
        self.assertTrue(out["other"].startswith("HTTP/1.1 404"))


if __name__ == "__main__":
    unittest.main()
