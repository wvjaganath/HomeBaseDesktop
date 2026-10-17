import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { cookieHeader, registerUser, testApp } from './helpers.js';

const login = { email: 'h@example.com', password: 'correct horse battery' };

describe('HTTPS behind the trusted proxy (COOKIE_SECURE=auto)', () => {
  it('uses __Host- Secure cookies for requests that came through HTTPS', async () => {
    const app = await testApp({ TRUST_PROXY: '127.0.0.1', COOKIE_SECURE: 'auto' });
    await registerUser(app, login.email);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/web/login',
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'hub.lan', origin: 'https://hub.lan' },
      payload: login,
    });
    expect(res.statusCode).toBe(200);
    const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(set.some((c) => c.startsWith('__Host-hb_at=') && /;\s*Secure/i.test(c))).toBe(true);

    const cookie = cookieHeader(res.headers['set-cookie']);
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie, 'x-forwarded-proto': 'https', 'x-forwarded-host': 'hub.lan' } });
    expect(me.statusCode).toBe(200);
    // The same Secure cookie is not honoured on the plain-HTTP port.
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(401);
    await app.close();
  });

  it('keeps plain cookies on the LAN http port, and ignores forwarded headers from untrusted peers', async () => {
    const app = await testApp({ TRUST_PROXY: '10.9.9.9', COOKIE_SECURE: 'auto' });
    await registerUser(app, login.email);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/web/login',
      // Spoofed: 127.0.0.1 is not the trusted proxy, so this stays http://localhost:80.
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example', origin: 'http://localhost:80' },
      payload: login,
    });
    expect(res.statusCode).toBe(200);
    const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(set.some((c) => c.startsWith('hb_at=') && !/;\s*Secure/i.test(c))).toBe(true);
    await app.close();
  });

  it('rejects TRUST_PROXY=true and malformed values', () => {
    const base = { JWT_SECRET: 'x'.repeat(40), NODE_ENV: 'test' };
    expect(() => loadEnv({ ...base, TRUST_PROXY: 'true' })).toThrow();
    expect(() => loadEnv({ ...base, TRUST_PROXY: 'caddy' })).toThrow();
    expect(loadEnv({ ...base, TRUST_PROXY: '172.30.87.10, 10.0.0.0/8' }).TRUST_PROXY).toEqual(['172.30.87.10', '10.0.0.0/8']);
    expect(loadEnv({ ...base }).TRUST_PROXY).toBe(false);
  });
});
