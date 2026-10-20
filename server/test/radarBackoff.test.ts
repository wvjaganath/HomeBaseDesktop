import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// No real network: every host "resolves" to a public address, and fetch is faked below.
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }));

const { loadEnv } = await import('../src/env.js');
const { EventBus } = await import('../src/events.js');
const { RadarService } = await import('../src/services/radar.js');

const calls: string[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.hostname);
    if (url.hostname === 'api.adsb.lol') return new Response('slow down', { status: 429 });
    return new Response(JSON.stringify({ ac: [{ hex: 'abc123', flight: 'UAL1 ', lat: 41.9, lon: -87.6, alt_baro: 9000, gs: 300, track: 90, seen_pos: 1 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

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
    expect(radar.snapshot.data.aircraft.map((a) => a.callsign)).toEqual(['UAL1']);
  });
});

describe('radar polling interval', () => {
  it('asks once per interval (15 s by default) while a screen is watching', async () => {
    vi.useFakeTimers();
    try {
      const env = loadEnv({ JWT_SECRET: 'x'.repeat(40), HOME_LAT: '41.88', HOME_LON: '-87.62', TRACKER_URL: '' });
      const radar = new RadarService(env, new EventBus(), log);
      const polls = (): number => calls.filter((h) => h === 'opendata.adsb.fi').length; // every poll ends at adsb.fi here
      const before = polls();
      radar.touch(); // a screen asked for radar data
      await vi.advanceTimersByTimeAsync(31_000);
      radar.stop();
      expect(polls() - before).toBe(3); // at 0, 15 and 30 seconds
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('radar planes carry their from/to', () => {
  it('uses the tracker’s route for planes in the box, else adsbdb’s usual route when the plane fits it, looked up a few at a time', async () => {
    const env = loadEnv({ JWT_SECRET: 'x'.repeat(40), HOME_LAT: '41.88', HOME_LON: '-87.62', TRACKER_URL: '' });
    const cache = new Map<string, unknown>();
    const asked: string[] = [];
    const routes = {
      peekRoute: (cs: string) => (cache.has(cs) ? cache.get(cs) : undefined),
      route: async (cs: string) => {
        asked.push(cs);
        const r = cs === 'UAL1'
          ? { airline: null, origin: { code: 'EWR', name: '', city: '', lat: 40.69, lon: -74.17 }, destination: { code: 'ORD', name: '', city: '', lat: 41.98, lon: -87.9 } }
          : { airline: null, origin: { code: 'MCO', name: '', city: '', lat: 28.43, lon: -81.31 }, destination: { code: 'EWR', name: '', city: '', lat: 40.69, lon: -74.17 } };
        cache.set(cs, r);
        return r;
      },
    };
    const tracked = [{ callsign: 'AAL7', origin: { code: 'DFW' }, destination: { code: 'ORD' }, routeSource: 'tracker' }];
    const radar = new RadarService(env, new EventBus(), log, undefined, undefined, {
      routes: routes as never,
      trackerFlights: () => tracked as never,
    });
    const feed = { ac: [
      { hex: 'aaa001', flight: 'AAL7 ', lat: 41.9, lon: -87.65, alt_baro: 3000, gs: 180, track: 270, seen_pos: 1 },
      { hex: 'aaa002', flight: 'UAL1 ', lat: 41.95, lon: -87.7, alt_baro: 6000, gs: 250, track: 270, seen_pos: 1 },
      { hex: 'aaa003', flight: 'UAL9 ', lat: 41.85, lon: -87.6, alt_baro: 7000, gs: 260, track: 270, seen_pos: 1 },
    ] };
    const ingest = (): void => (radar as unknown as { ingest(raw: unknown, source: string): void }).ingest(feed, 'test');
    ingest();
    let byCs = Object.fromEntries(radar.snapshot.data.aircraft.map((a) => [a.callsign, a.route]));
    expect(byCs.AAL7).toEqual({ from: 'DFW', to: 'ORD', source: 'fr24' });
    expect(byCs.UAL1).toBeNull(); // not looked up yet…
    await new Promise((r) => setTimeout(r, 0));
    expect(asked.sort()).toEqual(['UAL1', 'UAL9']); // …asked for in the background
    ingest();
    byCs = Object.fromEntries(radar.snapshot.data.aircraft.map((a) => [a.callsign, a.route]));
    expect(byCs.UAL1).toEqual({ from: 'EWR', to: 'ORD', source: 'schedule' });
    expect(byCs.UAL9).toBeNull(); // MCO → EWR can't be a plane over Chicago
  });
});
