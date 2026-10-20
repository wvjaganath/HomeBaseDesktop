import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { Env } from '../env.js';
import type { EventBus } from '../events.js';
import { haversineMiles, milesTo } from '../lib/geo.js';
import { safeFetchJson } from '../security/safeFetch.js';
import { routeFits, type RouteLookupService } from './routeLookup.js';

/**
 * Adapter for the plane-tracker-rgb-pi web UI (Flask on the LED Pi).
 *
 * The hub acts like one of the tracker's "slave" clocks: it only reads the JSON
 * the master already produces, so it spends no API credits. Only the read-only
 * endpoints below are ever requested; the upstream host comes from server
 * config, never from a client.
 */
export const TRACKER_ENDPOINTS = {
  overhead: '/overhead/json',
  tracked: '/tracked/json/live',
  weather: '/weather/json',
  clock: '/clock/json',
  aircraftTypes: '/api/aircraft-types',
  logos: '/logos/', // + <ICAO>.png (ICAO validated by the caller)
  airportCoords: '/api/airport-coords',
} as const;

const num = z.coerce.number();
const optNum = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
});
const optStr = z.union([z.string(), z.null(), z.number()]).optional().transform((v) => (v === null || v === undefined ? '' : String(v)));

const overheadEntrySchema = z.looseObject({
  callsign: optStr,
  icao24: optStr,
  airline: optStr,
  plane: optStr,
  origin: optStr,
  destination: optStr,
  owner_iata: optStr,
  owner_icao: optStr,
  origin_latitude: optNum,
  origin_longitude: optNum,
  destination_latitude: optNum,
  destination_longitude: optNum,
  plane_latitude: optNum,
  plane_longitude: optNum,
  altitude: optNum,
  heading: optNum,
  vertical_speed: optNum,
  ground_speed: optNum,
  distance: optNum,
  direction: optStr,
  distance_origin: optNum,
  distance_destination: optNum,
  time_scheduled_departure: optNum,
  time_scheduled_arrival: optNum,
  time_real_departure: optNum,
  time_estimated_arrival: optNum,
  // HomeBase's tracker patch: more of FR24's flight summary (full).
  fr24: z
    .looseObject({
      flight: optStr,
      registration: optStr,
      runway_takeoff: optStr,
      planned_dest: optStr,
      diverted: z.boolean().optional().catch(false),
      circle_distance: optNum,
    })
    .optional()
    .catch(undefined),
});

const weatherSchema = z.looseObject({
  temperature: optNum,
  humidity: optNum,
  weatherCode: optNum,
  moonPhase: optNum,
  forecast: z
    .array(
      z.looseObject({
        startTime: optStr,
        values: z
          .looseObject({
            temperatureMin: optNum,
            temperatureMax: optNum,
            weatherCodeFullDay: optNum,
            sunriseTime: optStr,
            sunsetTime: optStr,
            moonPhase: optNum,
          })
          .optional(),
      }),
    )
    .catch([]),
});

const alertSchema = z.looseObject({ text: optStr, color: optStr });
const clockSchema = z.looseObject({
  sunrise: optStr,
  sunset: optStr,
  alerts: z.array(alertSchema).catch([]),
});

const trackedSchema = z.looseObject({ callsign: optStr });

export type DelayLevel = 'ontime' | 'minor' | 'moderate' | 'major' | 'severe' | 'extreme' | 'unknown';

export interface Flight {
  callsign: string;
  icao24: string;
  airline: string;
  logoIcao: string;
  flightNumber: string;
  aircraftCode: string;
  aircraftName: string;
  origin: { code: string; name: string; lat: number | null; lon: number | null; distance: number | null; delay: DelayLevel };
  destination: { code: string; name: string; lat: number | null; lon: number | null; distance: number | null; delay: DelayLevel };
  progress: number | null; // 0..1 along the route
  /** Where the route came from: the tracker's lookup (FR24 etc.), adsbdb's schedule data, or nobody. */
  routeSource: 'tracker' | 'schedule' | null;
  /** More from FR24's flight summary, when the tracker's lookup found the flight there. */
  extra: { registration: string; runwayTakeoff: string; diverted: boolean; plannedDestination: string; tripKm: number | null } | null;
  position: { lat: number | null; lon: number | null; altitudeFt: number | null; headingDeg: number | null; verticalFpm: number | null; groundSpeedKt: number | null };
  fromHome: { distance: number | null; direction: string };
  times: { scheduledDeparture: number | null; actualDeparture: number | null; scheduledArrival: number | null; estimatedArrival: number | null };
}

export interface DayForecast {
  date: string;
  min: number | null;
  max: number | null;
  code: number | null;
}

export interface TrackerState {
  enabled: boolean;
  reachable: boolean;
  updatedAt: string | null;
  flights: Flight[];
  tracked: { callsign: string; raw: Record<string, unknown> } | null;
  weather: {
    temperature: number | null;
    humidity: number | null;
    code: number | null;
    moonPhase: number | null;
    forecast: DayForecast[];
  } | null;
  sun: { sunrise: string; sunset: string } | null;
  alerts: Array<{ text: string; level: string }>;
}

/** Departure delay → colour level (same thresholds as the LED tracker). */
export function departureDelayLevel(actual: number | null, scheduled: number | null): DelayLevel {
  if (actual === null || scheduled === null) return 'unknown';
  const m = (actual - scheduled) / 60;
  if (m <= 20) return 'ontime';
  if (m <= 40) return 'minor';
  if (m <= 60) return 'moderate';
  if (m <= 240) return 'major';
  if (m <= 480) return 'severe';
  return 'extreme';
}

/** Arrival delay → colour level (same thresholds as the LED tracker). */
export function arrivalDelayLevel(estimated: number | null, scheduled: number | null): DelayLevel {
  if (estimated === null || scheduled === null) return 'unknown';
  const m = (estimated - scheduled) / 60;
  if (m <= 0) return 'ontime';
  if (m <= 30) return 'minor';
  if (m <= 60) return 'moderate';
  if (m <= 240) return 'major';
  if (m <= 480) return 'severe';
  return 'extreme';
}

const AIRPORT_SUFFIXES = [' international airport', ' intl. airport', ' intl airport', ' regional airport', ' municipal airport', ' airport'];

export function shortAirportName(name: string): string {
  const lower = name.toLowerCase();
  const suffix = AIRPORT_SUFFIXES.find((s) => lower.endsWith(s));
  return (suffix ? name.slice(0, -suffix.length) : name).trim();
}

const CODE_RE = /^[A-Z0-9]{3,4}$/;

export class TrackerService {
  private state: TrackerState;
  private version = 0;
  private timers: NodeJS.Timeout[] = [];
  private aircraftTypes = new Map<string, string>();
  private airportNames = new Map<string, { name: string; lat: number; lon: number } | null>();
  private readonly host: string;
  private lastSerialized = '';
  private stopped = false;

  private polling = false;
  private readonly routes: RouteLookupService | undefined;
  private readonly units: () => 'imperial' | 'metric';

  constructor(
    private readonly env: Env,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
    opts: { routes?: RouteLookupService; units?: () => 'imperial' | 'metric' } = {},
  ) {
    this.routes = opts.routes;
    this.units = opts.units ?? (() => env.UNITS);
    this.host = env.TRACKER_URL ? new URL(env.TRACKER_URL).hostname : '';
    this.state = {
      enabled: env.TRACKER_URL !== '',
      reachable: false,
      updatedAt: null,
      flights: [],
      tracked: null,
      weather: null,
      sun: null,
      alerts: [],
    };
  }

  get snapshot(): { version: number; state: TrackerState } {
    return { version: this.version, state: this.state };
  }

  start(): void {
    if (!this.state.enabled) {
      this.log.info('tracker: TRACKER_URL not set, integration disabled');
      return;
    }
    const every = (ms: number, fn: () => Promise<void>): void => {
      const run = (): void => {
        fn().catch((err: unknown) => this.log.debug({ err }, 'tracker poll failed'));
      };
      run();
      this.timers.push(setInterval(run, ms));
    };
    // Load aircraft type names first so the first flights already carry them.
    void this.loadAircraftTypes()
      .catch((err: unknown) => this.log.debug({ err }, 'tracker aircraft types failed'))
      .finally(() => {
        if (!this.state.enabled || this.stopped) return;
        every(5_000, () => this.pollFlights());
        every(60_000, () => this.pollWeatherAndClock());
        this.timers.push(setInterval(() => void this.loadAircraftTypes().catch(() => undefined), 24 * 3_600_000));
      });
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private get(path: string): Promise<unknown> {
    return safeFetchJson(`${this.env.TRACKER_URL}${path}`, {
      allowHosts: [this.host],
      allowHttp: true,
      allowPrivate: true, // the tracker lives on the LAN by design
      timeoutMs: 6_000,
      maxBytes: 2 * 1024 * 1024,
    });
  }

  private async pollFlights(): Promise<void> {
    // A slow route lookup must not stack polls on top of each other.
    if (this.polling) return;
    this.polling = true;
    try {
      const [overheadRaw, trackedRaw] = await Promise.all([
        this.get(TRACKER_ENDPOINTS.overhead),
        this.get(TRACKER_ENDPOINTS.tracked).catch(() => null),
      ]);
      const entries = z.array(z.unknown()).catch([]).parse(overheadRaw);
      const parsed = entries
        .map((e) => overheadEntrySchema.safeParse(e))
        .filter((r) => r.success)
        .map((r) => r.data);
      await this.ensureAirports(parsed.flatMap((p) => [p.origin, p.destination]));
      const flights = parsed.filter((p) => p.callsign !== '').map((p) => this.normalize(p));
      await this.fillMissingRoutes(flights);

      const trackedParsed = trackedSchema.safeParse(trackedRaw);
      const tracked =
        trackedParsed.success && trackedParsed.data.callsign !== ''
          ? { callsign: trackedParsed.data.callsign, raw: trackedParsed.data as Record<string, unknown> }
          : null;

      this.update({ reachable: true, flights, tracked });
    } catch (err) {
      if (this.state.reachable) this.log.warn({ err: String(err) }, 'tracker unreachable');
      this.update({ reachable: false });
    } finally {
      this.polling = false;
    }
  }

  /**
   * The tracker had no route (its FR24/AirLabs/FlightAware lookup found
   * nothing): use adsbdb's schedule route for the callsign, free and cached,
   * if the plane is plausibly on it. Also fills in the aircraft type.
   */
  private async fillMissingRoutes(flights: Flight[]): Promise<void> {
    const routes = this.routes;
    if (!routes) return;
    const units = this.units();
    await Promise.all(
      flights.map(async (f) => {
        if (!f.aircraftCode && f.icao24) {
          const a = await routes.airframe(f.icao24).catch(() => null);
          if (a?.icaoType) {
            f.aircraftCode = a.icaoType;
            f.aircraftName = this.aircraftTypes.get(a.icaoType) ?? a.type;
          }
        }
        if (f.routeSource !== null || !/^[A-Z]{3}\d/.test(f.callsign)) return;
        const r = await routes.route(f.callsign).catch(() => null);
        if (!r) return;
        // The airline goes with the flight number, so it's right even when the usual route isn't.
        if (!f.airline && r.airline?.name) f.airline = r.airline.name;
        const digits = /\d+[A-Z]?$/.exec(f.callsign)?.[0] ?? '';
        if (!f.flightNumber && r.airline?.iata && digits) f.flightNumber = `${r.airline.iata} ${digits}`;
        const { lat, lon } = f.position;
        if (!r.origin.code || !r.destination.code || lat === null || lon === null) return;
        // Same check as the tracker's: the plane must be roughly between the two airports.
        if (routeFits(r, lat, lon) === false) return;
        const o = r.origin;
        const d = r.destination;
        let dO: number | null = null;
        let dD: number | null = null;
        if (o.lat !== null && o.lon !== null && d.lat !== null && d.lon !== null) {
          dO = Math.round(milesTo(units, haversineMiles(lat, lon, o.lat, o.lon)));
          dD = Math.round(milesTo(units, haversineMiles(lat, lon, d.lat, d.lon)));
        }
        f.origin = { ...f.origin, code: o.code, name: shortAirportName(o.name) || o.city, lat: o.lat, lon: o.lon, distance: dO };
        f.destination = { ...f.destination, code: d.code, name: shortAirportName(d.name) || d.city, lat: d.lat, lon: d.lon, distance: dD };
        f.progress = dO !== null && dD !== null && dO + dD > 0 ? dO / (dO + dD) : null;
        f.routeSource = 'schedule';
      }),
    );
  }

  private async pollWeatherAndClock(): Promise<void> {
    const [weatherRaw, clockRaw] = await Promise.all([
      this.get(TRACKER_ENDPOINTS.weather).catch(() => null),
      this.get(TRACKER_ENDPOINTS.clock).catch(() => null),
    ]);
    const patch: Partial<TrackerState> = {};
    const w = weatherSchema.safeParse(weatherRaw);
    if (w.success) {
      patch.weather = {
        temperature: w.data.temperature,
        humidity: w.data.humidity,
        code: w.data.weatherCode,
        moonPhase: w.data.moonPhase,
        forecast: w.data.forecast
          .map((f) => ({
            date: f.startTime.slice(0, 10),
            min: f.values?.temperatureMin ?? null,
            max: f.values?.temperatureMax ?? null,
            code: f.values?.weatherCodeFullDay ?? null,
          }))
          .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.date)),
      };
    }
    const c = clockSchema.safeParse(clockRaw);
    if (c.success) {
      patch.sun = { sunrise: c.data.sunrise, sunset: c.data.sunset };
      patch.alerts = c.data.alerts
        .filter((a) => a.text !== '')
        .slice(0, 12)
        .map((a) => ({ text: a.text.slice(0, 80), level: ['red', 'orange', 'yellow', 'white'].includes(a.color) ? a.color : 'white' }));
    }
    if (Object.keys(patch).length > 0) this.update(patch);
  }

  private async loadAircraftTypes(): Promise<void> {
    const raw = await this.get(TRACKER_ENDPOINTS.aircraftTypes);
    const parsed = z.record(z.string().max(8), z.string().max(120)).safeParse(raw);
    if (parsed.success) {
      this.aircraftTypes = new Map(Object.entries(parsed.data));
    }
  }

  private async ensureAirports(codes: string[]): Promise<void> {
    const missing = [...new Set(codes.map((c) => c.toUpperCase()))].filter(
      (c) => CODE_RE.test(c) && !this.airportNames.has(c),
    );
    if (missing.length === 0) return;
    try {
      // Codes are validated against CODE_RE above, so the query is safe to build.
      const raw = await this.get(`${TRACKER_ENDPOINTS.airportCoords}?codes=${missing.join(',')}`);
      const parsed = z
        .record(z.string(), z.looseObject({ lat: num, lon: num, name: optStr }))
        .catch({})
        .parse(raw);
      for (const code of missing) {
        const hit = parsed[code];
        this.airportNames.set(code, hit ? { name: shortAirportName(hit.name), lat: hit.lat, lon: hit.lon } : null);
      }
    } catch {
      // Names are cosmetic; retry on a later poll.
    }
  }

  private normalize(p: z.infer<typeof overheadEntrySchema>): Flight {
    // The tracker sends 0 when it doesn't know where the airport is: that's "unknown", not 0 mi.
    const dOrigin = p.origin_latitude === null && !p.distance_origin ? null : p.distance_origin;
    const dDest = p.destination_latitude === null && !p.distance_destination ? null : p.distance_destination;
    const progress = dOrigin !== null && dDest !== null && dOrigin + dDest > 0 ? dOrigin / (dOrigin + dDest) : null;
    const originInfo = this.airportNames.get(p.origin.toUpperCase()) ?? null;
    const destInfo = this.airportNames.get(p.destination.toUpperCase()) ?? null;
    const digits = /\d+[A-Z]?$/.exec(p.callsign)?.[0] ?? '';
    const iata = p.owner_iata && p.owner_iata !== 'N/A' ? p.owner_iata : '';
    // FR24's flight number ("UA1252") is the real one; show it as "UA 1252".
    const fr24Flight = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/.exec(p.fr24?.flight ?? '');
    const fx = p.fr24;
    const logoIcao = (p.owner_icao || p.callsign.slice(0, 3)).toUpperCase();
    // The tracker's stand-in when no source knew the route is "Private", "?" → "?".
    // For an airline callsign (three letters, then digits) that isn't true, so say nothing.
    const noRoute = p.origin === '?' && p.destination === '?';
    const airline = noRoute && p.airline === 'Private' && /^[A-Z]{3}\d/.test(p.callsign.trim().toUpperCase()) ? '' : p.airline;
    return {
      callsign: p.callsign.trim().toUpperCase(),
      icao24: p.icao24.toLowerCase(),
      airline,
      logoIcao: /^[A-Z0-9]{2,4}$/.test(logoIcao) ? logoIcao : '',
      flightNumber: fr24Flight ? `${fr24Flight[1]} ${fr24Flight[2]}` : iata && digits ? `${iata} ${digits}` : '',
      aircraftCode: p.plane,
      aircraftName: this.aircraftTypes.get(p.plane) ?? '',
      origin: {
        code: p.origin === '?' ? '' : p.origin,
        name: originInfo?.name ?? '',
        lat: p.origin_latitude ?? originInfo?.lat ?? null,
        lon: p.origin_longitude ?? originInfo?.lon ?? null,
        distance: dOrigin,
        delay: departureDelayLevel(p.time_real_departure, p.time_scheduled_departure),
      },
      destination: {
        code: p.destination === '?' ? '' : p.destination,
        name: destInfo?.name ?? '',
        lat: p.destination_latitude ?? destInfo?.lat ?? null,
        lon: p.destination_longitude ?? destInfo?.lon ?? null,
        distance: dDest,
        delay: arrivalDelayLevel(p.time_estimated_arrival, p.time_scheduled_arrival),
      },
      progress,
      routeSource: p.origin && p.origin !== '?' && p.destination && p.destination !== '?' ? 'tracker' : null,
      extra: fx
        ? {
            registration: fx.registration.slice(0, 12),
            runwayTakeoff: fx.runway_takeoff.slice(0, 6),
            diverted: fx.diverted === true,
            plannedDestination: /^[A-Z0-9]{3,4}$/.test(fx.planned_dest) ? fx.planned_dest : '',
            tripKm: fx.circle_distance !== null && fx.circle_distance > 0 && fx.circle_distance < 20_000 ? Math.round(fx.circle_distance) : null,
          }
        : null,
      position: {
        lat: p.plane_latitude,
        lon: p.plane_longitude,
        altitudeFt: p.altitude,
        headingDeg: p.heading,
        verticalFpm: p.vertical_speed,
        groundSpeedKt: p.ground_speed,
      },
      fromHome: { distance: p.distance, direction: p.direction },
      times: {
        scheduledDeparture: p.time_scheduled_departure,
        actualDeparture: p.time_real_departure,
        scheduledArrival: p.time_scheduled_arrival,
        estimatedArrival: p.time_estimated_arrival,
      },
    };
  }

  private update(patch: Partial<TrackerState>): void {
    const next: TrackerState = { ...this.state, ...patch, updatedAt: new Date().toISOString() };
    const { updatedAt: _ignored, ...comparable } = next;
    const serialized = JSON.stringify(comparable);
    this.state = next;
    if (serialized !== this.lastSerialized) {
      this.lastSerialized = serialized;
      this.version += 1;
      this.bus.emit('tracker', { version: this.version });
    }
  }
}
