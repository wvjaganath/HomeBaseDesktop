import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// No real network: every host "resolves" to a public address, and fetch is faked below.
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }));

const { loadEnv } = await import('../src/env.js');
const { EventBus } = await import('../src/events.js');
const { RadarService } = await import('../src/services/radar.js');

const calls: string[] = [];
const urls: string[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.hostname);
    urls.push(url.pathname);
    if (url.hostname === 'api.adsb.lol' && !boxMode) return new Response('slow down', { status: 429 });
    return new Response(JSON.stringify({ ac: [
      { hex: 'abc123', flight: 'UAL1 ', lat: 41.9, lon: -87.6, alt_baro: 9000, gs: 300, track: 90, seen_pos: 1 },
      { hex: 'def456', flight: 'AAL2 ', lat: 41.98, lon: -87.9, alt_baro: 3000, gs: 200, track: 270, seen_pos: 1 }, // O'Hare, outside the box
    ] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

let boxMode = false;
const log = { info() {}, warn() {}, debug() {}, error() {}, child() { return log; } } as never;

describe('radar and a provider that says "too many requests"', () => {
  it('leaves adsb.lol alone for a while after HTTP 429 and uses adsb.fi meanwhile', async () => {
    const env = loadEnv({ JWT_SECRET: 'x'.repeat(40), HOME_LAT: '41.88', HOME_LON: '-87.62', TRACKER_URL: '' });
    const radar = new RadarService(env, new EventBus(), log);
    const poll = (): Promise<void> => (radar as unknown as { poll(): Promise<void> }).poll();
    await poll();
    await poll();
    await poll();
    expect(calls.filter((h) => h === 'api.adsb.lol')).toHaveLength(1); // asked once, then paused
    expect(calls.filter((h) => h === 'opendata.adsb.fi')).toHaveLength(3);
    expect(radar.snapshot.data.aircraft.map((a) => a.callsign)).toEqual(['UAL1', 'AAL2']);
  });
});

describe('radar limited to the plane tracker’s box', () => {
  it('asks only for the circle around the box and keeps only planes inside it', async () => {
    boxMode = true;
    urls.length = 0;
    const { HomeLocation, parseZone } = await import('../src/services/home.js');
    const { circleAround } = await import('../src/services/radar.js');
    const zone = parseZone({ tl_y: 41.92, tl_x: -87.66, br_y: 41.86, br_x: -87.58 });
    expect(zone).toEqual({ top: 41.92, left: -87.66, bottom: 41.86, right: -87.58 });
    // Unusable boxes: unset (0s), upside down, absurdly large, not numbers.
    for (const bad of [{ tl_y: 0, tl_x: 0, br_y: 0, br_x: 0 }, { tl_y: 41.8, tl_x: -87.6, br_y: 41.9, br_x: -87.5 }, { tl_y: 50, tl_x: -100, br_y: 30, br_x: -80 }, { tl_y: '41.9' }, null]) {
      expect(parseZone(bad)).toBeNull();
    }
    if (!zone) throw new Error('zone should parse');
    const c = circleAround(zone);
    expect(c.nm).toBeLessThanOrEqual(4); // a few nautical miles, not 30

    const env = loadEnv({ JWT_SECRET: 'x'.repeat(40), HOME_LAT: '41.88', HOME_LON: '-87.62', TRACKER_URL: '' });
    const home = Object.assign(Object.create(HomeLocation.prototype) as InstanceType<typeof HomeLocation>, {
      get: () => ({ lat: 41.88, lon: -87.62 }),
      onChange: () => () => undefined,
    });
    Object.defineProperty(home, 'zone', { get: () => zone });
    Object.defineProperty(home, 'units', { get: () => 'imperial' });
    const radar = new RadarService(env, new EventBus(), log, home);
    await (radar as unknown as { poll(): Promise<void> }).poll();
    expect(urls.at(-1)).toBe(`/v2/lat/${Number(c.lat.toFixed(4))}/lon/${Number(c.lon.toFixed(4))}/dist/${c.nm}`);
    expect(radar.snapshot.data.area).toEqual(zone);
    expect(radar.snapshot.data.aircraft.map((a) => a.callsign)).toEqual(['UAL1']); // O'Hare's AAL2 is outside the box
  });
});
