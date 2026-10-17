/* MagicMirror² config for HomeBase Desktop (README §6.4).
 *
 * Runs in "serveronly" mode on the internal Docker network. The hub at /mirror/
 * is the only way in, so MagicMirror itself never sees the internet-facing
 * side of anything. Secrets (the screen token) are read by node helpers from
 * the environment and never placed in this file, which MagicMirror sends to
 * the browser (in redacted form).
 */
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== "" && v !== undefined ? Number(v) : fallback);

let config = {
	address: "0.0.0.0",
	port: 8080,
	basePath: "/mirror/",
	// Only the hub's internal network may connect (defence in depth; the
	// container also has no published port). Set by docker-compose.
	ipWhitelist: (process.env.MM_ALLOWED_CIDRS || "127.0.0.1/32").split(",").map((s) => s.trim()).filter(Boolean),
	useHttps: false,

	language: "en",
	locale: "en-US",
	timeFormat: 12,
	units: process.env.UNITS === "metric" ? "metric" : "imperial",

	// MagicMirror defaults (helmet without CSP: the hub sets the CSP).
	httpHeaders: { contentSecurityPolicy: false, crossOriginOpenerPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: false, originAgentCluster: false },

	modules: [
		{ module: "alert" },
		{ module: "clock", position: "top_left", config: { displaySeconds: false, showSunTimes: true, lat: num(process.env.HOME_LAT, 0), lon: num(process.env.HOME_LON, 0) } },
		{
			module: "weather",
			position: "top_right",
			config: { weatherProvider: "openmeteo", type: "current", lat: num(process.env.HOME_LAT, 0), lon: num(process.env.HOME_LON, 0) }
		},
		{
			module: "weather",
			position: "top_right",
			header: "Forecast",
			config: { weatherProvider: "openmeteo", type: "forecast", maxNumberOfDays: 4, lat: num(process.env.HOME_LAT, 0), lon: num(process.env.HOME_LON, 0) }
		},
		{
			module: "MMM-HomeBase",
			position: "top_left",
			header: "HomeBase",
			config: { agendaDays: 3, maxEvents: 8, maxReminders: 6, showNotes: true }
		},
		{ module: "compliments", position: "lower_third" }
		// Add community modules under mirror/modules/ after reviewing their code
		// (README §7.5). updatenotification is deliberately left out.
	]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }
