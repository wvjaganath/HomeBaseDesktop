import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { Env } from '../env.js';
import type { EventBus } from '../events.js';
import { bearingDeg, cardinal, haversineMiles, milesTo } from '../lib/geo.js';
import { FetchError, safeFetchJson } from '../security/safeFetch.js';
import { HomeLocation, type Zone } from './home.js';
import { settingsFromEnv, type SettingsView } from './hubSettings.js';

/**
 * Live aircraft around home from the free community ADS-B feeds.
 * adsb.lol is primary (the tracker already uses it); adsb.fi is the fallback.
 * Both are personal / non-commercial use only and must be credited in the UI.
 *
 * Polling is demand-driven: it runs only while a screen has asked for radar
 * data in the last two minutes, so an idle hub makes no requests.
 */
const RATE_LIMIT_PAUSE_MS = 10 * 60_000;
const PROVIDERS = [
  { name: 'adsb.lol', host: 'api.adsb.lol', url: (lat: number, lon: number, nm: number) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}` },
  { name: 'adsb.fi', host: 'opendata.adsb.fi', url: (lat: number, lon: number, nm: number) => `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${nm}` },
] as const;

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
  /** Why it's off: RADAR_ENABLED=false, or no home location yet. */
  off: 'disabled' | 'no_home' | null;
  source: string | null;
  updatedAt: string | null;
  home: { lat: number; lon: number };
  radiusNm: number;
  /** When set, only planes inside the plane tracker's box are fetched and shown. */
  area: Zone | null;
  units: 'imperial' | 'metric';
  aircraft: RadarAircraft[];
}

/** The smallest circle around a box (centre and radius in nautical miles), for the feeds' lat/lon/dist query. */
export function circleAround(z: Zone): { lat: number; lon: number; nm: number } {
  const lat = (z.top + z.bottom) / 2;
  const lon = (z.left + z.right) / 2;
  const miles = Math.max(haversineMiles(lat, lon, z.top, z.left), haversineMiles(lat, lon, z.bottom, z.right));
  return { lat, lon, nm: Math.min(100, Math.max(1, Math.ceil(miles / 1.150779 + 0.5))) };
}

export class RadarService {
  private snapshotData: RadarSnapshot;
  private version = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastDemand = 0;
  private trails = new Map<string, Array<{ lat: number; lon: number; t: number }>>();
  private pausedUntil = new Map<string, number>();

  private readonly settings: SettingsView;
  private readonly homeLoc: HomeLocation;

  constructor(
    env: Env,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
    homeLoc?: HomeLocation,
    settings?: SettingsView,
  ) {
    this.settings = settings ?? settingsFromEnv(env);
    this.homeLoc = homeLoc ?? new HomeLocation(env, undefined, this.settings);
    this.snapshotData = { ...this.state(), source: null, updatedAt: null, aircraft: [] };
  }

  /** Enabled / home / range / units as the settings say right now. */
  private state(): Pick<RadarSnapshot, 'enabled' | 'off' | 'home' | 'radiusNm' | 'area' | 'units'> {
    const s = this.settings();
    const home = this.homeLoc.get();
    return {
      enabled: s.radarEnabled && home !== null,
      off: !s.radarEnabled ? 'disabled' : home ? null : 'no_home',
      home: home ?? { lat: 0, lon: 0 },
      radiusNm: s.radarRadiusNm,
      area: s.radarArea === 'box' ? this.homeLoc.zone : null,
      units: this.homeLoc.units,
    };
  }

  /** Settings or home changed: take them on, and drop data from the old area. */
  reconfigure(): void {
    const next = this.state();
    const prev = this.snapshotData;
    const moved =
      next.home.lat !== prev.home.lat ||
      next.home.lon !== prev.home.lon ||
      next.radiusNm !== prev.radiusNm ||
      next.units !== prev.units ||
      JSON.stringify(next.area) !== JSON.stringify(prev.area);
    if (!moved && next.enabled === prev.enabled) return;
    if (moved) this.trails.clear();
    this.snapshotData = { ...prev, ...next, ...(moved || !next.enabled ? { aircraft: [], updatedAt: null, source: null } : {}) };
    if (!next.enabled) this.stop();
    this.version += 1;
    this.bus.emit('radar', { version: this.version });
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
    // Home can arrive later, from the plane tracker's settings.
    this.homeLoc.onChange(() => this.reconfigure());
    if (!this.settings().radarEnabled) this.log.info('radar: turned off in Settings');
    else if (!this.snapshotData.enabled) this.log.info('radar: waiting for a home location (Settings → Plane tracker → Location)');
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private startLoop(): void {
    // One request per interval (Settings → Hub, 15 s by default), the next one
    // only after the last has finished.
    const tick = (): void => {
      if (Date.now() - this.lastDemand > DEMAND_WINDOW_MS) {
        this.timer = null;
        return;
      }
      void this.poll()
        .catch((err: unknown) => this.log.debug({ err: String(err) }, 'radar poll failed'))
        .finally(() => {
          if (this.timer !== null) this.timer = setTimeout(tick, this.settings().radarPollSec * 1000);
        });
    };
    this.timer = setTimeout(tick, 0);
  }

  private userAgent(): string {
    const c = this.settings().adsbContact;
    const contact = c ? ` (+${c})` : '';
    return `HomeBaseHub/2.0 personal home display${contact}`;
  }

  private async poll(): Promise<void> {
    const home = this.homeLoc.get();
    if (!home || !this.snapshotData.enabled) return;
    // Box mode: just the circle around the plane tracker's box. Otherwise the range around home.
    const area = this.snapshotData.area;
    const q = area ? circleAround(area) : { lat: home.lat, lon: home.lon, nm: this.snapshotData.radiusNm };
    const lat = Number(q.lat.toFixed(4));
    const lon = Number(q.lon.toFixed(4));
    let lastErr: unknown = null;
    const now = Date.now();
    for (const p of PROVIDERS) {
      // A provider that said "too many requests" is left alone for a while, so this
      // hub doesn't keep the home's address over its limit (the plane tracker uses
      // adsb.lol from the same address and would be refused too).
      if ((this.pausedUntil.get(p.name) ?? 0) > now) continue;
      try {
        const raw = await safeFetchJson(p.url(lat, lon, q.nm), {
          allowHosts: [p.host],
          timeoutMs: 6_000,
          maxBytes: 4 * 1024 * 1024,
          headers: { 'user-agent': this.userAgent() },
        });
        this.ingest(raw, p.name);
        return;
      } catch (err) {
        lastErr = err;
        if (err instanceof FetchError && err.status === 429) {
          this.pausedUntil.set(p.name, now + RATE_LIMIT_PAUSE_MS);
          this.log.info({ provider: p.name }, `radar: ${p.name} says too many requests; pausing it for 10 minutes`);
        }
      }
    }
    if (lastErr === null) return; // every provider is paused: wait
    throw lastErr instanceof Error ? lastErr : new Error('all ADS-B providers failed');
  }

  private ingest(raw: unknown, source: string): void {
    const home = this.homeLoc.get() ?? this.snapshotData.home;
    const parsed = responseSchema.parse(raw);
    const list = parsed.ac ?? parsed.aircraft ?? [];
    const now = Date.now();
    const seen = new Set<string>();
    const aircraft: RadarAircraft[] = [];

    for (const item of list.slice(0, 500)) {
      const r = acSchema.safeParse(item);
      if (!r.success) continue;
      const a = r.data;
      const { lat, lon } = a;
      if (lat === undefined || lon === undefined) continue;
      if (a.seen_pos !== undefined && a.seen_pos > 60) continue;
      const area = this.snapshotData.area;
      if (area && !(lat <= area.top && lat >= area.bottom && lon >= area.left && lon <= area.right)) continue;
      const hex = a.hex.replace('~', '').toLowerCase();
      seen.add(hex);

      const trail = this.trails.get(hex) ?? [];
      const last = trail.at(-1);
      if (!last || last.lat !== lat || last.lon !== lon) trail.push({ lat, lon, t: now });
      while (trail.length > 0 && now - (trail[0]?.t ?? now) > TRAIL_MS) trail.shift();
      this.trails.set(hex, trail);

      const miles = haversineMiles(home.lat, home.lon, lat, lon);
      aircraft.push({
        hex,
        callsign: (a.flight ?? '').trim().toUpperCase(),
        registration: (a.r ?? '').trim().toUpperCase(),
        type: (a.t ?? '').trim().toUpperCase(),
        category: a.category ?? '',
        lat,
        lon,
        altitudeFt: a.alt_baro === 'ground' ? null : (a.alt_baro ?? a.alt_geom ?? null),
        groundSpeedKt: a.gs ?? null,
        trackDeg: a.track ?? a.true_heading ?? null,
        verticalFpm: a.baro_rate ?? a.geom_rate ?? null,
        squawk: a.squawk ?? '',
        distance: Math.round(milesTo(this.snapshotData.units, miles) * 10) / 10,
        direction: cardinal(bearingDeg(home.lat, home.lon, lat, lon)),
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
