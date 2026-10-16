import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import ical, { type CalendarResponse, type VEvent } from 'node-ical';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { EventBus } from '../events.js';
import type { SecretBox } from '../security/secretBox.js';
import { safeFetch } from '../security/safeFetch.js';

/**
 * Google Calendar via each calendar's "secret address in iCal format"
 * (read-only, no OAuth). URLs are encrypted at rest and never sent to browsers.
 */
export const GOOGLE_ICAL_RE =
  /^https:\/\/calendar\.google\.com\/calendar\/ical\/[A-Za-z0-9._%@+-]{3,200}\/(private-[0-9a-f]{16,64}|public)\/basic\.ics$/;
const ALLOWED_HOSTS = ['calendar.google.com'];
const REFRESH_MS = 5 * 60_000;
const MAX_ICS_BYTES = 5 * 1024 * 1024;
const MAX_RANGE_DAYS = 100;

export const CALENDAR_COLORS = ['#2DD4BF', '#FBBF24', '#60A5FA', '#F472B6', '#A78BFA', '#FB923C', '#4ADE80', '#F87171'] as const;

export const calendarSourceInput = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().regex(GOOGLE_ICAL_RE, 'Paste the "Secret address in iCal format" from Google Calendar settings'),
  color: z.enum(CALENDAR_COLORS),
});

export interface CalendarEvent {
  id: string;
  sourceId: string;
  title: string;
  allDay: boolean;
  /** All-day: YYYY-MM-DD (inclusive). Timed: ISO instant. */
  start: string;
  /** All-day: YYYY-MM-DD (exclusive). Timed: ISO instant. */
  end: string;
  color: string;
}

export interface CalendarSourceRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  url_enc: string;
  created_at: string;
}

interface CachedSource {
  fetchedAt: number;
  ok: boolean;
  error: string | null;
  events: CalendarResponse;
}

const WORKOUT_SOURCE_ID = 'homebase-workouts';
const WORKOUT_COLOR = '#60A5FA';

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function eventTitle(summary: unknown): string {
  if (typeof summary === 'string') return summary.slice(0, 200);
  if (summary && typeof summary === 'object' && 'val' in summary) return String(summary.val).slice(0, 200);
  return '(No title)';
}

export class CalendarService {
  private cache = new Map<string, CachedSource>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DB,
    private readonly box: SecretBox,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
  ) {}

  start(): void {
    const run = (): void => {
      this.refreshAll().catch((err: unknown) => this.log.warn({ err: String(err) }, 'calendar refresh failed'));
    };
    run();
    this.timer = setInterval(run, REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  listSources(userId: string): Array<{ id: string; name: string; color: string; ok: boolean | null; error: string | null; fetchedAt: string | null }> {
    const rows = this.db
      .prepare(`SELECT id, user_id, name, color, url_enc, created_at FROM calendar_sources WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at`)
      .all(userId) as CalendarSourceRow[];
    return rows.map((r) => {
      const c = this.cache.get(r.id);
      return {
        id: r.id,
        name: r.name,
        color: r.color,
        ok: c ? c.ok : null,
        error: c?.error ?? null,
        fetchedAt: c ? new Date(c.fetchedAt).toISOString() : null,
      };
    });
  }

  async addSource(userId: string, input: z.infer<typeof calendarSourceInput>): Promise<{ id: string }> {
    const count = (this.db.prepare(`SELECT COUNT(*) AS n FROM calendar_sources WHERE user_id = ? AND deleted_at IS NULL`).get(userId) as { n: number }).n;
    if (count >= 12) throw new Error('too_many_calendars');
    const id = randomUUID();
    const row: CalendarSourceRow = {
      id,
      user_id: userId,
      name: input.name,
      color: input.color,
      url_enc: this.box.seal(input.url),
      created_at: new Date().toISOString(),
    };
    this.db
      .prepare(`INSERT INTO calendar_sources (id, user_id, name, color, url_enc, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.user_id, row.name, row.color, row.url_enc, row.created_at);
    await this.refreshSource(row);
    this.bus.emit('calendar', { userId });
    return { id };
  }

  updateSource(userId: string, id: string, patch: { name?: string | undefined; color?: string | undefined }): boolean {
    const res = this.db
      .prepare(
        `UPDATE calendar_sources SET name = COALESCE(?, name), color = COALESCE(?, color)
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      )
      .run(patch.name ?? null, patch.color ?? null, id, userId);
    if (res.changes > 0) this.bus.emit('calendar', { userId });
    return res.changes > 0;
  }

  removeSource(userId: string, id: string): boolean {
    const res = this.db
      .prepare(`UPDATE calendar_sources SET deleted_at = ?, url_enc = '' WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
      .run(new Date().toISOString(), id, userId);
    this.cache.delete(id);
    if (res.changes > 0) this.bus.emit('calendar', { userId });
    return res.changes > 0;
  }

  private async refreshAll(): Promise<void> {
    const rows = this.db
      .prepare(`SELECT id, user_id, name, color, url_enc, created_at FROM calendar_sources WHERE deleted_at IS NULL`)
      .all() as CalendarSourceRow[];
    const touched = new Set<string>();
    for (const row of rows) {
      await this.refreshSource(row);
      touched.add(row.user_id);
    }
    for (const userId of touched) this.bus.emit('calendar', { userId });
  }

  private async refreshSource(row: CalendarSourceRow): Promise<void> {
    const prev = this.cache.get(row.id);
    try {
      const url = this.box.open(row.url_enc);
      if (!GOOGLE_ICAL_RE.test(url)) throw new Error('stored URL no longer valid');
      const res = await safeFetch(url, { allowHosts: ALLOWED_HOSTS, timeoutMs: 10_000, maxBytes: MAX_ICS_BYTES, headers: { accept: 'text/calendar' } });
      const events = ical.sync.parseICS(res.bodyText);
      this.cache.set(row.id, { fetchedAt: Date.now(), ok: true, error: null, events });
    } catch (err) {
      // Never log the URL itself (it is a secret).
      const message = err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, '[url]') : 'fetch failed';
      this.log.warn({ sourceId: row.id, err: message }, 'calendar source refresh failed');
      this.cache.set(row.id, { fetchedAt: Date.now(), ok: false, error: message, events: prev?.events ?? {} });
    }
  }

  /** Expanded events for a user between two dates (YYYY-MM-DD, end exclusive). */
  events(userId: string, fromYmd: string, toYmd: string): CalendarEvent[] {
    const from = new Date(`${fromYmd}T00:00:00`);
    const to = new Date(`${toYmd}T00:00:00`);
    if (!(to > from) || (to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
      throw new Error('invalid_range');
    }
    const sources = this.db
      .prepare(`SELECT id, color FROM calendar_sources WHERE user_id = ? AND deleted_at IS NULL`)
      .all(userId) as Array<{ id: string; color: string }>;

    const out: CalendarEvent[] = [];
    for (const src of sources) {
      const cached = this.cache.get(src.id);
      if (!cached) continue;
      for (const [key, comp] of Object.entries(cached.events)) {
        if (key === 'vcalendar' || typeof comp !== 'object' || (comp as { type?: string }).type !== 'VEVENT') continue;
        this.expand(comp as VEvent, src.id, src.color, from, to, out);
      }
    }
    out.push(...this.workoutEvents(userId, fromYmd, toYmd));
    out.sort((a, b) => (a.start === b.start ? Number(b.allDay) - Number(a.allDay) : a.start < b.start ? -1 : 1));
    return out.slice(0, 2_000);
  }

  private expand(ev: VEvent, sourceId: string, color: string, from: Date, to: Date, out: CalendarEvent[]): void {
    if (ev.status === 'CANCELLED') return;
    // node-ical expands RRULEs with EXDATE exclusions, RECURRENCE-ID overrides
    // and time zones; `expandOngoing` keeps multi-day events that began earlier.
    const instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true }).slice(0, 500);
    for (const inst of instances) {
      if (inst.event.status === 'CANCELLED') continue;
      const s = inst.start as Date;
      const e = (inst.end as Date | undefined) ?? new Date(s.getTime() + (inst.isFullDay ? 86_400_000 : 0));
      if (e <= from || s >= to) continue;
      out.push({
        id: `${sourceId}:${ev.uid}:${s.toISOString()}`,
        sourceId,
        title: eventTitle(inst.summary),
        allDay: inst.isFullDay,
        start: inst.isFullDay ? ymdLocal(s) : s.toISOString(),
        end: inst.isFullDay ? ymdLocal(e > s ? e : new Date(s.getTime() + 86_400_000)) : e.toISOString(),
        color,
      });
    }
  }

  /** HomeBase workout logs shown as all-day events. */
  private workoutEvents(userId: string, fromYmd: string, toYmd: string): CalendarEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, payload FROM items
         WHERE collection = 'workout_logs' AND owner_id = ? AND deleted_at IS NULL`,
      )
      .all(userId) as Array<{ id: string; payload: string }>;
    const out: CalendarEvent[] = [];
    for (const r of rows) {
      const p = z.object({ date: z.string(), dayType: z.string() }).safeParse(JSON.parse(r.payload));
      if (!p.success || p.data.date < fromYmd || p.data.date >= toYmd) continue;
      const next = new Date(`${p.data.date}T00:00:00`);
      next.setDate(next.getDate() + 1);
      out.push({
        id: `${WORKOUT_SOURCE_ID}:${r.id}`,
        sourceId: WORKOUT_SOURCE_ID,
        title: p.data.dayType,
        allDay: true,
        start: p.data.date,
        end: ymdLocal(next),
        color: WORKOUT_COLOR,
      });
    }
    return out;
  }
}
