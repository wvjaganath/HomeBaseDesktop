import type { DB } from '../db.js';

/** The outside services the hub itself calls (the plane tracker's own calls are in its API log). */
export const COUNTED_SERVICES = ['adsb.lol', 'adsb.fi', 'adsbdb'] as const;
export type CountedService = (typeof COUNTED_SERVICES)[number];

const KEEP_DAYS = 90;

/** YYYY-MM-DD in the hub's time zone (TZ), like the tracker's log. */
export function localDay(d = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * A count of requests per outside service per day, kept 90 days, so Settings →
 * Status can show what the hub asks of the free feeds.
 */
export class UsageLog {
  private pruned = '';

  constructor(private readonly db: DB) {}

  count(service: CountedService): void {
    const day = localDay();
    this.db
      .prepare(`INSERT INTO outside_requests (day, service, count) VALUES (?, ?, 1) ON CONFLICT(day, service) DO UPDATE SET count = count + 1`)
      .run(day, service);
    if (this.pruned !== day) {
      this.pruned = day;
      const oldest = localDay(new Date(Date.now() - KEEP_DAYS * 86_400_000));
      this.db.prepare(`DELETE FROM outside_requests WHERE day < ?`).run(oldest);
    }
  }

  /** Counts for the last `days` days (today included), by day then service. */
  recent(days: number): Record<string, Partial<Record<CountedService, number>>> {
    const from = localDay(new Date(Date.now() - (days - 1) * 86_400_000));
    const rows = this.db.prepare(`SELECT day, service, count FROM outside_requests WHERE day >= ? ORDER BY day`).all(from) as Array<{
      day: string;
      service: CountedService;
      count: number;
    }>;
    const out: Record<string, Partial<Record<CountedService, number>>> = {};
    for (const r of rows) (out[r.day] ??= {})[r.service] = r.count;
    return out;
  }
}
