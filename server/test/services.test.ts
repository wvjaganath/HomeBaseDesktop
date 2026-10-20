import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { EventBus } from '../src/events.js';
import { RadarService } from '../src/services/radar.js';
import { TrackerService } from '../src/services/tracker.js';

// A fake plane-tracker web UI serving data in the real its-a-plane format.
const now = Math.floor(Date.now() / 1000);
const routes: Record<string, unknown> = {
  '/overhead/json': [
    {
      callsign: 'SWA3508', icao24: 'A1B2C3', airline: 'Southwest Airlines', plane: 'B738', origin: 'MDW', destination: 'ONT',
      owner_iata: 'WN', owner_icao: 'SWA', origin_latitude: 41.786, origin_longitude: -87.752, destination_latitude: 34.056,
      destination_longitude: -117.601, plane_latitude: 41.66, plane_longitude: -87.93, altitude: 7875, heading: 232,
      vertical_speed: 2240, distance: 3.2, direction: 'S', distance_origin: 19, distance_destination: 1685,
      time_scheduled_departure: now - 600, time_real_departure: now - 420, time_scheduled_arrival: now + 14000, time_estimated_arrival: null,
      fr24: { flight: 'WN3508', registration: 'N8642E', type: 'B738', runway_takeoff: '31C', planned_dest: 'ONT', diverted: false, circle_distance: 2_711.6 },
    },
    // What the tracker sends when no lookup source knew the route.
    { callsign: 'UAL1234', icao24: 'ABC123', airline: 'Private', plane: '', origin: '?', destination: '?', owner_iata: 'N/A', owner_icao: 'UAL', plane_latitude: 41.7, plane_longitude: -87.9, altitude: 9000, ground_speed: 310, distance: 4.1, direction: 'N', distance_origin: 0, distance_destination: 0 },
    { callsign: 'N172SP', icao24: 'A0B0C0', airline: 'Private', plane: '', origin: '?', destination: '?', owner_iata: 'N/A', owner_icao: 'N17', plane_latitude: 41.71, plane_longitude: -87.91, altitude: 2500, distance: 5, direction: 'NE' },
    { garbage: true },
    'not-an-object',
  ],
  '/tracked/json/live': { callsign: '' },
  '/weather/json': {
    temperature: 64.2, humidity: 48, weatherCode: 1101, moonPhase: 1,
    forecast: [
      { startTime: '2026-10-17T06:00:00-05:00', values: { temperatureMin: 52, temperatureMax: 71, weatherCodeFullDay: 1000 } },
      { startTime: 'bogus', values: {} },
    ],
  },
  '/clock/json': { sunrise: '07:05', sunset: '18:12', alerts: [{ text: 'ORD Arr45', color: 'orange' }, { text: 'ISS 6m', color: 'white' }] },
  '/api/aircraft-types': { B738: 'Boeing 737-800' },
  '/api/airport-coords': {
    MDW: { lat: 41.786, lon: -87.752, name: 'Chicago Midway International Airport' },
    ONT: { lat: 34.056, lon: -117.601, name: 'Ontario International Airport' },
  },
};
const requested: string[] = [];
const server = http.createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0] ?? '';
  requested.push(path);
  res.setHeader('content-type', 'application/json');
  if (!(path in routes)) {
    res.statusCode = 404;
    res.end('{}');
    return;
  }
  res.end(JSON.stringify(routes[path]));
});

const log = { info() {}, warn() {}, debug() {}, error() {}, child() { return log; } } as never;
let port = 0;
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.close();
});

describe('TrackerService', () => {
  it('normalises the tracker JSON and ignores malformed entries', async () => {
    const env = loadEnv({ JWT_SECRET: 'x'.repeat(40), TRACKER_URL: `http://127.0.0.1:${port}`, HOME_LAT: '41.7', HOME_LON: '-87.9' });
    const tracker = new TrackerService(env, new EventBus(), log);
    tracker.start();
    await new Promise((r) => setTimeout(r, 800));
    tracker.stop();
    const s = tracker.snapshot.state;
    expect(s.reachable).toBe(true);
    expect(s.flights).toHaveLength(3);
    const f = s.flights[0];
    expect(f?.flightNumber).toBe('WN 3508');
    expect(f?.extra).toEqual({ registration: 'N8642E', runwayTakeoff: '31C', diverted: false, plannedDestination: 'ONT', tripKm: 2712 });
    expect(f?.logoIcao).toBe('SWA');
    expect(f?.origin.name).toBe('Chicago Midway');
    expect(f?.origin.delay).toBe('ontime');
    expect(f?.destination.delay).toBe('unknown');
    expect(f?.aircraftName).toBe('Boeing 737-800');
    // Route not found: an airline flight isn't "Private", and "?" isn't an airport.
    expect(s.flights[1]).toMatchObject({ callsign: 'UAL1234', airline: '', origin: { code: '', distance: null }, destination: { code: '', distance: null }, progress: null });
    expect(s.flights[1]?.position.groundSpeedKt).toBe(310);
    expect(s.flights[2]).toMatchObject({ callsign: 'N172SP', airline: 'Private', origin: { code: '' } });
    expect(s.weather?.forecast).toHaveLength(1);
    expect(s.alerts).toEqual([{ text: 'ORD Arr45', level: 'orange' }, { text: 'ISS 6m', level: 'white' }]);
  });

  it('fills a route the tracker couldn’t find from adsbdb’s schedule, only when the plane is on it', async () => {
    const env = loadEnv({ JWT_SECRET: 'x'.repeat(40), TRACKER_URL: `http://127.0.0.1:${port}` });
    const known: Record<string, unknown> = {
      UAL1234: { airline: { name: 'United Airlines', icao: 'UAL', iata: 'UA' }, origin: { code: 'ORD', name: "Chicago O'Hare International Airport", city: 'Chicago', lat: 41.978, lon: -87.904 }, destination: { code: 'DEN', name: 'Denver International Airport', city: 'Denver', lat: 39.861, lon: -104.673 } },
    };
    const routes = {
      route: async (cs: string) => known[cs] ?? null,
      airframe: async (hex: string) => (hex === 'abc123' ? { type: 'Airbus A319', icaoType: 'A319', manufacturer: 'Airbus', registration: 'N123UA', owner: '' } : null),
    } as unknown as import('../src/services/routeLookup.js').RouteLookupService;
    const tracker = new TrackerService(env, new EventBus(), log, { routes, units: () => 'imperial' });
    tracker.start();
    await new Promise((r) => setTimeout(r, 800));
    tracker.stop();
    const [swa, ual, private_] = tracker.snapshot.state.flights;
    expect(swa?.routeSource).toBe('tracker'); // the tracker's own route is kept
    expect(ual).toMatchObject({ routeSource: 'schedule', airline: 'United Airlines', flightNumber: 'UA 1234', aircraftCode: 'A319', origin: { code: 'ORD', name: "Chicago O'Hare" }, destination: { code: 'DEN' } });
    expect(ual?.origin.distance).toBeGreaterThan(10);
    expect(ual?.progress).toBeGreaterThan(0);
    expect(private_?.routeSource).toBeNull(); // tail numbers aren't looked up

    // A schedule route the plane can't be on (Boston → New York over Chicago) is ignored.
    known.UAL1234 = { airline: { name: 'United Airlines', icao: 'UAL', iata: 'UA' }, origin: { code: 'BOS', name: 'Logan', city: 'Boston', lat: 42.36, lon: -71.01 }, destination: { code: 'JFK', name: 'JFK', city: 'New York', lat: 40.64, lon: -73.78 } };
    const again = new TrackerService(env, new EventBus(), log, { routes, units: () => 'imperial' });
    again.start();
    await new Promise((r) => setTimeout(r, 800));
    again.stop();
    // …but the airline and flight number, which go with the callsign, are still shown.
    expect(again.snapshot.state.flights[1]).toMatchObject({ routeSource: null, origin: { code: '' }, airline: 'United Airlines', flightNumber: 'UA 1234' });
  });

  it('only ever requests allow-listed read-only endpoints', () => {
    const allowed = new Set(['/overhead/json', '/tracked/json/live', '/weather/json', '/clock/json', '/api/aircraft-types', '/api/airport-coords']);
    expect(requested.length).toBeGreaterThan(0);
    for (const p of requested) expect(allowed.has(p), p).toBe(true);
  });

  it('reports unreachable without throwing', async () => {
    const tracker = new TrackerService(loadEnv({ JWT_SECRET: 'x'.repeat(40), TRACKER_URL: 'http://127.0.0.1:1' }), new EventBus(), log);
    tracker.start();
    await new Promise((r) => setTimeout(r, 300));
    tracker.stop();
    expect(tracker.snapshot.state.reachable).toBe(false);
  });
});

describe('RadarService', () => {
  it('parses readsb-format data, drops stale/invalid aircraft, sorts by distance', () => {
    const env = loadEnv({ JWT_SECRET: 'x'.repeat(40), HOME_LAT: '41.7', HOME_LON: '-87.9' });
    const radar = new RadarService(env, new EventBus(), log);
    (radar as unknown as { ingest: (raw: unknown, src: string) => void }).ingest(
      {
        ac: [
          { hex: 'a1b2c3', flight: 'SWA3508 ', r: 'N8642E', t: 'B738', lat: 41.66, lon: -87.93, alt_baro: 7875, gs: 286, track: 232, baro_rate: 2240 },
          { hex: '~abcdef', lat: 41.9, lon: -87.6, alt_baro: 'ground' },
          { hex: 'zzz', lat: 1, lon: 1 },
          { hex: 'c0ffee', flight: 'UAL2213', lat: 41.7, lon: -88.1, alt_baro: 34000, seen_pos: 120 },
        ],
      },
      'adsb.lol',
    );
    const list = radar.snapshot.data.aircraft;
    expect(list.map((a) => a.hex)).toEqual(['a1b2c3', 'abcdef']);
    expect(list[0]?.callsign).toBe('SWA3508');
    expect(list[0]?.direction).toBe('SW');
    expect(list[1]?.altitudeFt).toBeNull();
  });
});
