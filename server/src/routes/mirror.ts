import httpProxy from '@fastify/http-proxy';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { safeFetch } from '../security/safeFetch.js';

/**
 * MagicMirror² behind the hub at /mirror/ (README §6.4).
 *
 * MagicMirror runs on an internal Docker network with no published port, so
 * this proxy is its only door. Every request (websocket upgrades included,
 * which @fastify/http-proxy routes through the normal Fastify pipeline) must
 * come from a signed-in person or a paired screen, and only the paths the
 * MagicMirror page needs are forwarded. Notably blocked: /cors (an open
 * fetch-any-URL proxy), /reload, and the test fixtures.
 */
const ALLOWED: RegExp[] = [
  /^\/$/,
  /^\/favicon\.svg$/,
  /^\/(js|css|modules|defaultmodules|translations)\/[\w./@-]+$/,
  /^\/node_modules\/(animate\.css|@fontsource|@fortawesome|suncalc|nunjucks|moment|moment-timezone|croner|weathericons)\/[\w./@-]+$/,
  // The client fetches "config/"; MagicMirror's static handler 301s "config" to it.
  /^\/config\/?$/,
  /^\/config\/(basepath\.js|custom\.css)$/,
  /^\/(env|startup|version)$/,
  /^\/socket\.io\/$/,
];
const SOCKET_PATH = /^\/socket\.io\/$/;

/** Path after /mirror, normalised, or null if it isn't one we forward. */
export function allowedMirrorPath(rawUrl: string): string | null {
  const rawPath = rawUrl.split('?', 1)[0] ?? '';
  // Reject anything that could be decoded or normalised differently by the
  // upstream (the class of bug behind CVE-2026-16117 / CVE-2026-15074).
  if (/%2e|%2f|%5c|\\|\/\.\.?(\/|$)/i.test(rawPath)) return null;
  if (!rawPath.startsWith('/mirror')) return null;
  const rest = rawPath.slice('/mirror'.length) || '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (decoded !== rest && /[^\w./@-]/.test(decoded)) return null;
  return ALLOWED.some((re) => re.test(decoded)) ? decoded : null;
}

const MIRROR_CSP = [
  "default-src 'self'",
  // MagicMirror compiles its nunjucks templates at runtime (needs eval);
  // inline scripts stay blocked: the container's index.html is patched to
  // load its one inline snippet from a file instead.
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default async function mirrorRoutes(app: FastifyInstance): Promise<void> {
  const { env } = app.ctx;
  if (!env.MIRROR_URL) {
    app.get('/mirror', async (_req, reply) => reply.code(404).type('text/plain').send('The Mirror tab is not configured on this hub.'));
    app.get('/mirror/*', async (_req, reply) => reply.code(404).send({ error: 'mirror_not_configured' }));
    return;
  }
  const upstreamHost = new URL(env.MIRROR_URL).hostname;

  const guard = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.url.split('?', 1)[0] === '/mirror') {
      // Relative asset URLs in MagicMirror's page need the trailing slash.
      await reply.redirect('/mirror/', 301);
      return;
    }
    const path = allowedMirrorPath(req.url);
    const isSocket = path !== null && SOCKET_PATH.test(path);
    const methodOk = req.method === 'GET' || req.method === 'HEAD' || (isSocket && req.method === 'POST');
    if (path === null || !methodOk) {
      await reply.code(404).send({ error: 'not_found' });
      return;
    }
    // Cross-site requests (and cross-site websocket hijacking): anything that
    // carries an Origin must come from our own pages. Websocket upgrades must
    // always carry one. MagicMirror runs the same check against its own Host,
    // which the proxy rewrites, so the hub owns this check and drops Origin
    // before forwarding (see rewriteRequestHeaders below).
    const isUpgrade = req.headers.upgrade?.toLowerCase() === 'websocket';
    const origin = req.headers.origin;
    if ((origin !== undefined || isUpgrade) && origin !== `${req.protocol}://${req.host}`) {
      await reply.code(403).send({ error: 'forbidden_origin' });
      return;
    }
    await app.requireViewer(req, reply);
  };

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/mirror')) {
      reply.header('content-security-policy', MIRROR_CSP);
      reply.header('x-frame-options', 'SAMEORIGIN');
      reply.removeHeader('x-powered-by');
    }
    return payload;
  });

  await app.register(httpProxy, {
    upstream: env.MIRROR_URL,
    prefix: '/mirror',
    rewritePrefix: '',
    websocket: true,
    httpMethods: ['GET', 'HEAD', 'POST'],
    // The plugin hands this straight to fastify.route(), which awaits async
    // hooks; its type only declares the callback form.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    preHandler: guard,
    replyOptions: {
      // Never forward the hub's own credentials to MagicMirror. Origin was
      // checked in guard() and would only trip MagicMirror's Host comparison.
      rewriteRequestHeaders: (_req, headers) => {
        const { cookie: _c, authorization: _a, origin: _o, ...rest } = headers;
        return rest;
      },
    },
  });

  // MagicMirror's socket client imports this one file from the site root,
  // ignoring basePath; serve exactly that file and nothing else from /socket.io.
  let cached: { body: Buffer; at: number } | null = null;
  app.get('/socket.io/socket.io.esm.min.js', { preHandler: [app.requireViewer] }, async (_req, reply) => {
    if (!cached || Date.now() - cached.at > 3_600_000) {
      const res = await safeFetch(`${env.MIRROR_URL}/socket.io/socket.io.esm.min.js`, {
        allowHosts: [upstreamHost],
        allowHttp: true,
        allowPrivate: true,
        timeoutMs: 5_000,
        maxBytes: 512 * 1024,
      });
      cached = { body: res.bodyBuffer, at: Date.now() };
    }
    return reply.type('text/javascript; charset=utf-8').header('cache-control', 'private, max-age=3600').send(cached.body);
  });
}
