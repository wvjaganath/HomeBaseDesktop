/* MMM-HomeBase: today's agenda, reminders and pinned notes from HomeBase.
 * All text is inserted with textContent (never innerHTML), since it comes
 * from user data synced by the phones.
 */
Module.register("MMM-HomeBase", {
	defaults: {
		agendaDays: 3,
		maxEvents: 8,
		maxReminders: 6,
		showNotes: true
	},

	start () {
		this.hb = null;
		this.error = "";
		this.sendSocketNotification("HB_START", {
			agendaDays: this.config.agendaDays,
			maxEvents: this.config.maxEvents,
			maxReminders: this.config.maxReminders,
			showNotes: this.config.showNotes
		});
	},

	getStyles () {
		return ["MMM-HomeBase.css"];
	},

	socketNotificationReceived (notification, payload) {
		if (notification === "HB_DATA") {
			this.hb = payload;
			this.error = "";
			this.updateDom(500);
		} else if (notification === "HB_ERROR") {
			this.error = payload && payload.message ? String(payload.message) : "Unavailable";
			this.updateDom(500);
		}
	},

	el (tag, cls, text) {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text !== undefined) e.textContent = text;
		return e;
	},

	when (iso, allDay) {
		const d = new Date(allDay ? `${iso}T12:00:00` : iso);
		if (Number.isNaN(d.getTime())) return "";
		const today = new Date();
		const tomorrow = new Date();
		tomorrow.setDate(today.getDate() + 1);
		const day = d.toDateString() === today.toDateString() ? "Today" : d.toDateString() === tomorrow.toDateString() ? "Tomorrow" : d.toLocaleDateString(this.config.locale || "en-US", { weekday: "short" });
		return allDay ? day : `${day} ${d.toLocaleTimeString(this.config.locale || "en-US", { hour: "numeric", minute: "2-digit" })}`;
	},

	getDom () {
		const root = this.el("div", "hb");
		if (this.error) {
			root.appendChild(this.el("div", "hb-dim", this.error));
			return root;
		}
		if (!this.hb) {
			root.appendChild(this.el("div", "hb-dim", "Loading…"));
			return root;
		}

		const section = (title) => {
			const s = this.el("div", "hb-section");
			s.appendChild(this.el("div", "hb-title", title));
			root.appendChild(s);
			return s;
		};

		const agenda = section("Up next");
		if (this.hb.events.length === 0) agenda.appendChild(this.el("div", "hb-dim", "Nothing scheduled."));
		for (const e of this.hb.events) {
			const row = this.el("div", "hb-row");
			const dot = this.el("span", "hb-dot");
			dot.style.backgroundColor = e.color;
			row.appendChild(dot);
			row.appendChild(this.el("span", "hb-when", this.when(e.start, e.allDay)));
			row.appendChild(this.el("span", "hb-text", e.title));
			agenda.appendChild(row);
		}

		const rem = section("Reminders");
		if (this.hb.reminders.length === 0) rem.appendChild(this.el("div", "hb-dim", "All caught up."));
		for (const r of this.hb.reminders) {
			const row = this.el("div", r.overdue ? "hb-row hb-overdue" : "hb-row");
			row.appendChild(this.el("span", "hb-ring"));
			row.appendChild(this.el("span", "hb-text", r.title));
			row.appendChild(this.el("span", "hb-when", r.overdue ? "Overdue" : this.when(r.dueAt, false)));
			rem.appendChild(row);
		}

		for (const n of this.hb.notes) {
			const s = section(n.title || "Note");
			if (n.isChecklist) {
				for (const i of n.items) {
					const row = this.el("div", i.done ? "hb-row hb-done" : "hb-row");
					row.appendChild(this.el("span", i.done ? "hb-box hb-box-done" : "hb-box"));
					row.appendChild(this.el("span", "hb-text", i.text));
					s.appendChild(row);
				}
			} else {
				s.appendChild(this.el("div", "hb-body", n.body));
			}
		}
		return root;
	}
});
