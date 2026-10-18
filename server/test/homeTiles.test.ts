import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { HomeLocation } from '../src/services/home.js';
import { settingsFromEnv } from '../src/services/hubSettings.js';
import { registerUser, testApp } from './helpers.js';

/** A tracker whose saved settings have a home location. */
let home: unknown = [41.8827, -87.6232];
const tracker = http.createServer((req, res) => {
  res.writeHead(req.url === '/api/config' ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(req.url === '/api/config' ? { config: { location: { location_home: home } }, secrets: {} } : {}));
});
let trackerUrl = '';
beforeAll(async () => {
  await new Promise<void>((r) => tracker.listen(0, '127.0.0.1', () => r()));
  trackerUrl = `http://127.0.0.1:${(tracker.address() as AddressInfo).port}`;
});
afterAll(() => {
  tracker.close();
});

const env = (o: Record<string, string>) => loadEnv({ JWT_SECRET: 'x'.repeat(40), ...o });

describe('home location', () => {
  it('uses Settings when there is no plane tracker', async () => {
    const e = env({ HOME_LAT: '40.1', HOME_LON: '-88.2', UNITS: 'metric' });
    const h = new HomeLocation(e, undefined, settingsFromEnv(e));
    await h.refresh();
    expect(h.get()).toEqual({ lat: 40.1, lon: -88.2 });
    expect(h.units).toBe('metric');
    expect(h.source).toBe('settings');
    expect(h.trackerLeads).toBe(false);
  });

  it('follows the plane tracker’s Location settings (one place to set them), ignoring 0, 0 or junk', async () => {
    home = [41.8827, -87.6232];
    const e = env({ HOME_LAT: '40.1', HOME_LON: '-88.2', TRACKER_URL: trackerUrl });
    const h = new HomeLocation(e, undefined, settingsFromEnv(e));
    expect(h.get()).toEqual({ lat: 40.1, lon: -88.2 }); // until the tracker answers
    let changes = 0;
    h.onChange(() => changes++);
    await h.refresh();
    expect(h.get()).toEqual({ lat: 41.8827, lon: -87.6232 });
    expect(h.source).toBe('tracker');
    expect(changes).toBe(1);
    await h.refresh();
    expect(changes).toBe(1); // unchanged: no event

    for (const bad of [[0, 0], ['41', '-87'], [91, 0], 'x', null]) {
      home = bad;
      const g = new HomeLocation(env({ TRACKER_URL: trackerUrl }));
      await g.refresh();
      expect(g.get()).toBeNull();
    }
  });

  it('turns the radar on once the tracker’s home is known, and says why it was off', async () => {
    home = [41.8827, -87.6232];
    const app = await testApp({ TRACKER_URL: trackerUrl, RADAR_ENABLED: 'true' });
    const auth = { authorization: `Bearer ${(await registerUser(app, 'h@example.com')).accessToken}` };
    const before = (await app.inject({ method: 'GET', url: '/api/config', headers: auth })).json<{ radarEnabled: boolean; radarOff: string; mapKey: boolean }>();
    expect(before).toMatchObject({ radarEnabled: false, radarOff: 'no_home', mapKey: false });
    app.ctx.radar.start();
    await app.ctx.home.refresh();
    const after = (await app.inject({ method: 'GET', url: '/api/config', headers: auth })).json<{ radarEnabled: boolean; radarOff: string | null; home: object; homeSource: string }>();
    expect(after).toMatchObject({ radarEnabled: true, radarOff: null, home: { lat: 41.8827, lon: -87.6232 }, homeSource: 'tracker' });
    expect(app.ctx.radar.snapshot.data.home).toEqual({ lat: 41.8827, lon: -87.6232 });
    await app.close();
  });

  it('reports RADAR_ENABLED=false as the reason when that is it', async () => {
    const app = await testApp({ HOME_LAT: '41', HOME_LON: '-87', RADAR_ENABLED: 'false' });
    const auth = { authorization: `Bearer ${(await registerUser(app, 'o@example.com')).accessToken}` };
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: auth })).json()).toMatchObject({ radarEnabled: false, radarOff: 'disabled' });
    await app.close();
  });
});

describe('home-network-only fetches (addresses typed into Settings)', () => {
  it('knows home-network addresses from everything else', async () => {
    const { isLanAddress, safeFetch } = await import('../src/security/safeFetch.js');
    for (const ip of ['10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.60', '100.64.0.1', 'fd00::1', '::ffff:192.168.1.2']) expect(isLanAddress(ip), ip).toBe(true);
    for (const ip of ['127.0.0.1', '169.254.169.254', '0.0.0.0', '8.8.8.8', '172.32.0.1', '::1', 'fe80::1', '2001:4860::8888']) expect(isLanAddress(ip), ip).toBe(false);
    await expect(safeFetch('http://127.0.0.1:9/x', { allowHosts: ['127.0.0.1'], allowHttp: true, allowPrivate: true, lanOnly: true })).rejects.toThrow(/home-network/);
  });
});

describe('map tiles (CARTO terms: straight from CARTO, never relayed or stored by the hub)', () => {
  it('gives screens CARTO’s keyed tile address and allows it in the page policy', async () => {
    const app = await testApp({});
    const u = await registerUser(app, 'map@example.com');
    const auth = { authorization: `Bearer ${u.accessToken}` };
    const before = (await app.inject({ method: 'GET', url: '/api/config', headers: auth })).json<{ mapTileUrl: string; mapKey: boolean }>();
    expect(before).toMatchObject({ mapKey: false, mapTileUrl: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png' });
    app.ctx.settings.update({ ...app.ctx.settings.values, cartoApiKey: 'my-carto-key-1' }, u.id);
    const after = (await app.inject({ method: 'GET', url: '/api/config', headers: auth })).json<{ mapTileUrl: string; mapKey: boolean }>();
    expect(after).toMatchObject({ mapKey: true, mapTileUrl: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=my-carto-key-1' });
    // No tile relay on the hub any more.
    expect((await app.inject({ method: 'GET', url: '/api/tiles/6/16/23.png', headers: auth })).statusCode).toBe(404);
    const page = await app.inject({ method: 'GET', url: '/health' });
    expect(String(page.headers['content-security-policy'])).toContain('https://basemaps.cartocdn.com');
    // Signed-out visitors don't get it.
    expect((await app.inject({ method: 'GET', url: '/api/config' })).statusCode).toBe(401);
    await app.close();
  });

  it('rejects a malformed CARTO_API_KEY at startup', () => {
    expect(() => env({ CARTO_API_KEY: 'has spaces in it' })).toThrow();
  });
});
