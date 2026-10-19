import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { cookieHeader, ORIGIN, registerUser, testApp } from './helpers.js';

type View = { settings: Record<string, unknown> & { cartoApiKeySet: boolean; cartoApiKeyHint: string }; info: { leftoverEnvKeys: string[]; timezone: string; trackerLeads: boolean } };

async function signIn(app: FastifyInstance, email: string): Promise<{ bearer: string; cookie: string }> {
  const u = await registerUser(app, email);
  const login = await app.inject({ method: 'POST', url: '/auth/web/login', headers: { origin: ORIGIN }, payload: { email, password: 'correct horse battery' } });
  return { bearer: `Bearer ${u.accessToken}`, cookie: cookieHeader(login.headers['set-cookie']) };
}
const editable = (v: View['settings']): Record<string, unknown> => {
  const { cartoApiKeySet: _a, cartoApiKeyHint: _b, ...rest } = v;
  return rest;
};

describe('hub settings (Settings → Hub)', () => {
  it('starts from what hub.env had, and lists hub.env lines that are no longer read', async () => {
    const app = await testApp({ RADAR_RADIUS_NM: '42', BACKUP_KEEP: '7', ALLOW_REGISTRATION: 'true', CARTO_API_KEY: 'abcd1234efgh5678', ADSB_CONTACT: 'me@example.com', TZ: 'America/Chicago' });
    const { bearer } = await signIn(app, 's@example.com');
    const v = (await app.inject({ method: 'GET', url: '/api/hub-settings', headers: { authorization: bearer } })).json<View>();
    expect(v.settings).toMatchObject({ radarRadiusNm: 42, backupKeep: 7, allowRegistration: true, adsbContact: 'me@example.com', cartoApiKeySet: true, cartoApiKeyHint: 'abcd…5678' });
    expect(v.info.leftoverEnvKeys.sort()).toEqual(['ADSB_CONTACT', 'ALLOW_REGISTRATION', 'BACKUP_KEEP', 'CARTO_API_KEY', 'RADAR_ENABLED', 'RADAR_RADIUS_NM']);
    expect(v.info.timezone).toBe('America/Chicago');
    // The key itself never goes to the browser, and is stored encrypted.
    expect(JSON.stringify(v)).not.toContain('abcd1234efgh5678');
    const row = app.ctx.db.prepare(`SELECT value FROM hub_settings WHERE key = 'secret.cartoApiKey'`).get() as { value: string };
    expect(row.value.startsWith('v1.')).toBe(true);
    expect(row.value).not.toContain('abcd1234');
    await app.close();
  });

  it('has a Home radar range (default 10 mi, a few fixed choices), kept when older saved settings lack it', async () => {
    const app = await testApp({});
    const { bearer, cookie } = await signIn(app, 'r@example.com');
    const cur = editable((await app.inject({ method: 'GET', url: '/api/hub-settings', headers: { authorization: bearer } })).json<View>().settings);
    expect(cur.homeRadarMi).toBe(10);
    const config = async (): Promise<Record<string, unknown>> => (await app.inject({ method: 'GET', url: '/api/config', headers: { authorization: bearer } })).json<Record<string, unknown>>();
    expect(await config()).toMatchObject({ homeRadarMi: 10 });
    const put = (homeRadarMi: unknown) => app.inject({ method: 'PUT', url: '/api/hub-settings', headers: { origin: ORIGIN, cookie }, payload: { ...cur, homeRadarMi } });
    expect((await put(7)).statusCode).toBe(400);
    expect((await put(5)).statusCode).toBe(200);
    expect(await config()).toMatchObject({ homeRadarMi: 5 });
    // A row saved by an older version has no homeRadarMi: it still loads, with the default.
    const { homeRadarMi: _gone, ...older } = app.ctx.settings.values;
    app.ctx.db.prepare(`UPDATE hub_settings SET value = ? WHERE key = 'settings'`).run(JSON.stringify(older));
    const { HubSettingsService } = await import('../src/services/hubSettings.js');
    const reloaded = new HubSettingsService(app.ctx.db, app.ctx.secretBox, app.ctx.env);
    expect(reloaded.values.homeRadarMi).toBe(10);
    expect(reloaded.values.radarRadiusNm).toBe(app.ctx.settings.values.radarRadiusNm);
    await app.close();
  });

  it('saves changes that apply straight away', async () => {
    const app = await testApp({ ALLOW_REGISTRATION: 'false', HOME_LAT: '41.9', HOME_LON: '-87.6' });
    const { bearer, cookie } = await signIn(app, 'first@example.com');
    const get = async (): Promise<View> => (await app.inject({ method: 'GET', url: '/api/hub-settings', headers: { authorization: bearer } })).json<View>();
    const cur = editable((await get()).settings);

    // Sign-up is closed (an account exists)…
    expect((await app.inject({ method: 'GET', url: '/auth/web/options' })).json()).toMatchObject({ registration: false });
    const r = await app.inject({ method: 'PUT', url: '/api/hub-settings', headers: { origin: ORIGIN, cookie }, payload: { ...cur, allowRegistration: true, radarEnabled: false, radarRadiusNm: 50, accessTokenTtlMin: 10, cartoApiKey: 'newkey-123456789' } });
    expect(r.statusCode).toBe(200);
    // …and open now, without a restart.
    expect((await app.inject({ method: 'GET', url: '/auth/web/options' })).json()).toMatchObject({ registration: true });
    const cfg = (await app.inject({ method: 'GET', url: '/api/config', headers: { authorization: bearer } })).json<Record<string, unknown>>();
    expect(cfg).toMatchObject({ radarEnabled: false, radarOff: 'disabled', radarRadiusNm: 50, mapKey: true });
    expect(app.ctx.settings.cartoApiKey).toBe('newkey-123456789');
    const login = await app.inject({ method: 'POST', url: '/auth/web/login', headers: { origin: ORIGIN }, payload: { email: 'first@example.com', password: 'correct horse battery' } });
    expect(String(login.headers['set-cookie'])).toMatch(/Max-Age=600/);

    // Blank key keeps it; null removes it.
    const after = editable((await get()).settings);
    await app.inject({ method: 'PUT', url: '/api/hub-settings', headers: { origin: ORIGIN, cookie }, payload: { ...after, cartoApiKey: '' } });
    expect(app.ctx.settings.cartoApiKey).toBe('newkey-123456789');
    await app.inject({ method: 'PUT', url: '/api/hub-settings', headers: { origin: ORIGIN, cookie }, payload: { ...after, cartoApiKey: null } });
    expect(app.ctx.settings.cartoApiKey).toBe('');
    await app.close();
  });

  it('validates every value and is for signed-in people only', async () => {
    const app = await testApp({});
    const { bearer, cookie } = await signIn(app, 'v@example.com');
    const cur = editable((await app.inject({ method: 'GET', url: '/api/hub-settings', headers: { authorization: bearer } })).json<View>().settings);
    const bad: Array<[string, Record<string, unknown>]> = [
      ['radius', { radarRadiusNm: 500 }],
      ['ttl', { accessTokenTtlMin: 0 }],
      ['hour', { backupHour: 24 }],
      ['home', { home: { lat: 95, lon: 0 } }],
      ['units', { units: 'nautical' }],
      ['log level', { logLevel: 'trace' }],
      ['contact newline', { adsbContact: 'a\r\nX-Evil: 1' }],
      ['key chars', { cartoApiKey: 'has spaces' }],
      ['unknown field', { surprise: true }],
    ];
    for (const [label, patch] of bad) {
      const r = await app.inject({ method: 'PUT', url: '/api/hub-settings', headers: { origin: ORIGIN, cookie }, payload: { ...cur, ...patch } });
      expect(r.statusCode, label).toBe(400);
    }
    const dev = await app.inject({ method: 'POST', url: '/api/devices', headers: { authorization: bearer }, payload: { name: 'Kitchen' } });
    const screen = `Bearer ${dev.json<{ pairPath: string }>().pairPath.split('t=')[1] ?? ''}`;
    expect((await app.inject({ method: 'GET', url: '/api/hub-settings', headers: { authorization: screen } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/hub-settings', headers: { cookie, origin: 'http://evil.example' }, payload: cur })).statusCode).toBe(403);
    await app.close();
  });

  it('keeps saved settings over hub.env on the next start', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-settings-'));
    const db = path.join(dir, 'hub.db');
    const a = await testApp({ DB_PATH: db, RADAR_RADIUS_NM: '30' });
    const { bearer, cookie } = await signIn(a, 'k@example.com');
    const cur = editable((await a.inject({ method: 'GET', url: '/api/hub-settings', headers: { authorization: bearer } })).json<View>().settings);
    await a.inject({ method: 'PUT', url: '/api/hub-settings', headers: { origin: ORIGIN, cookie }, payload: { ...cur, radarRadiusNm: 60 } });
    await a.close();
    const b = await testApp({ DB_PATH: db, RADAR_RADIUS_NM: '30' });
    expect(b.ctx.settings.values.radarRadiusNm).toBe(60);
    await b.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
