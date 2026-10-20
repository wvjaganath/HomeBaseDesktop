import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { safeFetch } from '../security/safeFetch.js';
import { TrackerData } from '../services/trackerData.js';
import { COUNTED_SERVICES, localDay } from '../services/usage.js';

/** Credits per FR24 lookup: the tracker uses flight-summary/full (2 credits a flight). */
const FR24_CREDITS_PER_LOOKUP = 2;

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
  const { env, db, tracker, radar, calendar, backup, usage } = app.ctx;
  const trackerData = new TrackerData(env.TRACKER_URL);
  // The tracker's API log can be large: read it at most once a minute.
  let fr24Cache: { at: number; perDay: Record<string, number> | null } = { at: 0, perDay: null };
  const fr24PerDay = async (): Promise<Record<string, number> | null> => {
    if (!env.TRACKER_URL) return null;
    if (Date.now() - fr24Cache.at < 60_000) return fr24Cache.perDay;
    let perDay: Record<string, number> | null;
    try {
      perDay = await trackerData.fr24PerDay();
    } catch {
      perDay = null;
    }
    fr24Cache = { at: Date.now(), perDay };
    return perDay;
  };

  /** Requests per day to each outside service, the last 7 days and 30-day totals. */
  const outsideRequests = async (): Promise<object> => {
    const fr = await fr24PerDay();
    const hub = usage.recent(30);
    const days: Array<Record<string, string | number | null>> = [];
    const totals: Record<string, number> = { fr24: 0, 'adsb.lol': 0, 'adsb.fi': 0, adsbdb: 0 };
    for (let i = 0; i < 30; i++) {
      const day = localDay(new Date(Date.now() - i * 86_400_000));
      const row: Record<string, string | number | null> = { day, fr24: fr ? (fr[day] ?? 0) : null };
      for (const s of COUNTED_SERVICES) row[s] = hub[day]?.[s] ?? 0;
      for (const k of Object.keys(totals)) totals[k] = (totals[k] ?? 0) + (typeof row[k] === 'number' ? row[k] : 0);
      if (i < 7) days.push(row);
    }
    return { days, last30: totals, fr24CreditsPerLookup: FR24_CREDITS_PER_LOOKUP, fr24Known: fr !== null };
  };

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
        keep: backup.keep,
        hour: backup.hour,
        count: backups.length,
        last: backups[0] ?? null,
        error: backup.lastError,
      },
      tracker: { enabled: t.enabled, reachable: t.reachable, updatedAt: t.updatedAt },
      radar: { enabled: r.enabled, off: r.off, source: r.source, updatedAt: r.updatedAt, aircraft: r.aircraft.length, homeSource: app.ctx.home.source },
      calendars: sources.map((s) => ({ name: s.name, ok: s.ok, error: s.error, fetchedAt: s.fetchedAt })),
      mirror: { enabled: env.MIRROR_URL !== '', reachable: await mirrorReachable() },
      mapTiles: { key: app.ctx.settings.cartoApiKey !== '' },
      // hub.env lines the hub doesn't read any more (they're in Settings now).
      config: { leftoverEnvKeys: app.ctx.settings.leftoverEnvKeys, timezone: env.timezone },
      screens: { count: screens.n, lastSeenAt: screens.last },
      outsideRequests: await outsideRequests(),
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
