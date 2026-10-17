import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { credentialsSchema, registerSchema, refreshSchema } from '../schemas.js';
import { cookieNames, secureCookies } from '../security/principal.js';
import { changePassword, createUser, useResetToken, UserAdminError } from '../services/userAdmin.js';

/**
 * Two flavours of the same login:
 *  - /auth/*      JSON tokens for the iOS app (unchanged contract).
 *  - /auth/web/*  httpOnly SameSite=Strict cookies for the browser app, so
 *                 tokens are never readable by page JavaScript.
 */
export default async function authRoutes(app: FastifyInstance): Promise<void> {
  const { auth, env, db } = app.ctx;
  const cookieOpts = (req: FastifyRequest) => {
    const secure = secureCookies(env.COOKIE_SECURE, req);
    return { names: cookieNames(secure), base: { httpOnly: true, secure, sameSite: 'strict' as const, path: '/' } };
  };
  // Tight per-IP limit on credential endpoints to slow brute force.
  const authLimit = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };
  const refreshLimit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  const setSessionCookies = (req: FastifyRequest, reply: FastifyReply, accessToken: string, refreshToken: string): void => {
    const { names, base } = cookieOpts(req);
    reply.setCookie(names.access, accessToken, { ...base, maxAge: env.ACCESS_TOKEN_TTL_MIN * 60 });
    reply.setCookie(names.refresh, refreshToken, { ...base, maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400 });
  };
  const clearSessionCookies = (req: FastifyRequest, reply: FastifyReply): void => {
    const { names, base } = cookieOpts(req);
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
    setSessionCookies(req, reply, await auth.signAccessToken(user.id, user.display_name), auth.issueRefreshToken(user.id));
    return { user: { id: user.id, email: user.email, displayName: user.display_name } };
  });

  app.post('/auth/web/refresh', refreshLimit, async (req, reply) => {
    const presented = req.cookies[cookieOpts(req).names.refresh];
    const rotated = presented ? auth.rotateRefreshToken(presented) : null;
    const user = rotated ? auth.findUserById(rotated.userId) : undefined;
    if (!rotated || !user) {
      clearSessionCookies(req, reply);
      return reply.code(401).send({ error: 'invalid_refresh_token' });
    }
    setSessionCookies(req, reply, await auth.signAccessToken(user.id, user.display_name), rotated.token);
    return { ok: true };
  });

  app.post('/auth/web/logout', async (req, reply) => {
    const presented = req.cookies[cookieOpts(req).names.refresh];
    if (presented) auth.revokeFamilyByToken(presented);
    clearSessionCookies(req, reply);
    return { ok: true };
  });

  // Sign-up, password change and reset for the browser (README §7.4: no email
  // is sent anywhere; reset links are made on the PC with the users script).

  /** What the sign-in screen may offer. Public. */
  app.get('/auth/web/options', async () => ({ registration: env.ALLOW_REGISTRATION }));

  app.post('/auth/web/register', authLimit, async (req, reply) => {
    if (!env.ALLOW_REGISTRATION) return reply.code(403).send({ error: 'registration_disabled' });
    const body = z.object({ email: z.string(), displayName: z.string(), password: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const user = await createUser(db, auth, body.data);
      req.log.info({ event: 'user_registered', via: 'web', userId: user.id }, 'account created');
      setSessionCookies(req, reply, await auth.signAccessToken(user.id, user.displayName), auth.issueRefreshToken(user.id));
      return { user };
    } catch (err) {
      if (err instanceof UserAdminError) return reply.code(400).send({ error: 'invalid_input', message: err.message });
      throw err;
    }
  });

  app.post('/auth/web/password', { ...authLimit, preHandler: [app.requireUser] }, async (req, reply) => {
    const body = z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await changePassword(db, auth, req.userId, body.data.currentPassword, body.data.newPassword);
    } catch (err) {
      if (err instanceof UserAdminError) return reply.code(400).send({ error: 'invalid_input', message: err.message });
      throw err;
    }
    req.log.info({ event: 'password_changed', userId: req.userId }, 'password changed; other sessions ended');
    // Every session was ended; keep this browser signed in with a fresh one.
    const user = auth.findUserById(req.userId);
    if (user) setSessionCookies(req, reply, await auth.signAccessToken(user.id, user.display_name), auth.issueRefreshToken(user.id));
    return { ok: true };
  });

  app.post('/auth/web/reset', authLimit, async (req, reply) => {
    const body = z.object({ token: z.string().max(100), newPassword: z.string().max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const { email } = await useResetToken(db, auth, body.data.token, body.data.newPassword);
      req.log.info({ event: 'password_reset' }, 'password reset with a one-time link');
      clearSessionCookies(req, reply);
      return { ok: true, email };
    } catch (err) {
      if (err instanceof UserAdminError) return reply.code(400).send({ error: 'invalid_input', message: err.message });
      throw err;
    }
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
