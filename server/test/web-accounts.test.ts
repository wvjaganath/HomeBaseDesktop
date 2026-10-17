import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createResetToken } from '../src/services/userAdmin.js';
import { cookieHeader, ORIGIN, registerUser, testApp } from './helpers.js';

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

const web = (method: 'GET' | 'POST', url: string, payload?: object, cookie = '') =>
  app.inject({ method, url, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) }, ...(payload ? { payload } : {}) });
const signIn = async (email: string, password: string) => {
  const r = await web('POST', '/auth/web/login', { email, password });
  return { status: r.statusCode, cookie: cookieHeader(r.headers['set-cookie']) };
};

describe('sign-up from the browser', () => {
  it('with sign-up off, allows only the very first account', async () => {
    app = await testApp({ ALLOW_REGISTRATION: 'false' });
    expect((await web('GET', '/auth/web/options')).json()).toEqual({ registration: true, firstAccount: true });
    const r = await web('POST', '/auth/web/register', { email: 'A@example.com', displayName: 'A', password: 'long-enough-1' });
    expect(r.statusCode).toBe(200);
    expect((await web('GET', '/auth/me', undefined, cookieHeader(r.headers['set-cookie']))).json<{ user: { email: string } }>().user.email).toBe('a@example.com');
    // Now locked: the screen stops offering it and the server refuses.
    expect((await web('GET', '/auth/web/options')).json()).toEqual({ registration: false, firstAccount: false });
    expect((await web('POST', '/auth/web/register', { email: 'b@example.com', displayName: 'B', password: 'long-enough-2' })).statusCode).toBe(403);
    // The iPhone app's sign-up follows the same rule.
    expect((await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'c@example.com', displayName: 'C', password: 'long-enough-3' } })).statusCode).toBe(403);
  });

  it('the iPhone app can also create the first account', async () => {
    app = await testApp({ ALLOW_REGISTRATION: 'false' });
    const r = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'me@example.com', displayName: 'Me', password: 'long-enough-1' } });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ accessToken: string }>().accessToken).toBeTruthy();
  });

  it('two people racing to create the first account: only one wins', async () => {
    app = await testApp({ ALLOW_REGISTRATION: 'false' });
    const [a, b] = await Promise.all([
      web('POST', '/auth/web/register', { email: 'a@example.com', displayName: 'A', password: 'long-enough-1' }),
      web('POST', '/auth/web/register', { email: 'b@example.com', displayName: 'B', password: 'long-enough-2' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 403]);
  });

  it('with ALLOW_REGISTRATION=true, anyone can sign up', async () => {
    app = await testApp({ ALLOW_REGISTRATION: 'true' });
    expect((await web('POST', '/auth/web/register', { email: 'a@example.com', displayName: 'A', password: 'long-enough-1' })).statusCode).toBe(200);
    expect((await web('GET', '/auth/web/options')).json()).toEqual({ registration: true, firstAccount: false });
    expect((await web('POST', '/auth/web/register', { email: 'b@example.com', displayName: 'B', password: 'long-enough-2' })).statusCode).toBe(200);
    const short = await web('POST', '/auth/web/register', { email: 'c@example.com', displayName: 'C', password: 'short' });
    expect(short.statusCode).toBe(400);
    expect(short.json<{ message: string }>().message).toMatch(/10 to 128/);
    expect((await web('POST', '/auth/web/register', { email: 'A@example.com', displayName: 'A', password: 'long-enough-1' })).json<{ message: string }>().message).toMatch(/already exists/);
  });

  it('rejects cross-site sign-up attempts', async () => {
    app = await testApp({ ALLOW_REGISTRATION: 'true' });
    const r = await app.inject({ method: 'POST', url: '/auth/web/register', headers: { origin: 'http://evil.example' }, payload: { email: 'x@example.com', displayName: 'X', password: 'long-enough-1' } });
    expect(r.statusCode).toBe(403);
  });
});

describe('change password (signed in)', () => {
  it('needs the current password, keeps this browser signed in and ends other sessions', async () => {
    app = await testApp();
    const phone = await registerUser(app, 'me@example.com');
    const laptop = await signIn('me@example.com', 'correct horse battery');
    const wrong = await web('POST', '/auth/web/password', { currentPassword: 'not my password', newPassword: 'brand-new-pass-1' }, laptop.cookie);
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json<{ message: string }>().message).toMatch(/current password/);

    const ok = await web('POST', '/auth/web/password', { currentPassword: 'correct horse battery', newPassword: 'brand-new-pass-1' }, laptop.cookie);
    expect(ok.statusCode).toBe(200);
    const fresh = cookieHeader(ok.headers['set-cookie']);
    expect((await web('GET', '/auth/me', undefined, fresh)).statusCode).toBe(200);
    // The phone's refresh token no longer works; the old password doesn't either.
    expect((await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: phone.refreshToken } })).statusCode).toBe(401);
    expect((await signIn('me@example.com', 'correct horse battery')).status).toBe(401);
    expect((await signIn('me@example.com', 'brand-new-pass-1')).status).toBe(200);
  });

  it('requires being signed in', async () => {
    app = await testApp();
    expect((await web('POST', '/auth/web/password', { currentPassword: 'a', newPassword: 'b' })).statusCode).toBe(401);
  });
});

describe('forgot password: one-time reset link from the PC', () => {
  it('works once, ends sessions, and older links stop working', async () => {
    app = await testApp();
    await registerUser(app, 'me@example.com');
    const { db, auth } = app.ctx;
    const first = createResetToken(db, auth, 'me@example.com').token;
    const second = createResetToken(db, auth, 'ME@example.com').token;
    expect((await web('POST', '/auth/web/reset', { token: first, newPassword: 'reset-pass-111' })).statusCode).toBe(400);
    const ok = await web('POST', '/auth/web/reset', { token: second, newPassword: 'reset-pass-222' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, email: 'me@example.com' });
    expect((await web('POST', '/auth/web/reset', { token: second, newPassword: 'reset-pass-333' })).statusCode).toBe(400);
    expect((await signIn('me@example.com', 'reset-pass-222')).status).toBe(200);
  });

  it('expires after 30 minutes and ignores made-up tokens', async () => {
    app = await testApp();
    await registerUser(app, 'me@example.com');
    const { db, auth } = app.ctx;
    const { token } = createResetToken(db, auth, 'me@example.com');
    db.prepare(`UPDATE password_resets SET expires_at = ?`).run(new Date(Date.now() - 1000).toISOString());
    const expired = await web('POST', '/auth/web/reset', { token, newPassword: 'reset-pass-111' });
    expect(expired.statusCode).toBe(400);
    expect(expired.json<{ message: string }>().message).toMatch(/expired/);
    expect((await web('POST', '/auth/web/reset', { token: `hbr_${'A'.repeat(43)}`, newPassword: 'reset-pass-111' })).statusCode).toBe(400);
    expect((await signIn('me@example.com', 'correct horse battery')).status).toBe(200); // unchanged
  });
});

describe('Settings → People', () => {
  it('lets a signed-in person add an account, not a visitor', async () => {
    app = await testApp({ ALLOW_REGISTRATION: 'false' });
    // First account via the iOS-style API isn't possible with sign-up off, so seed directly.
    const { db, auth } = app.ctx;
    const { createUser } = await import('../src/services/userAdmin.js');
    await createUser(db, auth, { email: 'me@example.com', displayName: 'Me', password: 'correct horse battery' });
    expect((await web('POST', '/api/people', { email: 'w@example.com', displayName: 'W', password: 'starter-pass-1' })).statusCode).toBe(401);
    const me = await signIn('me@example.com', 'correct horse battery');
    const add = await web('POST', '/api/people', { email: 'w@example.com', displayName: 'Wife', password: 'starter-pass-1' }, me.cookie);
    expect(add.statusCode).toBe(200);
    const dup = await web('POST', '/api/people', { email: 'w@example.com', displayName: 'Wife', password: 'starter-pass-1' }, me.cookie);
    expect(dup.json<{ message: string }>().message).toMatch(/already exists/);
    const list = (await web('GET', '/api/people', undefined, me.cookie)).json<{ people: Array<{ email: string; me: boolean }> }>().people;
    expect(list).toEqual([expect.objectContaining({ email: 'me@example.com', me: true }), expect.objectContaining({ email: 'w@example.com', me: false })]);
    expect(JSON.stringify(list)).not.toMatch(/argon2|password/i);
    expect((await signIn('w@example.com', 'starter-pass-1')).status).toBe(200);
  });
});
