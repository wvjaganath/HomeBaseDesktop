import type { FastifyInstance, FastifyRequest } from 'fastify';

export const BUILT_IN_MIRROR = 'MagicMirror (built in)';

/**
 * MagicMirror's start-up settings, so it needs no mirror.env: a read-only
 * screen token (for the HomeBase panel), home and units. Answered only to the
 * MagicMirror container's fixed address on the hub ↔ mirror Docker network
 * (MIRROR_CLIENT_IP); to everyone else these paths don't exist. Requests that
 * come through Caddy carry Caddy's address, so they never match.
 */
export default async function mirrorBootstrapRoutes(app: FastifyInstance): Promise<void> {
  const { env, db, auth, home } = app.ctx;

  const fromMirror = (req: FastifyRequest): boolean => {
    if (!env.MIRROR_CLIENT_IP) return false;
    const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    return ip === env.MIRROR_CLIENT_IP;
  };
  // The screen token belongs to the hub's first account (the owner).
  const owner = (): string | null => {
    const row = db.prepare(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`).get() as { id: string } | undefined;
    return row?.id ?? null;
  };
  const config = () => {
    const h = home.get();
    return { lat: h?.lat ?? null, lon: h?.lon ?? null, units: home.units, hasOwner: owner() !== null };
  };
  const limit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  // Once per MagicMirror start: a fresh token (the previous built-in one is revoked).
  app.get('/internal/mirror/bootstrap', limit, async (req, reply) => {
    if (!fromMirror(req)) return reply.code(404).send({ error: 'not_found' });
    const userId = owner();
    const rotate = db.transaction((owner: string): string => {
      db.prepare(`UPDATE device_tokens SET revoked_at = ? WHERE name = ? AND revoked_at IS NULL`).run(new Date().toISOString(), BUILT_IN_MIRROR);
      return auth.createDeviceToken(owner, BUILT_IN_MIRROR).token;
    });
    const token = userId ? rotate(userId) : null;
    req.log.info({ event: 'mirror_bootstrap', token: token !== null }, 'MagicMirror asked for its settings');
    return { token, ...config() };
  });

  // Polled by MagicMirror to notice changes (it restarts itself to take them on).
  app.get('/internal/mirror/config', limit, async (req, reply) => {
    if (!fromMirror(req)) return reply.code(404).send({ error: 'not_found' });
    return config();
  });
}
