import { describe, expect, it } from 'vitest';
import { registerUser, testApp } from './helpers.js';

const MIRROR = '172.30.88.30';

describe('MagicMirror start-up settings (no mirror.env)', () => {
  it('answers only the mirror container, with a fresh read-only token each start', async () => {
    const app = await testApp({ MIRROR_CLIENT_IP: MIRROR, HOME_LAT: '41.88', HOME_LON: '-87.62', UNITS: 'metric' });
    const ask = (path: string, ip = MIRROR) => app.inject({ method: 'GET', url: path, remoteAddress: ip });

    expect((await ask('/internal/mirror/bootstrap', '172.30.87.10')).statusCode).toBe(404); // Caddy / anyone else
    expect((await ask('/internal/mirror/config', '192.168.1.50')).statusCode).toBe(404);

    // No account yet: no token, and the mirror is told to check back.
    expect((await ask('/internal/mirror/bootstrap')).json()).toEqual({ token: null, lat: 41.88, lon: -87.62, units: 'metric', hasOwner: false });

    const u = await registerUser(app, 'owner@example.com');
    const first = (await ask('/internal/mirror/bootstrap')).json<{ token: string }>();
    expect(first.token).toMatch(/^hbd_/);
    const second = (await ask('/internal/mirror/bootstrap')).json<{ token: string }>();
    // The earlier token stops working; the new one reads display data only.
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: { authorization: `Bearer ${first.token}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: { authorization: `Bearer ${second.token}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/hub-settings', headers: { authorization: `Bearer ${second.token}` } })).statusCode).toBe(401);

    // It shows up (and can be revoked) under the owner's screens.
    const screens = (await app.inject({ method: 'GET', url: '/api/devices', headers: { authorization: `Bearer ${u.accessToken}` } })).json<{ devices: Array<{ name: string }> }>().devices;
    expect(screens.filter((s) => s.name === 'MagicMirror (built in)')).toHaveLength(1);
    expect((await ask('/internal/mirror/config')).json()).toEqual({ lat: 41.88, lon: -87.62, units: 'metric', hasOwner: true });
    await app.close();
  });

  it('is off without MIRROR_CLIENT_IP', async () => {
    const app = await testApp({});
    expect((await app.inject({ method: 'GET', url: '/internal/mirror/bootstrap', remoteAddress: MIRROR })).statusCode).toBe(404);
    await app.close();
  });
});
