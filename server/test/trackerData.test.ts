import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseApiLogLine } from '../src/services/trackerData.js';
import { cookieHeader, ORIGIN, registerUser, testApp } from './helpers.js';

/** Behaves like its-a-plane-python/web/apppublic.py's data endpoints. */
type Json = Record<string, unknown>;
let tracked: Json = { callsign: '' };
let live: Json = {};
let lookups: string[] = [];
let calls: string[] = [];
const counter = {
  '2026-10-16': {
    date: '2026-10-16',
    count: 2,
    flights: [
      { callsign: 'UAL1234', time: '08:01:02', hour: 8, origin: 'ORD', dest: 'SFO', aircraft: 'B738' },
      { callsign: 'AAL55', time: '17:30:00', hour: 17, origin: 'DFW', dest: 'ORD', aircraft: 'A321', extra: '<script>' },
    ],
    first_seen: '08:01:02',
    last_seen: '17:30:00',
  },
};
const closeTxt = [
  {
    callsign: 'SWA88',
    airline: 'Southwest',
    plane: 'B737',
    origin: 'MDW',
    destination: 'DEN',
    timestamp: 'Oct 16 2026, 09:00:00 AM',
    distance: 0.42,
    direction: 'NE',
    altitude: 3100,
    plane_latitude: 41.8,
    plane_longitude: -87.7,
    origin_latitude: 41.78,
    origin_longitude: -87.75,
    destination_latitude: 39.86,
    destination_longitude: -104.67,
    secret_field: 'not passed on',
  },
  { nope: true },
];
const farthestTxt = [
  { callsign: 'QFA9', origin: 'PER', destination: 'LHR', reason: 'origin', farthest_value: 9000.5, _airport: 'PER', trail: [[51.4, -0.4], [91, 0], 'x', [50, 1]] },
];
const apiLog = [
  '2026-10-16 08:01:02  AirLabs               UAL1234     ORD→SFO       [AL:1 FA:$0.000 FR:0]',
  'garbage line',
  '2026-10-16 09:00:00  FlightAware           SWA88       MDW→DEN       [AL:1 FA:$0.005 FR:0]',
  '',
].join('\n');

const tracker = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c: Buffer) => (raw += c.toString()));
  req.on('end', () => {
    calls.push(`${req.method ?? ''} ${req.url ?? ''}`);
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const body = raw ? (JSON.parse(raw) as Json) : {};
    switch (`${req.method ?? ''} ${req.url ?? ''}`) {
      case 'GET /counter/summary':
        send(200, [{ date: '2026-10-16', count: 2, by_hour: Array.from({ length: 24 }, (_, h) => (h === 8 || h === 17 ? 1 : 0)), first_seen: '08:01:02', last_seen: '17:30:00' }]);
        return;
      case 'GET /counter':
        send(200, counter);
        return;
      case 'GET /api/usage':
        send(200, { AirLabs: 12, FlightAware: 0.25, FR24: 3, AirLabs_period_start: '2026-10-01', 'bad key!': 1, junk: { a: 1 } });
        return;
      case 'GET /closest/json':
        send(200, closeTxt);
        return;
      case 'GET /farthest/json':
        send(200, farthestTxt);
        return;
      case 'GET /api_calls/log/json':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(apiLog);
        return;
      case 'GET /tracked/json':
        send(200, tracked);
        return;
      case 'GET /homebase/tracked/live':
        send(200, live);
        return;
      case 'POST /tracked/lookup': {
        const cs = typeof body.callsign === 'string' ? body.callsign : '';
        lookups.push(cs);
        if (cs !== 'UAL1') {
          send(200, { found: false, callsign: cs, summary: `${cs} not found — check the callsign or try again closer to departure.` });
          return;
        }
        const leg = (o: string, d: string, dep: number) => ({
          callsign: cs,
          flight_id: `id-${o}`,
          airline: 'United',
          origin: o,
          destination: d,
          aircraft: 'B789',
          registration: 'N1',
          is_live: false,
          status: 'Scheduled',
          scheduled_departure: dep,
          cached_route: { origin: o, destination: d, origin_latitude: 41.9, origin_longitude: -87.9, destination_latitude: 37.6, destination_longitude: -122.4, time_scheduled_departure: dep, airline_name: 'United', aircraft_type: 'B789', injected: 'x' },
        });
        send(200, { found: true, multiple: true, callsign: cs, flights: [leg('ORD', 'SFO', 1_800_000_000), leg('SFO', 'HNL', 1_800_020_000)], summary: '2 flights found for UAL1 — select a leg' });
        return;
      }
      case 'POST /tracked/set':
        tracked = body;
        send(200, { message: typeof body.callsign === 'string' && body.callsign ? `Now tracking ${body.callsign}.` : 'Tracking cleared.' });
        return;
      case 'POST /search/route':
        send(200, { found: true, flights: [{ callsign: 'UAL1', number: 'UA1', airline: 'United', origin: body.origin, destination: body.destination, dep_time: '2026-10-17T15:00:00Z', is_live: false, status: 'Landed' }, { callsign: '<b>', number: '' }] });
        return;
      default:
        send(404, { error: 'not found' });
    }
  });
});

let app: FastifyInstance;
let cookie = '';
let screen = '';
const web = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object, c = cookie) =>
  app.inject({ method, url, headers: { origin: ORIGIN, ...(c ? { cookie: c } : {}) }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  await new Promise<void>((r) => tracker.listen(0, '127.0.0.1', () => r()));
  app = await testApp({ TRACKER_URL: `http://127.0.0.1:${(tracker.address() as AddressInfo).port}`, TRACKER_BUNDLED: 'true' });
  const u = await registerUser(app, 'me@example.com');
  const login = await app.inject({ method: 'POST', url: '/auth/web/login', headers: { origin: ORIGIN }, payload: { email: 'me@example.com', password: 'correct horse battery' } });
  cookie = cookieHeader(login.headers['set-cookie']);
  const dev = await app.inject({ method: 'POST', url: '/api/devices', headers: { authorization: `Bearer ${u.accessToken}` }, payload: { name: 'Kitchen' } });
  screen = `Bearer ${dev.json<{ pairPath: string }>().pairPath.split('t=')[1] ?? ''}`;
});
afterAll(async () => {
  await app.close();
  tracker.close();
});
beforeEach(() => {
  tracked = { callsign: '' };
  live = {};
  lookups = [];
  calls = [];
});

describe('plane tracker data', () => {
  it('serves daily stats and API usage, keeping only known shapes', async () => {
    const r = await web('GET', '/api/tracker/stats');
    expect(r.statusCode).toBe(200);
    const body = r.json<{ days: Array<{ date: string; byHour: number[] }>; usage: Json }>();
    expect(body.days[0]?.date).toBe('2026-10-16');
    expect(body.days[0]?.byHour[8]).toBe(1);
    expect(body.usage).toEqual({ AirLabs: 12, FlightAware: 0.25, FR24: 3, AirLabs_period_start: '2026-10-01' });
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: { origin: ORIGIN, cookie } })).json()).toMatchObject({ trackerBundled: true });
  });

  it('serves one day’s flights and rejects bad dates', async () => {
    const r = await web('GET', '/api/tracker/stats/2026-10-16');
    expect(r.json()).toEqual({
      date: '2026-10-16',
      count: 2,
      firstSeen: '08:01:02',
      lastSeen: '17:30:00',
      flights: [
        { callsign: 'UAL1234', time: '08:01:02', hour: 8, origin: 'ORD', destination: 'SFO', aircraft: 'B738' },
        { callsign: 'AAL55', time: '17:30:00', hour: 17, origin: 'DFW', destination: 'ORD', aircraft: 'A321' },
      ],
    });
    expect((await web('GET', '/api/tracker/stats/2026-10-15')).statusCode).toBe(404);
    expect((await web('GET', '/api/tracker/stats/..%2Fconfig')).statusCode).toBe(400);
  });

  it('serves closest and farthest records with clean trails', async () => {
    const r = await web('GET', '/api/tracker/records');
    const { closest, farthest } = r.json<{ closest: Json[]; farthest: Array<Json & { trail: unknown[] }> }>();
    expect(closest).toHaveLength(1);
    expect(closest[0]).toMatchObject({ callsign: 'SWA88', distance: 0.42, origin: { code: 'MDW', lat: 41.78 }, farthest: null });
    expect(JSON.stringify(closest)).not.toContain('secret_field');
    expect(farthest[0]).toMatchObject({ callsign: 'QFA9', farthest: { from: 'origin', distance: 9000.5 } });
    expect(farthest[0]?.trail).toEqual([[51.4, -0.4], [50, 1]]);
  });

  it('lets screens read stats but not the API log', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/tracker/records', headers: { authorization: screen } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/tracker/api-log', headers: { authorization: screen } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/tracker/stats' })).statusCode).toBe(401);
  });

  it('serves the API call log newest first', async () => {
    const r = await web('GET', '/api/tracker/api-log');
    expect(r.json()).toEqual({
      calls: [
        { time: '2026-10-16 09:00:00', source: 'FlightAware', callsign: 'SWA88', route: 'MDW→DEN', totals: 'AL:1 FA:$0.005 FR:0' },
        { time: '2026-10-16 08:01:02', source: 'AirLabs', callsign: 'UAL1234', route: 'ORD→SFO', totals: 'AL:1 FA:$0.000 FR:0' },
      ],
    });
    expect(parseApiLogLine('nonsense')).toBeNull();
  });

  it('looks a flight up, tracks the leg picked, shows it live, and clears it', async () => {
    const miss = await web('POST', '/api/tracker/tracked/lookup', { callsign: 'dal9' });
    expect(miss.json()).toMatchObject({ found: false, legs: [] });
    expect(lookups).toEqual(['DAL9']);

    const r = await web('POST', '/api/tracker/tracked/lookup', { callsign: 'ual1' });
    const look = r.json<{ found: boolean; legs: Json[] }>();
    expect(look.found).toBe(true);
    expect(look.legs.map((l) => `${String(l.origin)}-${String(l.destination)}`)).toEqual(['ORD-SFO', 'SFO-HNL']);
    expect(JSON.stringify(look)).not.toContain('cached_route');

    expect((await web('POST', '/api/tracker/tracked', { callsign: 'UAL1', leg: 5 })).statusCode).toBe(422);
    expect((await web('POST', '/api/tracker/tracked', { callsign: 'DAL9', leg: 0 })).statusCode).toBe(422);
    const set = await web('POST', '/api/tracker/tracked', { callsign: 'UAL1', leg: 1 });
    expect(set.json()).toEqual({ ok: true, message: 'Now tracking UAL1.' });
    // What the tracker got: rebuilt from the hub's parsed leg, no unknown fields.
    expect(tracked).toMatchObject({ callsign: 'UAL1', flight_id: 'id-SFO', scheduled_departure: 1_800_020_000, is_live: false });
    expect(tracked.cached_route).toMatchObject({ origin: 'SFO', destination: 'HNL', airline_name: 'United' });
    expect(JSON.stringify(tracked)).not.toContain('injected');

    const pre = (await web('GET', '/api/tracker/tracked')).json<{ tracked: Json }>();
    expect(pre.tracked).toMatchObject({ callsign: 'UAL1', origin: { code: 'SFO' }, destination: { code: 'HNL' }, live: null });
    live = { callsign: 'UAL1', is_live: true, latitude: 30.1, longitude: -140.2, altitude: 37000, ground_speed: 480, time_remaining: '2:10', dist_remaining: 1100 };
    const air = (await web('GET', '/api/tracker/tracked')).json<{ tracked: Json }>();
    expect(air.tracked).toMatchObject({ live: { lat: 30.1, lon: -140.2, altitudeFt: 37000, timeRemaining: '2:10', distanceRemaining: 1100 } });

    expect((await web('DELETE', '/api/tracker/tracked')).json()).toEqual({ ok: true, message: 'Tracking cleared.' });
    expect(tracked).toEqual({ callsign: '' });
    expect((await web('GET', '/api/tracker/tracked')).json()).toEqual({ tracked: null });
  });

  it('validates input and keeps writes for signed-in people', async () => {
    expect((await web('POST', '/api/tracker/tracked/lookup', { callsign: 'UAL 1; rm' })).statusCode).toBe(400);
    expect((await web('POST', '/api/tracker/tracked/lookup', { callsign: 'UAL1', extra: 1 })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/tracker/tracked/lookup', headers: { authorization: screen }, payload: { callsign: 'UAL1' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/tracker/tracked', headers: { cookie, origin: 'http://evil.example' } })).statusCode).toBe(403);
    expect(lookups).toEqual([]);
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([]);
  });

  it('searches a route and drops malformed results', async () => {
    const r = await web('POST', '/api/tracker/route-search', { origin: 'ord', destination: 'sfo' });
    expect(r.json()).toEqual({ found: true, error: '', flights: [{ callsign: 'UAL1', number: 'UA1', airline: 'United', departure: '2026-10-17T15:00:00Z', live: false, status: 'Landed' }] });
    expect((await web('POST', '/api/tracker/route-search', { origin: 'O', destination: 'SFO' })).statusCode).toBe(400);
  });

  it('answers 409 when no tracker is configured', async () => {
    const none = await testApp({});
    const u = await registerUser(none, 'x@example.com');
    const r = await none.inject({ method: 'GET', url: '/api/tracker/records', headers: { authorization: `Bearer ${u.accessToken}` } });
    expect(r.statusCode).toBe(409);
    await none.close();
  });
});
