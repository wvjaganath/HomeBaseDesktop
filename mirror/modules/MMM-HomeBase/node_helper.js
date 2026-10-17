/* MMM-HomeBase server-side helper.
 *
 * Fetches the HomeBase agenda, reminders and pinned notes from the hub with a
 * read-only screen token. The token comes from the environment
 * (HOMEBASE_DEVICE_TOKEN) and never reaches the browser. Only the hub's fixed
 * internal URL is contacted; responses are size-limited and checked.
 */
const NodeHelper = require("node_helper");
const Log = require("logger");

const HUB_URL = (process.env.HOMEBASE_HUB_URL || "http://hub:3000").replace(/\/$/, "");
const TOKEN = process.env.HOMEBASE_DEVICE_TOKEN || "";
const MAX_BYTES = 1024 * 1024;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

async function getJson (path) {
	const res = await fetch(`${HUB_URL}${path}`, {
		headers: { authorization: `Bearer ${TOKEN}`, accept: "application/json" },
		redirect: "error",
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`hub responded ${res.status}`);
	const text = await res.text();
	if (text.length > MAX_BYTES) throw new Error("hub response too large");
	return JSON.parse(text);
}

module.exports = NodeHelper.create({
	start () {
		this.timer = null;
		this.pending = null;
		this.config = { agendaDays: 3, maxEvents: 8, maxReminders: 6, showNotes: true };
		Log.log(`Starting node helper for: ${this.name} (hub ${HUB_URL})`);
	},

	socketNotificationReceived (notification, payload) {
		if (notification !== "HB_START") return;
		const n = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
		this.config = {
			agendaDays: n(payload && payload.agendaDays, 1, 14, 3),
			maxEvents: n(payload && payload.maxEvents, 1, 30, 8),
			maxReminders: n(payload && payload.maxReminders, 1, 20, 6),
			showNotes: !(payload && payload.showNotes === false)
		};
		if (!this.timer) {
			this.timer = setInterval(() => this.refresh(), 60 * 1000);
		}
		// Every new browser (a reload, a second screen) gets data straight away.
		this.refresh();
	},

	refresh () {
		// Coalesce overlapping calls (several screens reconnecting at once).
		if (!this.pending) this.pending = this.fetchAndSend().finally(() => { this.pending = null; });
		return this.pending;
	},

	async fetchAndSend () {
		if (!TOKEN) {
			this.sendSocketNotification("HB_ERROR", { message: "No screen token configured (HOMEBASE_DEVICE_TOKEN)." });
			return;
		}
		try {
			const today = new Date();
			const until = new Date(today);
			until.setDate(until.getDate() + this.config.agendaDays);
			const [lists, cal] = await Promise.all([getJson("/api/lists"), getJson(`/api/calendar?from=${ymd(today)}&to=${ymd(until)}`)]);
			const now = Date.now();
			const events = (Array.isArray(cal.events) ? cal.events : [])
				.filter((e) => (e.allDay ? str(e.end, 10) > ymd(today) : Date.parse(e.end) > now))
				.slice(0, this.config.maxEvents)
				.map((e) => ({ title: str(e.title), allDay: e.allDay === true, start: str(e.start, 40), color: /^#[0-9a-fA-F]{6}$/.test(e.color) ? e.color : "#8f9baa" }));
			const reminders = (lists.reminders && Array.isArray(lists.reminders.items) ? lists.reminders.items : [])
				.slice(0, this.config.maxReminders)
				.map((r) => ({ title: str(r.title), dueAt: str(r.dueAt, 40), overdue: r.overdue === true }));
			const notes = !this.config.showNotes ? [] : (lists.notes && Array.isArray(lists.notes.items) ? lists.notes.items : [])
				.slice(0, 2)
				.map((nt) => ({
					title: str(nt.title),
					body: str(nt.body, 300),
					isChecklist: nt.isChecklist === true,
					items: (Array.isArray(nt.items) ? nt.items : []).slice(0, 8).map((i) => ({ text: str(i.text), done: i.done === true }))
				}));
			this.sendSocketNotification("HB_DATA", { events, reminders, notes, at: new Date().toISOString() });
		} catch (err) {
			Log.warn(`MMM-HomeBase: ${err.message}`);
			this.sendSocketNotification("HB_ERROR", { message: "Can’t reach HomeBase right now." });
		}
	}
});
