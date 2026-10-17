import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, listUsers, resetPassword, UserAdminError } from '../src/services/userAdmin.js';
import { testApp } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await testApp({ ALLOW_REGISTRATION: 'false' });
});
afterAll(async () => {
  await app.close();
});

const login = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });

describe('account admin (users script)', () => {
  it('creates an account even with sign-up turned off, and it can log in', async () => {
    const { db, auth } = app.ctx;
    const u = await createUser(db, auth, { email: 'Wife@Example.com', displayName: 'Wife', password: 'first-password-1' });
    expect(u.email).toBe('wife@example.com');
    expect((await login('wife@example.com', 'first-password-1')).statusCode).toBe(200);
    expect(listUsers(db).map((x) => x.email)).toContain('wife@example.com');
  });

  it('refuses duplicates, short passwords and bad emails', async () => {
    const { db, auth } = app.ctx;
    await expect(createUser(db, auth, { email: 'wife@example.com', displayName: 'X', password: 'another-pass-1' })).rejects.toThrow(UserAdminError);
    await expect(createUser(db, auth, { email: 'new@example.com', displayName: 'X', password: 'short' })).rejects.toThrow(/10 to 128/);
    await expect(createUser(db, auth, { email: 'not-an-email', displayName: 'X', password: 'long-enough-pass' })).rejects.toThrow(/email/);
  });

  it('resets a password: old one stops working, sessions are ended', async () => {
    const { db, auth } = app.ctx;
    const before = (await login('wife@example.com', 'first-password-1')).json<{ refreshToken: string }>();
    const ended = await resetPassword(db, auth, 'WIFE@example.com', 'second-password-2');
    expect(ended).toBeGreaterThanOrEqual(2); // both logins above
    expect((await login('wife@example.com', 'first-password-1')).statusCode).toBe(401);
    expect((await login('wife@example.com', 'second-password-2')).statusCode).toBe(200);
    const refresh = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: before.refreshToken } });
    expect(refresh.statusCode).toBe(401);
    await expect(resetPassword(db, auth, 'nobody@example.com', 'whatever-pass-1')).rejects.toThrow(/No account/);
  });
});
