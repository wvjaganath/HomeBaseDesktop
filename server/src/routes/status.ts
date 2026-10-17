import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { safeFetch } from '../security/safeFetch.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
const startedAt = new Date();

function fileBytes(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/** Health of the hub and everything it talks to, for Settings → Status. */
export default async function statusRoutes(app: FastifyInstance): Promise<void> {
  const { env, db, tracker, radar, calendar, backup } = app.ctx;

  let mirrorProbe: { at: number; reachable: boolean } = { at: 0, reachable: false };
  const mirrorReachable = async (): Promise<boolean> => {
    if (!env.MIRROR_URL) return false;
    if (Date.now() - mirrorProbe.at < 30_000) return mirrorProbe.reachable;
    let reachable: boolean;
    try {
      const res = await safeFetch(`${env.MIRROR_URL}/version`, {
        allowHosts: [new URL(env.MIRROR_URL).hostname],
        allowHttp: true,
        allowPrivate: true,
        timeoutMs: 3_000,
        maxBytes: 4_096,
      });
      reachable = res.ok;
    } catch {
      reachable = false;
    }
    mirrorProbe = { at: Date.now(), reachable };
    return reachable;
  };

  app.get('/api/status', { preHandler: [app.requireUser] }, async (req) => {
    const t = tracker.snapshot.state;
    const r = radar.snapshot.data;
    const sources = calendar.listSources(req.userId);
    const screens = db
      .prepare(`SELECT COUNT(*) AS n, MAX(last_used_at) AS last FROM device_tokens WHERE user_id = ? AND revoked_at IS NULL`)
      .get(req.userId) as { n: number; last: string | null };
    const items = (db.prepare(`SELECT COUNT(*) AS n FROM items WHERE deleted_at IS NULL`).get() as { n: number }).n;
    const backups = backup.list();
    return {
      hub: {
        version: pkg.version,
        node: process.version,
        startedAt: startedAt.toISOString(),
        https: req.protocol === 'https',
      },
      database: {
        bytes: fileBytes(env.dbPath) + fileBytes(`${env.dbPath}-wal`),
        items,
      },
      backup: {
        enabled: backup.enabled,
        keep: env.BACKUP_KEEP,
        hour: env.BACKUP_HOUR,
        count: backups.length,
        last: backups[0] ?? null,
        error: backup.lastError,
      },
      tracker: { enabled: t.enabled, reachable: t.reachable, updatedAt: t.updatedAt },
      radar: { enabled: r.enabled, off: r.off, source: r.source, updatedAt: r.updatedAt, aircraft: r.aircraft.length, homeSource: app.ctx.home.source },
      calendars: sources.map((s) => ({ name: s.name, ok: s.ok, error: s.error, fetchedAt: s.fetchedAt })),
      mirror: { enabled: env.MIRROR_URL !== '', reachable: await mirrorReachable() },
      mapTiles: { key: env.CARTO_API_KEY !== '' },
      screens: { count: screens.n, lastSeenAt: screens.last },
    };
  });

  app.post(
    '/api/status/backup',
    { preHandler: [app.requireUser], config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (_req, reply) => {
      if (!backup.enabled) return reply.code(409).send({ error: 'backups_disabled' });
      try {
        return { backup: await backup.run() };
      } catch {
        return reply.code(500).send({ error: 'backup_failed' });
      }
    },
  );
}
