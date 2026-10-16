import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { credentialsSchema, registerSchema, refreshSchema } from '../schemas.js';
import { cookieNames } from '../security/principal.js';

/**
 * Two flavours of the same login:
 *  - /auth/*      JSON tokens for the iOS app (unchanged contract).
 *  - /auth/web/*  httpOnly SameSite=Strict cookies for the browser app, so
 *                 tokens are never readable by page JavaScript.
 */
export default async function authRoutes(app: FastifyInstance): Promise<void> {
  const { auth, env, db } = app.ctx;
  const names = cookieNames(env.COOKIE_SECURE);
  // Tight per-IP limit on credential endpoints to slow brute force.
  const authLimit = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };
  const refreshLimit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  const setSessionCookies = (reply: FastifyReply, accessToken: string, refreshToken: string): void => {
    const base = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict' as const, path: '/' };
    reply.setCookie(names.access, accessToken, { ...base, maxAge: env.ACCESS_TOKEN_TTL_MIN * 60 });
    reply.setCookie(names.refresh, refreshToken, { ...base, maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400 });
  };
  const clearSessionCookies = (reply: FastifyReply): void => {
    const base = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict' as const, path: '/' };
    reply.clearCookie(names.access, base);
    reply.clearCookie(names.refresh, base);
  };

  // --- iOS app (Bearer tokens) ---------------------------------------------

  app.post('/auth/register', authLimit, async (req, reply) => {
    if (!env.ALLOW_REGISTRATION) {
      return reply.code(403).send({ error: 'registration_disabled' });
    }
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: z.flattenError(parsed.error).fieldErrors });
    }
    const email = parsed.data.email.toLowerCase();
    if (auth.findUserByEmail(email)) {
      return reply.code(409).send({ error: 'email_taken' });
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id,
      email,
      parsed.data.displayName,
      await auth.hashPassword(parsed.data.password),
      new Date().toISOString(),
    );
    return {
      user: { id, email, displayName: parsed.data.displayName },
      accessToken: await auth.signAccessToken(id, parsed.data.displayName),
      refreshToken: auth.issueRefreshToken(id),
    };
  });

  app.post('/auth/login', authLimit, async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const user = auth.findUserByEmail(parsed.data.email);
    const ok = await auth.verifyPassword(user?.password_hash, parsed.data.password);
    if (!ok || user === undefined) {
      req.log.info({ event: 'login_failed' }, 'failed login');
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    return {
      user: { id: user.id, email: user.email, displayName: user.display_name },
      accessToken: await auth.signAccessToken(user.id, user.display_name),
      refreshToken: auth.issueRefreshToken(user.id),
    };
  });

  app.post('/auth/refresh', refreshLimit, async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const rotated = auth.rotateRefreshToken(parsed.data.refreshToken);
    const user = rotated ? auth.findUserById(rotated.userId) : undefined;
    if (!rotated || !user) {
      return reply.code(401).send({ error: 'invalid_refresh_token' });
    }
    return {
      accessToken: await auth.signAccessToken(user.id, user.display_name),
      refreshToken: rotated.token,
    };
  });

  app.post('/auth/logout', async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (parsed.success) {
      auth.revokeFamilyByToken(parsed.data.refreshToken);
    }
    return reply.send({ ok: true });
  });

  // --- Browser app (cookies) -------------------------------------------------

  app.post('/auth/web/login', authLimit, async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const user = auth.findUserByEmail(parsed.data.email);
    const ok = await auth.verifyPassword(user?.password_hash, parsed.data.password);
    if (!ok || user === undefined) {
      req.log.info({ event: 'login_failed', via: 'web' }, 'failed login');
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    setSessionCookies(reply, await auth.signAccessToken(user.id, user.display_name), auth.issueRefreshToken(user.id));
    return { user: { id: user.id, email: user.email, displayName: user.display_name } };
  });

  app.post('/auth/web/refresh', refreshLimit, async (req, reply) => {
    const presented = req.cookies[names.refresh];
    const rotated = presented ? auth.rotateRefreshToken(presented) : null;
    const user = rotated ? auth.findUserById(rotated.userId) : undefined;
    if (!rotated || !user) {
      clearSessionCookies(reply);
      return reply.code(401).send({ error: 'invalid_refresh_token' });
    }
    setSessionCookies(reply, await auth.signAccessToken(user.id, user.display_name), rotated.token);
    return { ok: true };
  });

  app.post('/auth/web/logout', async (req, reply) => {
    const presented = req.cookies[names.refresh];
    if (presented) auth.revokeFamilyByToken(presented);
    clearSessionCookies(reply);
    return { ok: true };
  });

  /** Who am I? Used by the web app on load (user or kiosk device). */
  app.get('/auth/me', { preHandler: [app.requireViewer] }, async (req) => {
    const p = req.principal;
    const user = auth.findUserById(req.userId);
    if (p?.kind === 'device') {
      const row = db.prepare(`SELECT name, settings FROM device_tokens WHERE id = ?`).get(p.deviceId) as
        | { name: string; settings: string }
        | undefined;
      return {
        kind: 'device' as const,
        device: { id: p.deviceId, name: row?.name ?? '', settings: JSON.parse(row?.settings ?? '{}') as unknown },
        user: user ? { id: user.id, displayName: user.display_name } : null,
      };
    }
    return {
      kind: 'user' as const,
      user: user ? { id: user.id, email: user.email, displayName: user.display_name } : null,
    };
  });
}
