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
