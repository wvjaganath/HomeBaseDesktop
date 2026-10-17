import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cookieHeader, registerUser, testApp } from './helpers.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  await app.close();
});

describe('iOS token auth (unchanged contract)', () => {
  it('registers, logs in and returns the same shape as before', async () => {
    await registerUser(app, 'a@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'A@example.com', password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe('a@example.com');
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('rejects wrong passwords and unknown emails identically', async () => {
    await registerUser(app, 'a@example.com');
    const wrong = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a@example.com', password: 'wrong password!!' } });
    const unknown = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'b@example.com', password: 'wrong password!!' } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const u = await registerUser(app, 'a@example.com');
    const first = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: u.refreshToken } });
    expect(first.statusCode).toBe(200);
    const rotated = first.json<{ refreshToken: string }>().refreshToken;
    // Replaying the old token kills the chain…
    const replay = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: u.refreshToken } });
    expect(replay.statusCode).toBe(401);
    // …including the token that was legitimately rotated.
    const after = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: rotated } });
    expect(after.statusCode).toBe(401);
  });

  it('refuses registration when disabled', async () => {
    const closed = await testApp({ ALLOW_REGISTRATION: 'false' });
    const res = await closed.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'x@example.com', password: 'correct horse battery', displayName: 'X' },
    });
    expect(res.statusCode).toBe(403);
    await closed.close();
  });
});

describe('web cookie auth', () => {
  it('sets httpOnly SameSite=Strict cookies and never returns tokens in the body', async () => {
    await registerUser(app, 'a@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/web/login',
      headers: { origin: 'http://localhost:80' },
      payload: { email: 'a@example.com', password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toMatch(/Token/);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.length).toBe(2);
    for (const c of cookies) {
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=Strict/i);
    }
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: cookieHeader(res.headers['set-cookie']) } });
    expect(me.statusCode).toBe(200);
    expect(me.json().kind).toBe('user');
  });

  it('rejects cross-origin login attempts (login CSRF)', async () => {
    await registerUser(app, 'a@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/web/login',
      headers: { origin: 'http://evil.example' },
      payload: { email: 'a@example.com', password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects cookie-authenticated writes from another origin', async () => {
    await registerUser(app, 'a@example.com');
    const login = await app.inject({
      method: 'POST',
      url: '/auth/web/login',
      headers: { origin: 'http://localhost:80' },
      payload: { email: 'a@example.com', password: 'correct horse battery' },
    });
    const cookie = cookieHeader(login.headers['set-cookie']);
    const res = await app.inject({ method: 'POST', url: '/api/devices', headers: { cookie, origin: 'http://evil.example' }, payload: { name: 'x' } });
    expect(res.statusCode).toBe(403);
    const missing = await app.inject({ method: 'POST', url: '/api/devices', headers: { cookie }, payload: { name: 'x' } });
    expect(missing.statusCode).toBe(403);
  });
});

describe('kiosk device tokens', () => {
  it('pairs via link, can read, cannot write, and stops working when revoked', async () => {
    const u = await registerUser(app, 'a@example.com');
    const auth = { authorization: `Bearer ${u.accessToken}` };
    const created = await app.inject({ method: 'POST', url: '/api/devices', headers: auth, payload: { name: 'Kitchen' } });
    expect(created.statusCode).toBe(200);
    const { id, pairPath } = created.json<{ id: string; pairPath: string }>();

    const pair = await app.inject({ method: 'GET', url: pairPath });
    expect(pair.statusCode).toBe(303);
    expect(pair.headers.location).toBe('/#/kiosk');
    const cookie = cookieHeader(pair.headers['set-cookie']);

    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(me.json().kind).toBe('device');
    const lists = await app.inject({ method: 'GET', url: '/api/lists', headers: { cookie } });
    expect(lists.statusCode).toBe(200);

    // Read-only: sync, device management and calendar settings are refused.
    const push = await app.inject({ method: 'POST', url: '/sync/push', headers: { cookie, origin: 'http://localhost:80' }, payload: { changes: [] } });
    expect(push.statusCode).toBe(401);
    const devices = await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie } });
    expect(devices.statusCode).toBe(401);

    const revoke = await app.inject({ method: 'DELETE', url: `/api/devices/${id}`, headers: auth });
    expect(revoke.statusCode).toBe(200);
    const afterRevoke = await app.inject({ method: 'GET', url: '/api/lists', headers: { cookie } });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it('rejects malformed and unknown pairing tokens', async () => {
    const bad = await app.inject({ method: 'GET', url: '/kiosk/pair?t=hbd_nope' });
    expect(bad.statusCode).toBe(401);
    const unknown = await app.inject({ method: 'GET', url: `/kiosk/pair?t=hbd_${'A'.repeat(43)}` });
    expect(unknown.statusCode).toBe(401);
  });
});

describe('retired legacy site', () => {
  it('redirects old bookmarks to the new Weight loss screen', async () => {
    for (const url of ['/legacy', '/legacy/', '/legacy/index.html']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(301);
      expect(res.headers.location).toBe('/#/fitness');
    }
  });
});

describe('security headers', () => {
  it('sends a strict CSP and permissions policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(String(res.headers['permissions-policy'])).toContain('camera=()');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});
