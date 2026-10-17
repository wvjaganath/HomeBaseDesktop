import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';

/**
 * Who is making a request:
 *  - user:   a person (iOS app via Bearer token, or the web app via cookie).
 *  - device: a kiosk screen holding a read-only display token. It acts on
 *            behalf of the user who paired it but can never write data.
 */
export type Principal =
  | { kind: 'user'; userId: string; via: 'bearer' | 'cookie' }
  | { kind: 'device'; userId: string; deviceId: string };

/** Whether this request's cookies are Secure (__Host-) ones. */
export function secureCookies(setting: boolean | 'auto', req: FastifyRequest): boolean {
  return setting === 'auto' ? req.protocol === 'https' : setting;
}

export function cookieNames(secure: boolean): { access: string; refresh: string; device: string } {
  // The __Host- prefix (Secure, Path=/, no Domain) is only valid over HTTPS.
  const p = secure ? '__Host-' : '';
  return { access: `${p}hb_at`, refresh: `${p}hb_rt`, device: `${p}hb_dev` };
}

export async function resolvePrincipal(ctx: AppContext, req: FastifyRequest): Promise<Principal | null> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    // Screen tokens can also be sent as a Bearer header (e.g. by the
    // MagicMirror module's server-side helper). They stay read-only.
    if (token.startsWith('hbd_')) {
      const row = ctx.auth.verifyDeviceToken(token);
      return row ? { kind: 'device', userId: row.user_id, deviceId: row.id } : null;
    }
    const userId = await ctx.auth.verifyAccessToken(token);
    return userId ? { kind: 'user', userId, via: 'bearer' } : null;
  }
  const names = cookieNames(secureCookies(ctx.env.COOKIE_SECURE, req));
  const access = req.cookies[names.access];
  if (access) {
    const userId = await ctx.auth.verifyAccessToken(access);
    if (userId) return { kind: 'user', userId, via: 'cookie' };
  }
  const device = req.cookies[names.device];
  if (device) {
    const row = ctx.auth.verifyDeviceToken(device);
    if (row) return { kind: 'device', userId: row.user_id, deviceId: row.id };
  }
  return null;
}

/** preHandler factory: a signed-in person (never a kiosk device). */
export function requireUser(ctx: AppContext) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const principal = await resolvePrincipal(ctx, req);
    if (!principal || principal.kind !== 'user') {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    req.principal = principal;
    req.userId = principal.userId;
  };
}

/** preHandler factory: a person or a paired kiosk device (read-only routes). */
export function requireViewer(ctx: AppContext) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const principal = await resolvePrincipal(ctx, req);
    if (!principal) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    req.principal = principal;
    req.userId = principal.userId;
  };
}
