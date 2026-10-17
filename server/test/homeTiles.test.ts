import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { HomeLocation } from '../src/services/home.js';
import { settingsFromEnv } from '../src/services/hubSettings.js';
import { keyFingerprint, tileDeps, tileStatus } from '../src/routes/tiles.js';
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

describe('map tiles through the hub', () => {
  it('checks the tile address, needs a signed-in viewer, and serves from its cache', async () => {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-tiles-'));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await fs.mkdir(path.join(data, 'cache', 'tiles-v2'), { recursive: true });
    await fs.writeFile(path.join(data, 'cache', 'tiles-v2', `${keyFingerprint('test-key-123456')}-10-262-380-2x.png`), png);
    const app = await testApp({ DATA_DIR: data, CARTO_API_KEY: 'test-key-123456' });
    const auth = { authorization: `Bearer ${(await registerUser(app, 't@example.com')).accessToken}` };

    expect((await app.inject({ method: 'GET', url: '/api/tiles/10/262/380@2x.png' })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/api/tiles/10/262/380@2x.png', headers: auth });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.rawPayload).toEqual(png);
    for (const bad of ['/api/tiles/10/1024/1.png', '/api/tiles/10/1/1024.png', '/api/tiles/0/0/0.png', '/api/tiles/15/0/0.png', '/api/tiles/10/1/1.jpg', '/api/tiles/10/1/..%2F..%2Fx.png']) {
      expect((await app.inject({ method: 'GET', url: bad, headers: auth })).statusCode, bad).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url: '/api/status', headers: auth })).json()).toMatchObject({ mapTiles: { key: true } });
    await app.close();
    await fs.rm(data, { recursive: true, force: true });
  });

  it('rejects a malformed CARTO_API_KEY at startup', () => {
    expect(() => env({ CARTO_API_KEY: 'has spaces in it' })).toThrow();
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

describe('CARTO tiles: key, watermark and caching', () => {
  const PNG = (tag: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]);
  it('sends the key to CARTO’s keyed address, never caches the "API KEY REQUIRED" tile, and re-fetches when the key changes', async () => {
    const seen: string[] = [];
    let mode: 'watermark' | 'ok' | 'refused' = 'watermark';
    const real = tileDeps.fetch;
    tileDeps.fetch = (async (url: string) => {
      seen.push(url);
      const u = new URL(url);
      const status = mode === 'refused' ? 403 : 200;
      const etag = mode === 'watermark' || !u.searchParams.get('key') ? '"wm-abc"' : '"real-1"';
      const body = mode === 'refused' ? Buffer.from('no') : PNG(etag);
      return Object.assign(new Response(null, { status, headers: { etag } }), { bodyBuffer: body, bodyText: body.toString() });
    });
    try {
      const os = await import('node:os');
      const path = await import('node:path');
      const fs = await import('node:fs/promises');
      const data = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-tiles2-'));
      const app = await testApp({ DATA_DIR: data });
      const u = await registerUser(app, 'm@example.com');
      const auth = { authorization: `Bearer ${u.accessToken}` };
      const tile = () => app.inject({ method: 'GET', url: '/api/tiles/6/16/23.png?v=x', headers: auth });

      // No key: CARTO answers with its watermark; shown but not kept.
      let r = await tile();
      expect(r.statusCode).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(tileStatus.last?.result).toBe('watermark');
      expect(seen[0]).toBe('https://basemaps.cartocdn.com/rastertiles/dark_all/6/16/23.png');

      // Save a key: the very next request goes to CARTO with it and is cached.
      app.ctx.settings.update({ ...app.ctx.settings.values, cartoApiKey: 'my-carto-key-1' }, u.id);
      const before = (await app.inject({ method: 'GET', url: '/api/config', headers: auth })).json<{ mapTilesVersion: string }>().mapTilesVersion;
      expect(before).not.toBe('nokey');
      mode = 'ok';
      seen.length = 0;
      r = await tile();
      expect(r.headers['cache-control']).toBe('private, max-age=86400');
      expect(r.rawPayload.toString()).toContain('real-1');
      expect(seen).toEqual(['https://basemaps.cartocdn.com/rastertiles/dark_all/6/16/23.png?key=my-carto-key-1']);
      expect(tileStatus.last?.result).toBe('ok');
      seen.length = 0;
      await tile();
      expect(seen).toEqual([]); // from the hub's cache

      // A refused key is reported, not hidden.
      app.ctx.settings.update({ ...app.ctx.settings.values, cartoApiKey: 'other-key-22' }, u.id);
      mode = 'refused';
      r = await tile();
      expect(r.statusCode).toBe(502);
      expect(tileStatus.last).toMatchObject({ result: 'refused', httpStatus: 403 });
      expect((await app.inject({ method: 'GET', url: '/api/status', headers: auth })).json()).toMatchObject({ mapTiles: { key: true, last: { result: 'refused' } } });
      await app.close();
      await fs.rm(data, { recursive: true, force: true });
    } finally {
      tileDeps.fetch = real;
    }
  });
});
