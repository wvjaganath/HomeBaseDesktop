import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { createContext, type AppContext } from './context.js';
import { openDb } from './db.js';
import type { Env } from './env.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import deviceRoutes from './routes/devices.js';
import logoRoutes from './routes/logos.js';
import shareRoutes from './routes/shares.js';
import streamRoutes from './routes/stream.js';
import syncRoutes from './routes/sync.js';
import { csrfGuard } from './security/csrf.js';
import { requireUser, requireViewer } from './security/principal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

export interface BuildOptions {
  env: Env;
  /** Start background pollers (tracker, radar, calendar). Off in tests. */
  startServices?: boolean;
  webDist?: string;
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { env } = opts;
  const serverOptions: FastifyServerOptions = {
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    logger: env.isTest
      ? false
      : {
          level: env.LOG_LEVEL,
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.refreshToken', '*.accessToken', '*.url_enc'],
            censor: '[redacted]',
          },
          serializers: {
            // Never log query strings: the kiosk pairing link carries a token.
            req: (req) => ({
              method: req.method,
              url: req.url.split('?')[0] ?? '',
              hostname: req.hostname,
              remoteAddress: req.ip,
              remotePort: req.socket.remotePort ?? 0,
            }),
          },
        },
  };
  const app: FastifyInstance = Fastify(serverOptions);

  const db = openDb(env.dbPath);
  const ctx: AppContext = createContext(env, db, app.log);
  app.decorate('ctx', ctx);
  app.decorateRequest('principal', null);
  app.decorateRequest('userId', '');
  app.decorate('requireUser', requireUser(ctx));
  app.decorate('requireViewer', requireViewer(ctx));
  app.decorate('authenticate', requireUser(ctx));

  await app.register(cookie);

  const tileHosts = ['https://a.basemaps.cartocdn.com', 'https://b.basemaps.cartocdn.com', 'https://c.basemaps.cartocdn.com', 'https://d.basemaps.cartocdn.com'];
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', ...tileHosts, 'https://*.plnspttrs.net'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", 'https://api.planespotters.net'],
        frameSrc: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        upgradeInsecureRequests: env.COOKIE_SECURE ? [] : null,
      },
    },
    // HSTS only makes sense once the hub is served over HTTPS (Phase 7).
    strictTransportSecurity: env.COOKIE_SECURE ? { maxAge: 31_536_000, includeSubDomains: false } : false,
    // Planespotters requires an Origin/Referer from browser clients.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    // The legacy tracker website uses inline styles; give it a relaxed (but
    // still script-strict) policy, scoped to its own path only.
    if (req.url.startsWith('/legacy/')) {
      reply.header(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      );
    }
    return payload;
  });

  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  app.addHook('onRequest', csrfGuard(env.COOKIE_SECURE));

  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, 'request failed');
      return reply.code(status).send({ error: 'internal_error' });
    }
    return reply.code(status).send({ error: status === 429 ? 'rate_limited' : 'bad_request' });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(syncRoutes);
  await app.register(shareRoutes);
  await app.register(deviceRoutes);
  await app.register(streamRoutes);
  await app.register(dashboardRoutes);
  await app.register(logoRoutes);

  const webDist = opts.webDist ?? path.join(serverRoot, 'web-dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      index: ['index.html'],
      maxAge: '1h',
      // Hashed asset filenames can be cached forever; index.html must revalidate.
      setHeaders: (reply, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) void reply.header('cache-control', 'public, max-age=31536000, immutable');
        if (filePath.endsWith('index.html')) void reply.header('cache-control', 'no-cache');
      },
    });
  } else {
    app.get('/', async (_req, reply) => reply.type('text/plain').send('HomeBase hub is running. Web app not built yet (npm run build in web/).'));
  }

  const legacy = path.join(serverRoot, 'public-legacy');
  if (fs.existsSync(legacy)) {
    await app.register(fastifyStatic, { root: legacy, prefix: '/legacy/', decorateReply: false });
  }

  if (opts.startServices) {
    ctx.tracker.start();
    ctx.radar.start();
    ctx.calendar.start();
  }
  app.addHook('onClose', async () => {
    ctx.tracker.stop();
    ctx.radar.stop();
    ctx.calendar.stop();
    db.close();
  });

  return app;
}
