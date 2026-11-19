import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import { safeFetchJson } from '../security/safeFetch.js';
import type { HouseSettingsService } from './houseSettings.js';

/**
 * Govee room sensors (temperature and humidity), heard over Bluetooth by a
 * small listener (govee/listener.py): the bundled one next to the hub
 * (GOVEE_URL) and any extra ones on the home network (Settings → House).
 * The hub asks each listener for its latest readings once a minute, keeps
 * the current values per sensor and 5-minute averages for 30 days.
 *
 * Sensors appear in Settings → House as soon as they're heard; they show on
 * Home only once switched on there (so a neighbour's sensor never does).
 */

const POLL_MS = 60_000;
const BUCKET_S = 300;
const KEEP_DAYS = 31;
/** A listener's reading older than this is ignored. */
const MAX_READING_AGE_S = 15 * 60;
/** Sensors never switched on and not heard for a week are forgotten. */
const FORGET_UNSHOWN_MS = 7 * 86_400_000;

const sensorSchema = z.object({
  address: z.string().length(17).refine((v) => v.split(':').every((p) => /^[0-9A-Fa-f]{2}$/.test(p)) && v.split(':').length === 6, 'not a Bluetooth address'),
  model: z.string().max(24).nullable().optional(),
  name: z.string().max(60).optional(),
  temperatureC: z.number().min(-60).max(100).nullable().optional(),
  humidity: z.number().min(0).max(100).nullable().optional(),
  battery: z.number().int().min(0).max(100).nullable().optional(),
  rssi: z.number().int().min(-127).max(20).nullable().optional(),
  seenAt: z.number().positive(),
});
const listenerSchema = z.object({
  scanning: z.boolean().optional(),
  adapter: z.string().max(40).nullable().optional(),
  error: z.string().max(200).nullable().optional(),
  sensors: z.array(z.unknown()).max(200),
});

export type RangeName = '24h' | '7d' | '30d';
const RANGE: Record<RangeName, { seconds: number; step: number }> = {
  '24h': { seconds: 86_400, step: BUCKET_S },
  '7d': { seconds: 7 * 86_400, step: 3_600 },
  '30d': { seconds: 30 * 86_400, step: 4 * 3_600 },
};

export interface RoomSensor {
  address: string;
  model: string | null;
  bleName: string;
  name: string;
  shown: boolean;
  position: number;
  firstSeenAt: string;
  lastSeenAt: string;
  tempC: number | null;
  humidity: number | null;
  battery: number | null;
  rssi: number | null;
  /** Not heard for longer than the alert setting allows. */
  stale: boolean;
  /** Which listener heard it best. */
  heardBy: string | null;
}

export interface RoomSummary extends RoomSensor {
  /** Hourly average temperatures for the last 24 h (oldest first, null = no data). */
  spark: Array<number | null>;
}

export interface ListenerStatus {
  label: string;
  bundled: boolean;
  ok: boolean;
  scanning: boolean | null;
  adapter: string | null;
  error: string | null;
  lastOkAt: string | null;
  heard: number;
}

interface Row {
  address: string;
  model: string | null;
  ble_name: string;
  name: string;
  shown: number;
  position: number;
  first_seen_at: string;
  last_seen_at: string;
  temp_c: number | null;
  humidity: number | null;
  battery: number | null;
  rssi: number | null;
}

type Reading = z.infer<typeof sensorSchema> & { heardBy: string };

export class RoomsService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly status = new Map<string, ListenerStatus>();
  private readonly heardBy = new Map<string, string>();
  /** Running 5-minute averages: address → bucket sums. */
  private readonly acc = new Map<string, { bucket: number; t: number; tn: number; h: number; hn: number }>();
  private lastPrune = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly db: DB,
    private readonly settings: HouseSettingsService,
    /** The bundled listener (docker network), or '' when not set up. */
    private readonly bundledUrl: string,
    private readonly log?: FastifyBaseLogger,
    private readonly fetchJson: (url: string, bundled: boolean) => Promise<unknown> = defaultFetch,
  ) {
    settings.onChange(() => {
      this.syncStatus();
      if (this.running) this.schedule(0);
    });
    this.syncStatus();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Every listener to ask: the bundled one first. */
  private targets(): Array<{ url: string; bundled: boolean }> {
    return [...(this.bundledUrl ? [{ url: this.bundledUrl, bundled: true }] : []), ...this.settings.values.listeners.map((url) => ({ url, bundled: false }))];
  }

  private syncStatus(): void {
    const keep = new Set(this.targets().map((t) => t.url));
    for (const k of this.status.keys()) if (!keep.has(k)) this.status.delete(k);
    for (const t of this.targets()) {
      if (!this.status.has(t.url)) {
        let label = t.url;
        try {
          label = t.bundled ? 'This server' : new URL(t.url).host;
        } catch {
          // keep the raw address
        }
        this.status.set(t.url, { label, bundled: t.bundled, ok: false, scanning: null, adapter: null, error: null, lastOkAt: null, heard: 0 });
      }
    }
  }

  get enabled(): boolean {
    return this.targets().length > 0;
  }

  async pollOnce(now = Date.now()): Promise<void> {
    const best = new Map<string, Reading>();
    await Promise.all(
      this.targets().map(async (t) => {
        const st = this.status.get(t.url);
        try {
          const body = listenerSchema.parse(await this.fetchJson(t.url, t.bundled));
          let heard = 0;
          for (const raw of body.sensors) {
            const s = sensorSchema.safeParse(raw);
            if (!s.success || now / 1000 - s.data.seenAt > MAX_READING_AGE_S) continue;
            heard += 1;
            const address = s.data.address.toUpperCase();
            const prev = best.get(address);
            // The listener that heard it most recently wins; a stronger signal breaks ties.
            if (!prev || s.data.seenAt > prev.seenAt + 30 || (Math.abs(s.data.seenAt - prev.seenAt) <= 30 && (s.data.rssi ?? -127) > (prev.rssi ?? -127))) {
              best.set(address, { ...s.data, address, heardBy: st?.label ?? t.url });
            }
          }
          if (st) Object.assign(st, { ok: true, scanning: body.scanning ?? null, adapter: body.adapter ?? null, error: body.error ?? null, lastOkAt: new Date(now).toISOString(), heard });
        } catch (err) {
          if (st) Object.assign(st, { ok: false, error: err instanceof z.ZodError ? 'The listener’s answer wasn’t understood' : 'The listener can’t be reached' });
        }
      }),
    );
    this.store([...best.values()], now);
    if (now - this.lastPrune > 3_600_000) this.prune(now);
    this.changed();
  }

  private store(readings: Reading[], now: number): void {
    const upsert = this.db.prepare(
      `INSERT INTO room_sensors (address, model, ble_name, first_seen_at, last_seen_at, temp_c, humidity, battery, rssi)
       VALUES (@address, @model, @bleName, @seen, @seen, @temp, @hum, @battery, @rssi)
       ON CONFLICT(address) DO UPDATE SET
         model = COALESCE(excluded.model, room_sensors.model),
         ble_name = CASE WHEN excluded.ble_name <> '' THEN excluded.ble_name ELSE room_sensors.ble_name END,
         last_seen_at = excluded.last_seen_at,
         temp_c = COALESCE(excluded.temp_c, room_sensors.temp_c),
         humidity = COALESCE(excluded.humidity, room_sensors.humidity),
         battery = COALESCE(excluded.battery, room_sensors.battery),
         rssi = COALESCE(excluded.rssi, room_sensors.rssi)`,
    );
    const sample = this.db.prepare(
      `INSERT INTO room_samples (address, bucket, temp_c, humidity) VALUES (?, ?, ?, ?)
       ON CONFLICT(address, bucket) DO UPDATE SET temp_c = excluded.temp_c, humidity = excluded.humidity`,
    );
    const tx = this.db.transaction(() => {
      for (const r of readings) {
        const seen = new Date(Math.min(r.seenAt * 1000, now)).toISOString();
        upsert.run({
          address: r.address,
          model: r.model ?? null,
          bleName: (r.name ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, 40),
          seen,
          temp: r.temperatureC ?? null,
          hum: r.humidity ?? null,
          battery: r.battery ?? null,
          rssi: r.rssi ?? null,
        });
        this.heardBy.set(r.address, r.heardBy);
        const bucket = Math.floor(r.seenAt / BUCKET_S) * BUCKET_S;
        let a = this.acc.get(r.address);
        if (!a || a.bucket !== bucket) {
          a = { bucket, t: 0, tn: 0, h: 0, hn: 0 };
          this.acc.set(r.address, a);
        }
        if (r.temperatureC !== null && r.temperatureC !== undefined) {
          a.t += r.temperatureC;
          a.tn += 1;
        }
        if (r.humidity !== null && r.humidity !== undefined) {
          a.h += r.humidity;
          a.hn += 1;
        }
        if (a.tn > 0 || a.hn > 0) sample.run(r.address, bucket, a.tn ? Math.round((a.t / a.tn) * 100) / 100 : null, a.hn ? Math.round((a.h / a.hn) * 10) / 10 : null);
      }
    });
    tx();
  }

  private prune(now: number): void {
    this.lastPrune = now;
    this.db.prepare(`DELETE FROM room_samples WHERE bucket < ?`).run(Math.floor(now / 1000) - KEEP_DAYS * 86_400);
    this.db.prepare(`DELETE FROM room_sensors WHERE shown = 0 AND last_seen_at < ?`).run(new Date(now - FORGET_UNSHOWN_MS).toISOString());
  }

  private toSensor(r: Row, now: number): RoomSensor {
    const staleMs = this.settings.values.alerts.sensorStaleMin * 60_000;
    return {
      address: r.address,
      model: r.model,
      bleName: r.ble_name,
      name: r.name,
      shown: r.shown === 1,
      position: r.position,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      tempC: r.temp_c,
      humidity: r.humidity,
      battery: r.battery,
      rssi: r.rssi,
      stale: now - Date.parse(r.last_seen_at) > staleMs,
      heardBy: this.heardBy.get(r.address) ?? null,
    };
  }

  /** Every sensor heard, for Settings → House. */
  all(now = Date.now()): RoomSensor[] {
    const rows = this.db.prepare(`SELECT * FROM room_sensors ORDER BY shown DESC, position, name, address`).all() as Row[];
    return rows.map((r) => this.toSensor(r, now));
  }

  /** The sensors switched on, with a 24-hour sparkline, for Home. */
  summary(now = Date.now()): RoomSummary[] {
    const rows = this.db.prepare(`SELECT * FROM room_sensors WHERE shown = 1 ORDER BY position, name, address`).all() as Row[];
    if (rows.length === 0) return [];
    const since = Math.floor(now / 1000) - 86_400;
    const hours = this.db
      // CAST: the driver binds JS numbers as REAL, which would make this a fraction.
      .prepare(`SELECT address, CAST((bucket - ?) / 3600 AS INTEGER) AS h, AVG(temp_c) AS t FROM room_samples WHERE bucket >= ? GROUP BY address, h`)
      .all(since, since) as Array<{ address: string; h: number; t: number | null }>;
    return rows.map((r) => {
      const spark: Array<number | null> = Array.from({ length: 24 }, () => null);
      for (const p of hours) if (p.address === r.address && p.h >= 0 && p.h < 24) spark[p.h] = p.t === null ? null : Math.round(p.t * 10) / 10;
      return { ...this.toSensor(r, now), spark };
    });
  }

  /** Temperature and humidity over a range, for the House tab's charts. */
  history(range: RangeName, now = Date.now()): Record<string, Array<{ t: number; tempC: number | null; humidity: number | null }>> {
    const { seconds, step } = RANGE[range];
    const since = Math.floor(now / 1000) - seconds;
    const rows = this.db
      .prepare(
        `SELECT s.address, CAST(s.bucket / ? AS INTEGER) * ? AS b, AVG(s.temp_c) AS t, AVG(s.humidity) AS h
         FROM room_samples s JOIN room_sensors r ON r.address = s.address
         WHERE r.shown = 1 AND s.bucket >= ? GROUP BY s.address, b ORDER BY b`,
      )
      .all(step, step, since) as Array<{ address: string; b: number; t: number | null; h: number | null }>;
    const out: Record<string, Array<{ t: number; tempC: number | null; humidity: number | null }>> = {};
    for (const r of rows) {
      (out[r.address] ??= []).push({ t: r.b * 1000, tempC: r.t === null ? null : Math.round(r.t * 10) / 10, humidity: r.h === null ? null : Math.round(r.h) });
    }
    return out;
  }

  /** Rename, switch on/off, or reorder a sensor. */
  update(address: string, patch: { name?: string | undefined; shown?: boolean | undefined; position?: number | undefined }): boolean {
    const r = this.db
      .prepare(
        `UPDATE room_sensors SET
           name = COALESCE(@name, name),
           shown = COALESCE(@shown, shown),
           position = COALESCE(@position, position)
         WHERE address = @address`,
      )
      .run({ address, name: patch.name ?? null, shown: patch.shown === undefined ? null : Number(patch.shown), position: patch.position ?? null });
    if (r.changes > 0) this.changed();
    return r.changes > 0;
  }

  /** Forget a sensor and its history (it reappears, switched off, if heard again). */
  forget(address: string): boolean {
    const r = this.db.prepare(`DELETE FROM room_sensors WHERE address = ?`).run(address);
    this.acc.delete(address);
    if (r.changes > 0) this.changed();
    return r.changes > 0;
  }

  listenerStatus(): ListenerStatus[] {
    return [...this.status.values()];
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.enabled) return;
    this.timer = setTimeout(() => {
      void this.pollOnce()
        .catch((err: unknown) => this.log?.warn({ err }, 'room sensor poll failed'))
        .finally(() => {
          if (this.running) this.schedule(POLL_MS);
        });
    }, ms);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(2_000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

async function defaultFetch(url: string, bundled: boolean): Promise<unknown> {
  const host = new URL(url).hostname;
  return safeFetchJson(`${url}/readings`, {
    allowHosts: [host],
    allowHttp: true,
    // The bundled listener is a container on the hub's private Docker network;
    // the others must be on the home network.
    ...(bundled ? { allowPrivate: true } : { lanOnly: true }),
    timeoutMs: 5_000,
    maxBytes: 256 * 1024,
  });
}
