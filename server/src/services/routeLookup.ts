import { z } from 'zod';
import type { Env } from '../env.js';
import { settingsFromEnv, type SettingsView } from './hubSettings.js';
import { safeFetchJson, FetchError } from '../security/safeFetch.js';

/**
 * Free route / airframe lookups from adsbdb.com for planes tapped on the radar.
 * Only called on demand, results (including misses) cached for 6 hours.
 */
const HOST = 'api.adsbdb.com';
const TTL_MS = 6 * 3_600_000;
const MAX_CACHE = 2_000;

export const CALLSIGN_RE = /^[A-Z0-9]{2,8}$/;
export const HEX_RE = /^[0-9a-f]{6}$/;

const airportSchema = z.looseObject({
  iata_code: z.string().nullish(),
  icao_code: z.string().nullish(),
  name: z.string().nullish(),
  municipality: z.string().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
});

const routeSchema = z.looseObject({
  response: z.looseObject({
    flightroute: z.looseObject({
      airline: z.looseObject({ name: z.string().nullish(), icao: z.string().nullish(), iata: z.string().nullish() }).nullish(),
      origin: airportSchema,
      destination: airportSchema,
    }),
  }),
});

const aircraftSchema = z.looseObject({
  response: z.looseObject({
    aircraft: z.looseObject({
      type: z.string().nullish(),
      icao_type: z.string().nullish(),
      manufacturer: z.string().nullish(),
      registration: z.string().nullish(),
      registered_owner: z.string().nullish(),
    }),
  }),
});

export interface RouteInfo {
  airline: { name: string; icao: string; iata: string } | null;
  origin: { code: string; name: string; city: string; lat: number | null; lon: number | null };
  destination: { code: string; name: string; city: string; lat: number | null; lon: number | null };
}

export interface AirframeInfo {
  type: string;
  icaoType: string;
  manufacturer: string;
  registration: string;
  owner: string;
}

class TtlCache<T> {
  private map = new Map<string, { at: number; value: T }>();
  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > TTL_MS) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: T): void {
    if (this.map.size >= MAX_CACHE) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { at: Date.now(), value });
  }
}

const airport = (a: z.infer<typeof airportSchema>): RouteInfo['origin'] => ({
  code: a.iata_code ?? a.icao_code ?? '',
  name: a.name ?? '',
  city: a.municipality ?? '',
  lat: a.latitude ?? null,
  lon: a.longitude ?? null,
});

export class RouteLookupService {
  private routes = new TtlCache<RouteInfo | null>();
  private airframes = new TtlCache<AirframeInfo | null>();

  private readonly settings: SettingsView;

  constructor(env: Env, settings?: SettingsView) {
    this.settings = settings ?? settingsFromEnv(env);
  }

  private fetch(path: string): Promise<unknown> {
    const c = this.settings().adsbContact;
    const contact = c ? ` (+${c})` : '';
    return safeFetchJson(`https://${HOST}${path}`, {
      allowHosts: [HOST],
      timeoutMs: 6_000,
      maxBytes: 256 * 1024,
      headers: { 'user-agent': `HomeBaseHub/2.0 personal home display${contact}` },
    });
  }

  async route(callsign: string): Promise<RouteInfo | null> {
    if (!CALLSIGN_RE.test(callsign)) return null;
    const cached = this.routes.get(callsign);
    if (cached !== undefined) return cached;
    let value: RouteInfo | null = null;
    try {
      const parsed = routeSchema.safeParse(await this.fetch(`/v0/callsign/${callsign}`));
      if (parsed.success) {
        const fr = parsed.data.response.flightroute;
        value = {
          airline: fr.airline ? { name: fr.airline.name ?? '', icao: fr.airline.icao ?? '', iata: fr.airline.iata ?? '' } : null,
          origin: airport(fr.origin),
          destination: airport(fr.destination),
        };
      }
    } catch (err) {
      // 404 = unknown callsign: cache the miss. Other errors: don't cache.
      if (!(err instanceof FetchError && err.status === 404)) throw err;
    }
    this.routes.set(callsign, value);
    return value;
  }

  async airframe(hex: string): Promise<AirframeInfo | null> {
    if (!HEX_RE.test(hex)) return null;
    const cached = this.airframes.get(hex);
    if (cached !== undefined) return cached;
    let value: AirframeInfo | null = null;
    try {
      const parsed = aircraftSchema.safeParse(await this.fetch(`/v0/aircraft/${hex}`));
      if (parsed.success) {
        const a = parsed.data.response.aircraft;
        value = {
          type: a.type ?? '',
          icaoType: a.icao_type ?? '',
          manufacturer: a.manufacturer ?? '',
          registration: a.registration ?? '',
          owner: a.registered_owner ?? '',
        };
      }
    } catch (err) {
      if (!(err instanceof FetchError && err.status === 404)) throw err;
    }
    this.airframes.set(hex, value);
    return value;
  }
}
