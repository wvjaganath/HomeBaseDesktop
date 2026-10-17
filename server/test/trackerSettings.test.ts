import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cookieHeader, ORIGIN, registerUser, testApp } from './helpers.js';

/** Behaves like its-a-plane-python/web/apppublic.py's /api/config etc. */
type Json = Record<string, unknown>;
let cfg: Json = {};
let sec: Json = {};
let restarts = 0;
let wifiConnects: Array<{ ssid: string; password: string }> = [];
const mask = (v: unknown): unknown => (typeof v === 'string' && v.length > 8 ? `${v.slice(0, 4)}****${v.slice(-4)}` : v);
const tracker = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c: Buffer) => (raw += c.toString()));
  req.on('end', () => {
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/api/config' && req.method === 'GET') {
      const masked: Json = {};
      for (const [k, v] of Object.entries(sec)) masked[k] = Array.isArray(v) ? v.map(mask) : mask(v);
      send(200, { config: cfg, secrets: masked }); return;
    }
    if (req.url === '/api/config' && req.method === 'POST') {
      const data = JSON.parse(raw) as { config?: Json; secrets?: Json };
      if (data.config) cfg = data.config;
      for (const [k, v] of Object.entries(data.secrets ?? {})) {
        if (Array.isArray(v)) {
          const old = (sec[k] as string[] | undefined) ?? [];
          sec[k] = v.map((item: unknown, i) => (typeof item === 'string' && item.includes('****') ? (old[i] ?? item) : item));
        } else if (!(typeof v === 'string' && v.includes('****'))) sec[k] = v;
      }
      send(200, { ok: true, message: 'Config saved and reloaded' }); return;
    }
    if (req.url === '/api/restart' && req.method === 'POST') {
      restarts++;
      send(200, { ok: true }); return;
    }
    if (req.url === '/api/system') { send(200, { cpu_temp_c: 51.2, uptime_secs: 90_000, load_avg: [0.5, 0.4, 0.3], service_uptime_secs: 3_600 }); return; }
    if (req.url === '/api/usage') { send(200, { AirLabs: 120, FlightAware: 1.25, FR24: 3, AirLabs_period_start: '2026-10-01' }); return; }
    if (req.url === '/api/wifi/status') { send(200, { connected_ssid: 'Home', ip_address: '192.168.1.60', networks: [{ ssid: 'Home', signal: 80, security: 'WPA2', active: true }] }); return; }
    if (req.url === '/api/wifi/scan') { send(200, { networks: [{ ssid: 'Home', signal: 80, security: 'WPA2', active: true }, { ssid: 'Guest', signal: 40, security: '--', active: false }] }); return; }
    if (req.url === '/api/wifi/connect' && req.method === 'POST') {
      wifiConnects.push(JSON.parse(raw) as { ssid: string; password: string });
      send(200, { success: true, message: 'Connected' }); return;
    }
    send(404, { error: 'not found' });
  });
});

const valid = () => ({
  config: {
    location: {
      journey_code: 'ORD',
      clock_format: '12hr',
      temperature_units: 'imperial',
      distance_units: 'imperial',
      speed_units: 'imperial',
      location_home: [41.88, -87.62],
      temperature_location: '41.88, -87.62',
      zone_home: { tl_y: 41.92, tl_x: -87.69, br_y: 41.85, br_x: -87.55 },
    },
    display: {
      brightness: 80,
      brightness_night: 20,
      night_brightness: true,
      night_start: '22:00',
      night_end: '06:30',
      gpio_slowdown: 2,
      hat_pwm_enabled: false,
      led_rgb_sequence: 'RGB',
      forecast_days: 3,
      forecast_mode: 'scheduled',
      forecast_hourly_start: '05:00',
      forecast_hourly_end: '09:00',
    },
    flights: {
      min_altitude: 2600,
      max_farthest: 3,
      max_closest: 3,
      email: '',
      blocked_callsigns: ['N12345'],
      airport_status_list: 'ORD, MDW',
      weather_alerts_enabled: true,
      iss_alerts_enabled: false,
    },
    stats: { stats_log_days: 30 },
    master_slave: { master_tracker: '', other_tracker_hostnames: ['kitchen-clock'] },
    api_sources: { order: ['FlightAware', 'AirLabs', 'FR24'], enabled: { AirLabs: true, FlightAware: true, FR24: false }, airlabs_reset_day: 1, flightaware_reset_day: 15, fr24_reset_day: 1 },
  },
  secrets: {
    tomorrow_api_key: '',
    opensky_client_id: '',
    opensky_client_secret: '',
    airlabs_api_keys: ['abcd****wxyz'],
    flightaware_api_keys: ['NEWFLIGHTAWAREKEY123'],
    flightaware_monthly_limit: 4.5,
    flightradar24_key: '',
  },
});

let app: FastifyInstance;
let cookie = '';
let bearer = '';
let screen = '';
const web = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object, c = cookie) =>
  app.inject({ method, url, headers: { origin: ORIGIN, ...(c ? { cookie: c } : {}) }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  await new Promise<void>((r) => tracker.listen(0, '127.0.0.1', () => r()));
  app = await testApp({ TRACKER_URL: `http://127.0.0.1:${(tracker.address() as AddressInfo).port}` });
  const u = await registerUser(app, 'me@example.com');
  bearer = u.accessToken;
  const login = await app.inject({ method: 'POST', url: '/auth/web/login', headers: { origin: ORIGIN }, payload: { email: 'me@example.com', password: 'correct horse battery' } });
  cookie = cookieHeader(login.headers['set-cookie']);
  const dev = await app.inject({ method: 'POST', url: '/api/devices', headers: { authorization: `Bearer ${bearer}` }, payload: { name: 'Kitchen' } });
  screen = `Bearer ${dev.json<{ pairPath: string }>().pairPath.split('t=')[1] ?? ''}`;
});
afterAll(async () => {
  await app.close();
  tracker.close();
});
beforeEach(() => {
  cfg = { location: { journey_blank_filler: ' ? ', journey_code: 'MDW' }, route_cache: { enabled: true, days: 14 } };
  sec = { airlabs_api_keys: ['REALAIRLABSKEY0001wxyz'], flightradar24_key: 'FR24SECRETKEY999' };
  restarts = 0;
  wifiConnects = [];
});

describe('plane tracker settings through the hub', () => {
  it('reads the tracker settings with secrets still masked', async () => {
    const r = await web('GET', '/api/tracker-admin/settings');
    expect(r.statusCode).toBe(200);
    const body = r.json<{ configured: boolean; config: Json; secrets: Json }>();
    expect(body.configured).toBe(true);
    expect((body.config.location as Json).journey_code).toBe('MDW');
    expect(body.secrets.flightradar24_key).toBe('FR24****Y999');
    expect(JSON.stringify(body)).not.toContain('REALAIRLABSKEY0001');
  });

  it('saves everything the tracker page saves, keeps settings it doesn’t show, and keeps masked keys', async () => {
    const r = await web('PUT', '/api/tracker-admin/settings', valid());
    expect(r.statusCode).toBe(200);
    expect((cfg.display as Json).brightness).toBe(80);
    expect((cfg.api_sources as Json).order).toEqual(['FlightAware', 'AirLabs', 'FR24']);
    expect(cfg.route_cache).toEqual({ enabled: true, days: 14 }); // not on the page, kept
    expect((cfg.location as Json).journey_blank_filler).toBe(' ? '); // kept
    expect(sec.airlabs_api_keys).toEqual(['REALAIRLABSKEY0001wxyz']); // masked → unchanged
    expect(sec.flightaware_api_keys).toEqual(['NEWFLIGHTAWAREKEY123']); // new key stored
  });

  it('rejects bad values before anything reaches the tracker', async () => {
    const before = JSON.stringify(cfg);
    const cases: Array<[string, (v: ReturnType<typeof valid>) => void]> = [
      ['brightness over 100', (v) => (v.config.display.brightness = 150)],
      ['bad time', (v) => (v.config.display.night_start = '25:00')],
      ['bad RGB order', (v) => (v.config.display.led_rgb_sequence = 'XYZ')],
      ['lat out of range', (v) => (v.config.location.location_home = [123, 0])],
      ['airport code', (v) => (v.config.location.journey_code = 'chicago')],
      ['callsign with spaces', (v) => (v.config.flights.blocked_callsigns = ['N1 2'])],
      ['hostname injection', (v) => (v.config.master_slave.master_tracker = 'evil;rm -rf /')],
      ['duplicate source', (v) => (v.config.api_sources.order = ['AirLabs', 'AirLabs', 'FR24'])],
      ['key with spaces', (v) => (v.secrets.flightradar24_key = 'a b')],
    ];
    for (const [label, mutate] of cases) {
      const v = valid();
      mutate(v);
      expect((await web('PUT', '/api/tracker-admin/settings', v)).statusCode, label).toBe(400);
    }
    const extra = { ...valid(), config: { ...valid().config, sneaky: { x: 1 } } };
    expect((await web('PUT', '/api/tracker-admin/settings', extra)).statusCode, 'unknown section').toBe(400);
    expect(JSON.stringify(cfg)).toBe(before);
  });

  it('restart, system status and Wi-Fi go through', async () => {
    expect((await web('POST', '/api/tracker-admin/restart')).statusCode).toBe(200);
    expect(restarts).toBe(1);
    const st = (await web('GET', '/api/tracker-admin/status')).json<{ system: Json; usage: Json }>();
    expect(st.system.cpu_temp_c).toBe(51.2);
    expect(st.usage.AirLabs).toBe(120);
    expect((await web('GET', '/api/tracker-admin/wifi')).json<{ wifi: Json }>().wifi.connected_ssid).toBe('Home');
    expect((await web('POST', '/api/tracker-admin/wifi/scan')).json<{ scan: { networks: unknown[] } }>().scan.networks).toHaveLength(2);
    const c = await web('POST', '/api/tracker-admin/wifi/connect', { ssid: 'Guest', password: '' });
    expect(c.json()).toEqual({ success: true, message: 'Connected' });
    expect(wifiConnects).toEqual([{ ssid: 'Guest', password: '' }]);
    expect((await web('POST', '/api/tracker-admin/wifi/connect', { ssid: '' })).statusCode).toBe(400);
  });

  it('is for signed-in people only: not visitors, not kiosk screens, not other sites', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/tracker-admin/settings' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/tracker-admin/settings', headers: { authorization: screen } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/tracker-admin/restart', headers: { authorization: screen } })).statusCode).toBe(401);
    const csrf = await app.inject({ method: 'POST', url: '/api/tracker-admin/restart', headers: { cookie, origin: 'http://evil.example' } });
    expect(csrf.statusCode).toBe(403);
    expect(restarts).toBe(0);
  });

  it('explains when TRACKER_URL isn’t set or the tracker is offline', async () => {
    const none = await testApp({});
    const u = await registerUser(none, 'a@example.com');
    expect((await none.inject({ method: 'GET', url: '/api/tracker-admin/settings', headers: { authorization: `Bearer ${u.accessToken}` } })).json()).toEqual({ configured: false });
    await none.close();
    const off = await testApp({ TRACKER_URL: 'http://127.0.0.1:9' });
    const v = await registerUser(off, 'b@example.com');
    const r = await off.inject({ method: 'GET', url: '/api/tracker-admin/settings', headers: { authorization: `Bearer ${v.accessToken}` } });
    expect(r.statusCode).toBe(502);
    expect(r.json<{ message: string }>().message).toMatch(/Couldn’t reach the plane tracker/);
    await off.close();
  });
});
