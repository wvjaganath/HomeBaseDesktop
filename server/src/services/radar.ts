import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { Env } from '../env.js';
import type { EventBus } from '../events.js';
import { bearingDeg, cardinal, haversineMiles, milesTo } from '../lib/geo.js';
import { safeFetchJson } from '../security/safeFetch.js';

/**
 * Live aircraft around home from the free community ADS-B feeds.
 * adsb.lol is primary (the tracker already uses it); adsb.fi is the fallback.
 * Both are personal / non-commercial use only and must be credited in the UI.
 *
 * Polling is demand-driven: it runs only while a screen has asked for radar
 * data in the last two minutes, so an idle hub makes no requests.
 */
const PROVIDERS = [
  { name: 'adsb.lol', host: 'api.adsb.lol', url: (lat: number, lon: number, nm: number) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}` },
  { name: 'adsb.fi', host: 'opendata.adsb.fi', url: (lat: number, lon: number, nm: number) => `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${nm}` },
] as const;

const POLL_MS = 5_000;
const DEMAND_WINDOW_MS = 120_000;
const TRAIL_MS = 3 * 60_000;
const STALE_MS = 60_000;

const acSchema = z.looseObject({
  hex: z.string().regex(/^~?[0-9a-fA-F]{6}$/),
  flight: z.string().max(12).optional(),
  r: z.string().max(12).optional(),
  t: z.string().max(8).optional(),
  category: z.string().max(4).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  alt_baro: z.union([z.number(), z.literal('ground')]).optional(),
  alt_geom: z.number().optional(),
  gs: z.number().optional(),
  track: z.number().optional(),
  true_heading: z.number().optional(),
  baro_rate: z.number().optional(),
  geom_rate: z.number().optional(),
  squawk: z.string().max(4).optional(),
  seen_pos: z.number().optional(),
});

const responseSchema = z.looseObject({
  ac: z.array(z.unknown()).optional(),
  aircraft: z.array(z.unknown()).optional(),
});

export interface RadarAircraft {
  hex: string;
  callsign: string;
  registration: string;
  type: string;
  category: string;
  lat: number;
  lon: number;
  altitudeFt: number | null; // null = on the ground
  groundSpeedKt: number | null;
  trackDeg: number | null;
  verticalFpm: number | null;
  squawk: string;
  distance: number; // in env.UNITS (mi or km)
  direction: string;
  trail: Array<[number, number]>;
}

export interface RadarSnapshot {
  enabled: boolean;
  source: string | null;
  updatedAt: string | null;
  home: { lat: number; lon: number };
  radiusNm: number;
  units: 'imperial' | 'metric';
  aircraft: RadarAircraft[];
}

export class RadarService {
  private snapshotData: RadarSnapshot;
  private version = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastDemand = 0;
  private trails = new Map<string, Array<{ lat: number; lon: number; t: number }>>();
  private inFlight = false;

  constructor(
    private readonly env: Env,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
  ) {
    this.snapshotData = {
      enabled: env.RADAR_ENABLED && !(env.HOME_LAT === 0 && env.HOME_LON === 0),
      source: null,
      updatedAt: null,
      home: { lat: env.HOME_LAT, lon: env.HOME_LON },
      radiusNm: env.RADAR_RADIUS_NM,
      units: env.UNITS,
      aircraft: [],
    };
  }

  get snapshot(): { version: number; data: RadarSnapshot } {
    return { version: this.version, data: this.snapshotData };
  }

  /** Called whenever a screen reads radar data or holds a stream open. */
  touch(): void {
    this.lastDemand = Date.now();
    if (this.snapshotData.enabled && this.timer === null) this.startLoop();
  }

  start(): void {
    if (!this.snapshotData.enabled) {
      this.log.info('radar: disabled (RADAR_ENABLED=false or HOME_LAT/HOME_LON not set)');
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private startLoop(): void {
    const tick = (): void => {
      if (Date.now() - this.lastDemand > DEMAND_WINDOW_MS) {
        this.stop();
        return;
      }
      if (this.inFlight) return;
      this.inFlight = true;
      this.poll()
        .catch((err: unknown) => this.log.debug({ err: String(err) }, 'radar poll failed'))
        .finally(() => {
          this.inFlight = false;
        });
    };
    tick();
    this.timer = setInterval(tick, POLL_MS);
  }

  private userAgent(): string {
    const contact = this.env.ADSB_CONTACT ? ` (+${this.env.ADSB_CONTACT})` : '';
    return `HomeBaseHub/2.0 personal home display${contact}`;
  }

  private async poll(): Promise<void> {
    const lat = Number(this.env.HOME_LAT.toFixed(4));
    const lon = Number(this.env.HOME_LON.toFixed(4));
    let lastErr: unknown = null;
    for (const p of PROVIDERS) {
      try {
        const raw = await safeFetchJson(p.url(lat, lon, this.env.RADAR_RADIUS_NM), {
          allowHosts: [p.host],
          timeoutMs: 6_000,
          maxBytes: 4 * 1024 * 1024,
          headers: { 'user-agent': this.userAgent() },
        });
        this.ingest(raw, p.name);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('all ADS-B providers failed');
  }

  private ingest(raw: unknown, source: string): void {
    const parsed = responseSchema.parse(raw);
    const list = parsed.ac ?? parsed.aircraft ?? [];
    const now = Date.now();
    const seen = new Set<string>();
    const aircraft: RadarAircraft[] = [];

    for (const item of list.slice(0, 500)) {
      const r = acSchema.safeParse(item);
      if (!r.success || r.data.lat === undefined || r.data.lon === undefined) continue;
      const a = r.data;
      if (a.seen_pos !== undefined && a.seen_pos > 60) continue;
      const hex = a.hex.replace('~', '').toLowerCase();
      seen.add(hex);

      const trail = this.trails.get(hex) ?? [];
      const last = trail.at(-1);
      if (!last || last.lat !== a.lat || last.lon !== a.lon) trail.push({ lat: a.lat, lon: a.lon, t: now });
      while (trail.length > 0 && now - (trail[0]?.t ?? now) > TRAIL_MS) trail.shift();
      this.trails.set(hex, trail);

      const miles = haversineMiles(this.env.HOME_LAT, this.env.HOME_LON, a.lat, a.lon);
      aircraft.push({
        hex,
        callsign: (a.flight ?? '').trim().toUpperCase(),
        registration: (a.r ?? '').trim().toUpperCase(),
        type: (a.t ?? '').trim().toUpperCase(),
        category: a.category ?? '',
        lat: a.lat,
        lon: a.lon,
        altitudeFt: a.alt_baro === 'ground' ? null : (a.alt_baro ?? a.alt_geom ?? null),
        groundSpeedKt: a.gs ?? null,
        trackDeg: a.track ?? a.true_heading ?? null,
        verticalFpm: a.baro_rate ?? a.geom_rate ?? null,
        squawk: a.squawk ?? '',
        distance: Math.round(milesTo(this.env.UNITS, miles) * 10) / 10,
        direction: cardinal(bearingDeg(this.env.HOME_LAT, this.env.HOME_LON, a.lat, a.lon)),
        trail: trail.map((pt) => [Number(pt.lat.toFixed(5)), Number(pt.lon.toFixed(5))] as [number, number]),
      });
    }

    for (const [hex, trail] of this.trails) {
      if (!seen.has(hex) && now - (trail.at(-1)?.t ?? 0) > STALE_MS) this.trails.delete(hex);
    }

    aircraft.sort((x, y) => x.distance - y.distance);
    this.snapshotData = { ...this.snapshotData, source, updatedAt: new Date(now).toISOString(), aircraft };
    this.version += 1;
    this.bus.emit('radar', { version: this.version });
  }
}
