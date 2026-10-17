import { z } from 'zod';
import { TrackerAdminError, TrackerClient } from './trackerAdmin.js';

/**
 * The plane tracker's stats, records, API call log and flight tracking, for
 * the HomeBase screens (Flights → Stats / Records / Track / API log).
 *
 * Everything the tracker sends is parsed into plain, size-capped shapes here,
 * so the browser only ever sees fields HomeBase knows about. Tracking a flight
 * uses the tracker's own two steps (look up the legs, then save one); the hub
 * keeps the looked-up legs itself, so a browser can only pick one of them and
 * can't write arbitrary data into the tracker's files.
 */

type DataPath =
  | '/counter'
  | '/counter/summary'
  | '/closest/json'
  | '/farthest/json'
  | '/api_calls/log/json'
  | '/api/usage'
  | '/tracked/json'
  | '/homebase/tracked/live'
  | '/tracked/lookup'
  | '/tracked/set'
  | '/search/route';

const BIG = 64 * 1024 * 1024; // counter + log grow forever upstream; the server reads them locally
const LOG_LINES = 1000;
const MAX_TRAIL = 3000;

const str = (max = 120) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => (v === null || v === undefined ? '' : String(v).slice(0, max)));
const num = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });
const hour = z.coerce.number().int().min(0).max(23).catch(0);

// ---------- stats ----------

const summaryDay = z.looseObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.coerce.number().int().min(0).catch(0),
  by_hour: z.array(z.coerce.number().int().min(0).catch(0)).length(24).catch(() => Array<number>(24).fill(0)),
  first_seen: str(8),
  last_seen: str(8),
});

const counterFlight = z.looseObject({
  callsign: str(12),
  time: str(8),
  hour,
  origin: str(8),
  dest: str(8),
  aircraft: str(40),
});
const counterDay = z.looseObject({
  date: str(10),
  count: z.coerce.number().int().min(0).catch(0),
  flights: z.array(z.unknown()).catch([]),
  first_seen: str(8),
  last_seen: str(8),
});

export interface DaySummary {
  date: string;
  count: number;
  byHour: number[];
  firstSeen: string;
  lastSeen: string;
}
export interface DayDetail {
  date: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  flights: Array<{ callsign: string; time: string; hour: number; origin: string; destination: string; aircraft: string }>;
}

// ---------- records ----------

const latLon = z.tuple([z.number(), z.number()]);
const recordEntry = z.looseObject({
  callsign: str(12),
  airline: str(80),
  plane: str(60),
  origin: str(8),
  destination: str(8),
  timestamp: str(40),
  distance: num,
  direction: str(4),
  altitude: num,
  plane_latitude: num,
  plane_longitude: num,
  origin_latitude: num,
  origin_longitude: num,
  destination_latitude: num,
  destination_longitude: num,
  distance_origin: num,
  distance_destination: num,
  reason: z.enum(['origin', 'destination']).optional().catch(undefined),
  farthest_value: num,
  trail: z.array(z.unknown()).optional().catch(undefined),
});

export interface FlightRecord {
  callsign: string;
  airline: string;
  aircraft: string;
  origin: { code: string; lat: number | null; lon: number | null; distance: number | null };
  destination: { code: string; lat: number | null; lon: number | null; distance: number | null };
  seen: string;
  distance: number | null;
  direction: string;
  altitudeFt: number | null;
  plane: { lat: number | null; lon: number | null };
  /** Farthest only: which end of the flight was far away, and how far. */
  farthest: { from: 'origin' | 'destination'; distance: number | null } | null;
  trail: Array<[number, number]>;
}

function toRecord(raw: unknown): FlightRecord | null {
  const p = recordEntry.safeParse(raw);
  if (!p.success || p.data.callsign === '') return null;
  const e = p.data;
  const trail: Array<[number, number]> = [];
  for (const pt of (e.trail ?? []).slice(0, MAX_TRAIL)) {
    const t = latLon.safeParse(pt);
    if (t.success && Math.abs(t.data[0]) <= 90 && Math.abs(t.data[1]) <= 180) trail.push(t.data);
  }
  return {
    callsign: e.callsign,
    airline: e.airline,
    aircraft: e.plane,
    origin: { code: e.origin, lat: e.origin_latitude, lon: e.origin_longitude, distance: e.distance_origin },
    destination: { code: e.destination, lat: e.destination_latitude, lon: e.destination_longitude, distance: e.distance_destination },
    seen: e.timestamp,
    distance: e.distance,
    direction: e.direction,
    altitudeFt: e.altitude,
    plane: { lat: e.plane_latitude, lon: e.plane_longitude },
    farthest: e.reason ? { from: e.reason, distance: e.farthest_value } : null,
    trail,
  };
}

// ---------- API log ----------

export interface ApiCall {
  time: string;
  source: string;
  callsign: string;
  route: string;
  totals: string;
}

/** "2026-10-17 17:08:37  AirLabs   UAL1234  ORD→SFO  [AL:1 FA:$0.000 FR:1]" */
export function parseApiLogLine(line: string): ApiCall | null {
  const parts = line.trim().split(/ {2,}/);
  if (parts.length < 4) return null;
  const [time = '', source = '', callsign = '', route = '', ...rest] = parts;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)) return null;
  const totals = rest.join(' ');
  return {
    time,
    source: source.slice(0, 40),
    callsign: callsign.slice(0, 12),
    route: route.slice(0, 20),
    totals: totals.startsWith('[') && totals.endsWith(']') ? totals.slice(1, -1).slice(0, 60) : '',
  };
}

// ---------- tracking ----------

const CALLSIGN = /^[A-Z0-9]{2,10}$/;
const IATA = /^[A-Z0-9]{3,4}$/;
export const callsignInput = z.strictObject({ callsign: z.string().trim().toUpperCase().regex(CALLSIGN, 'Use the flight’s callsign or number, like UAL1234 or UA1234') });
export const pickInput = z.strictObject({ callsign: z.string().trim().toUpperCase().regex(CALLSIGN), leg: z.number().int().min(0).max(49) });
export const routeInput = z.strictObject({
  origin: z.string().trim().toUpperCase().regex(IATA, 'Use an airport code like ORD'),
  destination: z.string().trim().toUpperCase().regex(IATA, 'Use an airport code like SFO'),
});

// z.object (not loose): unknown keys are dropped, so only these reach the tracker.
const cachedRoute = z.object({
  origin: str(8),
  origin_latitude: num,
  origin_longitude: num,
  destination: str(8),
  destination_latitude: num,
  destination_longitude: num,
  time_scheduled_departure: num,
  time_scheduled_arrival: num,
  time_real_departure: num,
  time_estimated_arrival: num,
  airline_name: str(80),
  aircraft_type: str(60),
});
const legSchema = z.looseObject({
  flight_id: str(40),
  airline: str(80),
  origin: str(8),
  destination: str(8),
  aircraft: str(60),
  registration: str(16),
  is_live: z.boolean().catch(false),
  status: str(20),
  scheduled_departure: num,
  cached_route: cachedRoute.catch(() => cachedRoute.parse({})),
});
const lookupReply = z.looseObject({
  found: z.boolean().catch(false),
  multiple: z.boolean().optional(),
  flight: z.unknown().optional(),
  flights: z.array(z.unknown()).optional(),
  summary: str(300),
  error: str(300),
});

export interface Leg {
  flightId: string;
  airline: string;
  origin: string;
  destination: string;
  aircraft: string;
  registration: string;
  live: boolean;
  status: string;
  scheduledDeparture: number | null;
  scheduledArrival: number | null;
}
type StoredLeg = Leg & { route: z.infer<typeof cachedRoute> };

const trackedFile = z.looseObject({
  callsign: str(12),
  scheduled_departure: num,
  airborne: z.boolean().optional(),
  cached_route: cachedRoute.optional().catch(undefined),
});
const liveFile = z.looseObject({
  callsign: str(12),
  is_live: z.boolean().catch(false),
  airline_name: str(80),
  aircraft_type: str(60),
  origin: str(8),
  destination: str(8),
  altitude: num,
  ground_speed: num,
  heading: num,
  vertical_speed: num,
  latitude: num,
  longitude: num,
  dest_lat: num,
  dest_lon: num,
  time_scheduled_departure: num,
  time_scheduled_arrival: num,
  time_real_departure: num,
  time_estimated_arrival: num,
  time_remaining: str(12),
  dist_remaining: num,
  total_distance: num,
});

export interface TrackedState {
  callsign: string;
  airline: string;
  aircraft: string;
  origin: { code: string; lat: number | null; lon: number | null };
  destination: { code: string; lat: number | null; lon: number | null };
  scheduledDeparture: number | null;
  scheduledArrival: number | null;
  live: null | {
    lat: number | null;
    lon: number | null;
    altitudeFt: number | null;
    groundSpeedKt: number | null;
    headingDeg: number | null;
    verticalFpm: number | null;
    departed: number | null;
    eta: number | null;
    timeRemaining: string;
    distanceRemaining: number | null;
    totalDistance: number | null;
  };
}

export interface RouteResult {
  callsign: string;
  number: string;
  airline: string;
  departure: string;
  live: boolean;
  status: string;
}

const LOOKUP_TTL_MS = 30 * 60_000;

export class TrackerData extends TrackerClient<DataPath> {
  /** callsign → legs from the last lookup (so /set can only pick one of them). */
  private readonly legs = new Map<string, { at: number; legs: StoredLeg[] }>();

  private async getJson(path: DataPath, maxBytes = 1024 * 1024): Promise<unknown> {
    const r = await this.call(path, { maxBytes });
    if (r.status === 404) return null;
    if (r.status !== 200) throw new TrackerAdminError(`The tracker answered HTTP ${r.status}`, 'unreachable');
    return r.body;
  }

  async stats(): Promise<{ days: DaySummary[]; usage: Record<string, number | string> }> {
    const [summary, usage] = await Promise.all([this.getJson('/counter/summary', BIG), this.getJson('/api/usage')]);
    const days: DaySummary[] = [];
    for (const raw of Array.isArray(summary) ? summary : []) {
      const d = summaryDay.safeParse(raw);
      if (d.success) days.push({ date: d.data.date, count: d.data.count, byHour: d.data.by_hour, firstSeen: d.data.first_seen, lastSeen: d.data.last_seen });
    }
    const usageOut: Record<string, number | string> = {};
    if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
      for (const [k, v] of Object.entries(usage as Record<string, unknown>)) {
        if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
        if (typeof v === 'number' && Number.isFinite(v)) usageOut[k] = v;
        else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) usageOut[k] = v;
      }
    }
    return { days, usage: usageOut };
  }

  async day(date: string): Promise<DayDetail | null> {
    const all = await this.getJson('/counter', BIG);
    if (!all || typeof all !== 'object' || Array.isArray(all)) return null;
    const p = counterDay.safeParse((all as Record<string, unknown>)[date]);
    if (!p.success) return null;
    const flights: DayDetail['flights'] = [];
    for (const raw of p.data.flights) {
      const f = counterFlight.safeParse(raw);
      if (f.success && f.data.callsign) {
        flights.push({ callsign: f.data.callsign, time: f.data.time, hour: f.data.hour, origin: f.data.origin, destination: f.data.dest, aircraft: f.data.aircraft });
      }
    }
    return { date, count: p.data.count, firstSeen: p.data.first_seen, lastSeen: p.data.last_seen, flights };
  }

  async records(): Promise<{ closest: FlightRecord[]; farthest: FlightRecord[] }> {
    const [closest, farthest] = await Promise.all([this.getJson('/closest/json', 8 * 1024 * 1024), this.getJson('/farthest/json', 8 * 1024 * 1024)]);
    const list = (v: unknown): FlightRecord[] =>
      (Array.isArray(v) ? v : [])
        .slice(0, 50)
        .map(toRecord)
        .filter((r): r is FlightRecord => r !== null);
    return { closest: list(closest), farthest: list(farthest) };
  }

  /** Newest first, at most LOG_LINES. */
  async apiLog(): Promise<ApiCall[]> {
    const r = await this.call('/api_calls/log/json', { maxBytes: BIG });
    if (r.status === 404) return [];
    if (r.status !== 200) throw new TrackerAdminError(`The tracker answered HTTP ${r.status}`, 'unreachable');
    const lines = r.text.split('\n');
    const out: ApiCall[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < LOG_LINES; i--) {
      const c = parseApiLogLine(lines[i] ?? '');
      if (c) out.push(c);
    }
    return out;
  }

  async tracked(): Promise<TrackedState | null> {
    const [saved, live] = await Promise.all([this.getJson('/tracked/json'), this.getJson('/homebase/tracked/live').catch(() => null)]);
    const s = trackedFile.safeParse(saved);
    if (!s.success || s.data.callsign === '') return null;
    const route = s.data.cached_route;
    const l = liveFile.safeParse(live);
    const isLive = l.success && l.data.is_live && l.data.callsign === s.data.callsign;
    const lv = isLive ? l.data : null;
    return {
      callsign: s.data.callsign,
      airline: lv?.airline_name || route?.airline_name || '',
      aircraft: lv?.aircraft_type || route?.aircraft_type || '',
      origin: { code: lv?.origin || route?.origin || '', lat: route?.origin_latitude ?? null, lon: route?.origin_longitude ?? null },
      destination: {
        code: lv?.destination || route?.destination || '',
        lat: route?.destination_latitude ?? lv?.dest_lat ?? null,
        lon: route?.destination_longitude ?? lv?.dest_lon ?? null,
      },
      scheduledDeparture: route?.time_scheduled_departure ?? s.data.scheduled_departure,
      scheduledArrival: route?.time_scheduled_arrival ?? null,
      live: lv
        ? {
            lat: lv.latitude,
            lon: lv.longitude,
            altitudeFt: lv.altitude,
            groundSpeedKt: lv.ground_speed,
            headingDeg: lv.heading,
            verticalFpm: lv.vertical_speed,
            departed: lv.time_real_departure,
            eta: lv.time_estimated_arrival,
            timeRemaining: lv.time_remaining,
            distanceRemaining: lv.dist_remaining,
            totalDistance: lv.total_distance,
          }
        : null,
    };
  }

  /** Step 1: ask the tracker's API cascade for the flight's legs (spends API credits). */
  async lookup(callsign: string): Promise<{ found: boolean; summary: string; legs: Leg[] }> {
    const r = await this.call('/tracked/lookup', { method: 'POST', json: { callsign }, timeoutMs: 45_000 });
    const p = lookupReply.safeParse(r.body);
    if (r.status !== 200 || !p.success) throw new TrackerAdminError('The tracker sent an unexpected reply', 'unreachable');
    const raw = p.data.flights ?? (p.data.flight === undefined ? [] : [p.data.flight]);
    const legs: StoredLeg[] = [];
    for (const f of raw.slice(0, 50)) {
      const l = legSchema.safeParse(f);
      if (!l.success) continue;
      const d = l.data;
      legs.push({
        flightId: d.flight_id,
        airline: d.airline,
        origin: d.origin,
        destination: d.destination,
        aircraft: d.aircraft,
        registration: d.registration,
        live: d.is_live,
        status: d.status,
        scheduledDeparture: d.scheduled_departure,
        scheduledArrival: d.cached_route.time_scheduled_arrival,
        route: d.cached_route,
      });
    }
    this.prune();
    if (legs.length > 0) this.legs.set(callsign, { at: Date.now(), legs });
    const summary = p.data.found ? p.data.summary : p.data.summary || (p.data.error ? `Lookup failed: ${p.data.error}` : `${callsign} not found`);
    return { found: p.data.found && legs.length > 0, summary, legs: legs.map(({ route: _route, ...leg }) => leg) };
  }

  /** Step 2: track one of the legs the last lookup returned. */
  async track(callsign: string, leg: number): Promise<string> {
    this.prune();
    const chosen = this.legs.get(callsign)?.legs[leg];
    if (!chosen) throw new TrackerAdminError('Look the flight up again first (the results expire after 30 minutes)', 'rejected');
    // Only the fields the tracker's own page sends, rebuilt from what the hub parsed.
    const cached = Object.fromEntries(Object.entries(chosen.route).filter(([, v]) => v !== '' && v !== null));
    return this.save({
      callsign,
      cached_route: cached,
      flight_id: chosen.flightId,
      scheduled_departure: chosen.scheduledDeparture,
      is_live: chosen.live,
    });
  }

  async stopTracking(): Promise<string> {
    return this.save({ callsign: '' });
  }

  private async save(payload: Record<string, unknown>): Promise<string> {
    const r = await this.call('/tracked/set', { method: 'POST', json: payload });
    const msg = z.looseObject({ message: str(200) }).safeParse(r.body);
    if (r.status !== 200) throw new TrackerAdminError(msg.success && msg.data.message ? msg.data.message : `The tracker didn’t save it (HTTP ${r.status})`, 'rejected');
    return msg.success ? msg.data.message : '';
  }

  /** Flights between two airports today (FlightRadar24 key needed on the tracker). */
  async searchRoute(origin: string, destination: string): Promise<{ found: boolean; error: string; flights: RouteResult[] }> {
    const r = await this.call('/search/route', { method: 'POST', json: { origin, destination }, timeoutMs: 20_000 });
    const p = z
      .looseObject({ found: z.boolean().catch(false), error: str(200), flights: z.array(z.unknown()).catch([]) })
      .safeParse(r.body);
    if (r.status !== 200 || !p.success) throw new TrackerAdminError('The tracker sent an unexpected reply', 'unreachable');
    const item = z.looseObject({ callsign: str(12), number: str(12), airline: str(80), dep_time: str(40), is_live: z.boolean().catch(false), status: str(20) });
    const flights: RouteResult[] = [];
    for (const f of p.data.flights.slice(0, 50)) {
      const i = item.safeParse(f);
      if (i.success && CALLSIGN.test(i.data.callsign)) {
        flights.push({ callsign: i.data.callsign, number: i.data.number, airline: i.data.airline, departure: i.data.dep_time, live: i.data.is_live, status: i.data.status });
      }
    }
    return { found: flights.length > 0, error: p.data.error, flights };
  }

  private prune(): void {
    const cutoff = Date.now() - LOOKUP_TTL_MS;
    for (const [k, v] of this.legs) if (v.at < cutoff) this.legs.delete(k);
    // Bound memory even if someone looks up many callsigns.
    while (this.legs.size > 50) {
      const oldest = this.legs.keys().next().value;
      if (oldest === undefined) break;
      this.legs.delete(oldest);
    }
  }
}
