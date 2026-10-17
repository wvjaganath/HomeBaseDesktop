import type { FastifyReply, FastifyRequest } from 'fastify';
import { cookieNames } from './principal.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth for cookie-authenticated requests. Cookies are already
 * SameSite=Strict; on top of that every state-changing request that carries one
 * of our cookies (or targets the cookie login endpoints) must come from our own
 * origin. Bearer-token clients (the iOS app) are unaffected: browsers never
 * attach a Bearer header cross-site.
 */
export function csrfGuard() {
  // Check both spellings: either kind of cookie means a browser session.
  const names = [...Object.values(cookieNames(true)), ...Object.values(cookieNames(false))];
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (SAFE_METHODS.has(req.method)) return;
    if (req.headers.authorization?.startsWith('Bearer ')) return;

    const url = req.url;
    const usesCookies = names.some((n) => req.cookies[n] !== undefined) || url.startsWith('/auth/web/');
    if (!usesCookies) return;

    const expected = `${req.protocol}://${req.host}`;
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (origin === expected) return;
    } else {
      const referer = req.headers.referer;
      if (referer !== undefined) {
        try {
          if (new URL(referer).origin === expected) return;
        } catch {
          // fall through to rejection
        }
      }
    }
    req.log.warn({ origin, expected }, 'csrf: cross-origin state-changing request rejected');
    await reply.code(403).send({ error: 'forbidden_origin' });
  };
}
