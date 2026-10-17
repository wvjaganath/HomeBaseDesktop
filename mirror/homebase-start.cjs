/* HomeBase: starts MagicMirror² with its settings from the hub, so there is
 * no mirror.env to keep in step with the hub.
 *
 * 1. Asks the hub (fixed internal URL, hub ↔ mirror network only) for a
 *    read-only screen token, home location and units. The hub answers only
 *    this container's fixed address. Retries until the hub is up.
 * 2. Puts them in the environment that config.js and the MMM-HomeBase helper
 *    read, then starts MagicMirror's server as `node serveronly` would.
 * 3. Checks once a minute whether home/units changed (or the first account
 *    now exists) and, if so, exits; Docker restarts it with the new values.
 */
"use strict";

const HUB = (process.env.HOMEBASE_HUB_URL || "http://hub:3000").replace(/\/$/, "");
const MAX_BYTES = 64 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get (path) {
	const res = await fetch(`${HUB}${path}`, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(8000) });
	if (!res.ok) throw new Error(`hub responded ${res.status}`);
	const text = await res.text();
	if (text.length > MAX_BYTES) throw new Error("hub response too large");
	return JSON.parse(text);
}

const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
function clean (c) {
	return {
		lat: num(c && c.lat, -90, 90),
		lon: num(c && c.lon, -180, 180),
		units: c && c.units === "metric" ? "metric" : "imperial",
		hasOwner: Boolean(c && c.hasOwner)
	};
}

async function main () {
	let boot = null;
	for (let attempt = 0; boot === null; attempt++) {
		try {
			boot = await get("/internal/mirror/bootstrap");
		} catch (err) {
			if (attempt % 6 === 0) console.log(`[HomeBase] waiting for the hub (${err.message})…`);
			await sleep(10_000);
		}
	}
	const settings = clean(boot);
	const token = typeof boot.token === "string" && /^hbd_[A-Za-z0-9_-]{43}$/.test(boot.token) ? boot.token : "";
	process.env.HOMEBASE_DEVICE_TOKEN = token;
	process.env.HOME_LAT = settings.lat === null ? "" : String(settings.lat);
	process.env.HOME_LON = settings.lon === null ? "" : String(settings.lon);
	process.env.UNITS = settings.units;
	console.log(`[HomeBase] settings from the hub: ${settings.lat === null ? "no home location yet" : "home location set"}, ${settings.units}${token ? "" : ", no account yet (HomeBase panel waits)"}`);

	const seen = JSON.stringify(settings);
	setInterval(async () => {
		try {
			if (JSON.stringify(clean(await get("/internal/mirror/config"))) !== seen) {
				console.log("[HomeBase] settings changed in the hub; restarting MagicMirror to apply them");
				process.exit(0);
			}
		} catch {
			// hub restarting: check again next minute
		}
	}, 60_000);

	require("./serveronly");
}

main().catch((err) => {
	console.error("[HomeBase] could not start MagicMirror:", err);
	process.exit(1);
});
