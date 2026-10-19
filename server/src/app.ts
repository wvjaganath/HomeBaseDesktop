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
import mirrorRoutes from './routes/mirror.js';
import statusRoutes from './routes/status.js';
import peopleRoutes from './routes/people.js';
import hubSettingsRoutes from './routes/hubSettings.js';
import mirrorBootstrapRoutes from './routes/mirrorBootstrap.js';
import trackerDataRoutes from './routes/trackerData.js';
import trackerSettingsRoutes from './routes/trackerSettings.js';
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
  // An earlier version relayed and stored CARTO tiles on the hub, which CARTO's
  // terms (9.c) don't allow: remove anything it stored.
  for (const dir of ['tiles', 'tiles-v2']) {
    void fs.promises.rm(path.join(env.DATA_DIR, 'cache', dir), { recursive: true, force: true }).catch(() => undefined);
  }
  // Settings saved in the browser apply straight away.
  if (!env.isTest) app.log.level = ctx.settings.values.logLevel;
  ctx.settings.onChange((next, prev) => {
    if (!env.isTest && next.logLevel !== prev.logLevel) app.log.level = next.logLevel;
    if (next.backupHour !== prev.backupHour || next.backupKeep !== prev.backupKeep) {
      if (opts.startServices) ctx.backup.start();
    }
    ctx.home.notify();
    ctx.radar.reconfigure();
  });
  app.decorateRequest('principal', null);
  app.decorateRequest('userId', '');
  // Which build of the web app this hub serves (its hashed entry script), so
  // screens opened before an update can tell and reload themselves.
  const webDist = opts.webDist ?? path.join(serverRoot, 'web-dist');
  app.decorate('webBuild', readWebBuild(webDist));
  app.decorate('requireUser', requireUser(ctx));
  app.decorate('requireViewer', requireViewer(ctx));
  app.decorate('authenticate', requireUser(ctx));

  await app.register(cookie);

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        // RainViewer: optional rain overlay on the desktop Radar tab.
        // Map tiles load straight from CARTO (their terms forbid relaying them).
        imgSrc: ["'self'", 'data:', 'https://basemaps.cartocdn.com', 'https://*.plnspttrs.net', 'https://tilecache.rainviewer.com'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", 'https://api.planespotters.net', 'https://api.rainviewer.com'],
        frameSrc: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        upgradeInsecureRequests: env.COOKIE_SECURE === true ? [] : null,
      },
    },
    // HSTS only makes sense once the hub is served over HTTPS (Phase 7).
    // HSTS only when every browser route is HTTPS (it applies to all ports).
    strictTransportSecurity: env.COOKIE_SECURE === true ? { maxAge: 31_536_000, includeSubDomains: false } : false,
    // Planespotters requires an Origin/Referer from browser clients.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    return payload;
  });

  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  app.addHook('onRequest', csrfGuard());

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
  await app.register(mirrorRoutes);
  await app.register(statusRoutes);
  await app.register(peopleRoutes);
  await app.register(trackerSettingsRoutes);
  await app.register(trackerDataRoutes);
  await app.register(hubSettingsRoutes);
  await app.register(mirrorBootstrapRoutes);

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

  // The old weight-loss website was retired once the web app reached parity.
  // It kept tokens in localStorage; old bookmarks land on the new screen.
  app.get('/legacy', async (_req, reply) => reply.redirect('/#/fitness', 301));
  app.get('/legacy/*', async (_req, reply) => reply.redirect('/#/fitness', 301));

  if (opts.startServices) {
    ctx.tracker.start();
    ctx.radar.start();
    ctx.home.start();
    ctx.calendar.start();
    ctx.backup.start();
  }
  app.addHook('onClose', async () => {
    ctx.tracker.stop();
    ctx.radar.stop();
    ctx.home.stop();
    ctx.calendar.stop();
    ctx.backup.stop();
    db.close();
  });

  return app;
}

/** The web app's entry script path (e.g. /assets/index-AbC123.js), or '' if not built. */
function readWebBuild(webDist: string): string {
  try {
    const html = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
    return /<script[^>]+src="(\/assets\/index-[\w-]+\.js)"/.exec(html)?.[1] ?? '';
  } catch {
    return '';
  }
}
