import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cookieNames, secureCookies } from '../security/principal.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const deviceSettingsSchema = z.object({
  startTab: z.enum(['home', 'flights', 'radar', 'calendar', 'mirror']).default('home'),
  autoFocus: z.boolean().default(true),
  boardTheme: z.enum(['led', 'clean']).default('led'),
  night: z
    .object({
      enabled: z.boolean().default(false),
      start: hhmm.default('23:00'),
      end: hhmm.default('06:30'),
      mode: z.enum(['dim', 'black']).default('dim'),
    })
    .default({ enabled: false, start: '23:00', end: '06:30', mode: 'dim' }),
  rotate: z
    .object({
      enabled: z.boolean().default(false),
      tabs: z.array(z.enum(['home', 'flights', 'radar', 'calendar', 'mirror'])).max(5).default(['home', 'radar']),
      seconds: z.number().int().min(15).max(3600).default(60),
    })
    .default({ enabled: false, tabs: ['home', 'radar'], seconds: 60 }),
});

export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;

const idParam = z.object({ id: z.guid() });

/**
 * Kiosk screens. A person creates a screen in Settings and gets a one-time
 * pairing link; opening it on the Pi stores a long-lived, read-only device
 * cookie. Tokens are stored hashed and can be revoked at any time.
 */
export default async function deviceRoutes(app: FastifyInstance): Promise<void> {
  const { db, auth, bus, env } = app.ctx;

  app.get('/api/devices', { preHandler: [app.requireUser] }, async (req) => {
    const rows = db
      .prepare(
        `SELECT id, name, settings, created_at, last_used_at FROM device_tokens
         WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at`,
      )
      .all(req.userId) as Array<{ id: string; name: string; settings: string; created_at: string; last_used_at: string | null }>;
    return {
      devices: rows.map((r) => ({
        id: r.id,
        name: r.name,
        settings: deviceSettingsSchema.parse(JSON.parse(r.settings)),
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
      })),
    };
  });

  app.post('/api/devices', { preHandler: [app.requireUser], config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const active = (db.prepare(`SELECT COUNT(*) AS n FROM device_tokens WHERE user_id = ? AND revoked_at IS NULL`).get(req.userId) as { n: number }).n;
    if (active >= 10) return reply.code(409).send({ error: 'too_many_devices' });
    const { id, token } = auth.createDeviceToken(req.userId, parsed.data.name);
    db.prepare(`UPDATE device_tokens SET settings = ? WHERE id = ?`).run(JSON.stringify(deviceSettingsSchema.parse({})), id);
    req.log.info({ event: 'device_created', deviceId: id }, 'kiosk device created');
    // The token is shown once; only its hash is stored.
    return { id, pairPath: `/kiosk/pair?t=${token}` };
  });

  app.patch('/api/devices/:id', { preHandler: [app.requireUser] }, async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const body = z
      .object({ name: z.string().trim().min(1).max(40).optional(), settings: deviceSettingsSchema.optional() })
      .safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_input' });
    const res = db
      .prepare(
        `UPDATE device_tokens SET name = COALESCE(?, name), settings = COALESCE(?, settings)
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .run(body.data.name ?? null, body.data.settings ? JSON.stringify(body.data.settings) : null, params.data.id, req.userId);
    if (res.changes === 0) return reply.code(404).send({ error: 'not_found' });
    bus.emit('device', { deviceId: params.data.id, action: 'settings' });
    return { ok: true };
  });

  app.post('/api/devices/:id/reload', { preHandler: [app.requireUser] }, async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_input' });
    const owned = db.prepare(`SELECT 1 FROM device_tokens WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).get(params.data.id, req.userId);
    if (!owned) return reply.code(404).send({ error: 'not_found' });
    bus.emit('device', { deviceId: params.data.id, action: 'reload' });
    return { ok: true };
  });

  app.delete('/api/devices/:id', { preHandler: [app.requireUser] }, async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_input' });
    const res = db
      .prepare(`UPDATE device_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
      .run(new Date().toISOString(), params.data.id, req.userId);
    if (res.changes === 0) return reply.code(404).send({ error: 'not_found' });
    req.log.info({ event: 'device_revoked', deviceId: params.data.id }, 'kiosk device revoked');
    bus.emit('device', { deviceId: params.data.id, action: 'revoked' });
    return { ok: true };
  });

  /**
   * Pairing link opened on the kiosk. Swaps the token in the URL for an
   * httpOnly cookie and redirects so the token doesn't stay in the address bar.
   * The kiosk start script opens this link on every boot, which also re-pairs
   * a browser whose cookies were cleared.
   */
  app.get('/kiosk/pair', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = z.object({ t: z.string().max(100) }).safeParse(req.query);
    const row = q.success ? auth.verifyDeviceToken(q.data.t) : null;
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    if (!row || !q.success) {
      req.log.warn({ event: 'device_pair_failed' }, 'invalid kiosk pairing link');
      return reply.code(401).type('text/plain').send('This screen link is invalid or was revoked. Create a new one in Settings → Screens.');
    }
    const secure = secureCookies(env.COOKIE_SECURE, req);
    reply.setCookie(cookieNames(secure).device, q.data.t, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: 400 * 86_400, // browsers cap cookie lifetime at 400 days
    });
    return reply.redirect('/#/kiosk', 303);
  });
}
