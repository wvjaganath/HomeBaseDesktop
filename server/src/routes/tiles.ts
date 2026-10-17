import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { safeFetch } from '../security/safeFetch.js';

/**
 * Dark map tiles (CARTO "Dark Matter") for the Radar and record maps, fetched
 * by the hub with the owner's free CARTO key (Settings → Hub → Radar & maps).
 *
 * Since late summer 2026 CARTO stamps "API KEY REQUIRED" on tiles requested
 * without a (working) key. Going through the hub keeps the key off every
 * browser and the Pi, lets all screens share one cache on disk (fewer requests
 * against the free 5 million a month), and means browsers only load images
 * from the hub.
 *
 * CARTO's watermark tile is recognised (its ETag starts with "wm-") and is
 * never cached, so it can't outlive a fix. Tile URLs carry a short fingerprint
 * of the key (?v=…), so browsers fetch fresh tiles as soon as the key changes.
 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_TILE_BYTES = 512 * 1024;
const TTL_MS = 30 * 24 * 3600_000;
const MAX_CACHED = 10_000; // ~200 MB at typical tile sizes
const PRUNE_EVERY = 500;
const SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;
// CARTO's documented keyed address first; the older per-subdomain one as a fallback.
const HOSTS = ['basemaps.cartocdn.com', ...SUBDOMAINS.map((s) => `${s}.basemaps.cartocdn.com`)];
const upstreams = (zoom: number, x: number, y: number, retina: boolean): string[] => {
  const tail = `dark_all/${zoom}/${x}/${y}${retina ? '@2x' : ''}.png`;
  const sub = SUBDOMAINS[(x + y) % SUBDOMAINS.length] ?? 'a';
  return [`https://basemaps.cartocdn.com/rastertiles/${tail}`, `https://${sub}.basemaps.cartocdn.com/${tail}`];
};

const params = z.object({
  z: z.coerce.number().int().min(1).max(14),
  x: z.coerce.number().int().min(0),
  file: z.string().regex(/^\d{1,5}(@2x)?\.png$/),
});

/** A short, one-way fingerprint of the key, for cache names and tile URLs. */
export const keyFingerprint = (key: string): string => (key ? createHash('sha256').update(key).digest('hex').slice(0, 10) : 'nokey');

export type TileResult = 'ok' | 'watermark' | 'refused' | 'error';
export interface TileStatus {
  at: string;
  result: TileResult;
  httpStatus: number | null;
}

/** Swappable in tests (CARTO isn't reachable from the test machine). */
export const tileDeps = { fetch: safeFetch };

/** The last answer CARTO gave (for Settings → Status). */
export const tileStatus: { last: TileStatus | null } = { last: null };

const isWatermark = (etag: string | null): boolean => /^(W\/)?"?wm-/i.test(etag ?? '');

export default async function tileRoutes(app: FastifyInstance): Promise<void> {
  const { env, settings } = app.ctx;
  const cacheRoot = path.resolve(env.DATA_DIR, 'cache');
  const cacheDir = path.join(cacheRoot, 'tiles-v2');
  // The first version cached under cache/tiles, possibly including watermarks.
  void fs.rm(path.join(cacheRoot, 'tiles'), { recursive: true, force: true }).catch(() => undefined);
  const inflight = new Map<string, Promise<{ tile: Buffer; cache: boolean } | null>>();
  let writes = 0;

  async function prune(): Promise<void> {
    try {
      const names = await fs.readdir(cacheDir);
      if (names.length <= MAX_CACHED) return;
      const stats = await Promise.all(
        names.map(async (n) => ({ n, t: (await fs.stat(path.join(cacheDir, n)).catch(() => null))?.mtimeMs ?? 0 })),
      );
      stats.sort((a, b) => a.t - b.t);
      await Promise.all(stats.slice(0, names.length - Math.floor(MAX_CACHED * 0.9)).map(({ n }) => fs.rm(path.join(cacheDir, n), { force: true })));
    } catch {
      // cache housekeeping is best effort
    }
  }

  const note = (result: TileResult, httpStatus: number | null): void => {
    tileStatus.last = { at: new Date().toISOString(), result, httpStatus };
  };

  async function fetchTile(zoom: number, x: number, y: number, retina: boolean): Promise<{ tile: Buffer; cache: boolean } | null> {
    const key = settings.cartoApiKey;
    let watermark: Buffer | null = null;
    let refused: number | null = null;
    for (const base of upstreams(zoom, x, y, retina)) {
      const url = new URL(base);
      if (key) url.searchParams.set('key', key);
      try {
        const res = await tileDeps.fetch(url.toString(), { allowHosts: HOSTS, timeoutMs: 8_000, maxBytes: MAX_TILE_BYTES, headers: { accept: 'image/png' }, allowErrorStatus: true });
        if (res.status === 401 || res.status === 403) {
          refused = res.status;
          continue;
        }
        if (res.status !== 200 || !res.bodyBuffer.subarray(0, 8).equals(PNG_MAGIC)) continue;
        if (isWatermark(res.headers.get('etag'))) {
          watermark ??= res.bodyBuffer;
          continue; // try the other address before giving up
        }
        note('ok', 200);
        return { tile: res.bodyBuffer, cache: true };
      } catch {
        // Never log the URL: it carries the key. Try the next address.
      }
    }
    if (watermark) {
      note('watermark', 200);
      return { tile: watermark, cache: false };
    }
    note(refused ? 'refused' : 'error', refused);
    app.log.debug({ refused }, 'map tile fetch failed');
    return null;
  }

  app.get('/api/tiles/:z/:x/:file', { preHandler: [app.requireViewer], config: { rateLimit: { max: 1500, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_input' });
    const { z: zoom, x, file } = p.data;
    const y = Number.parseInt(file, 10);
    const retina = file.includes('@2x');
    const max = 2 ** zoom;
    if (x >= max || y >= max) return reply.code(400).send({ error: 'invalid_input' });

    // Cached per key, so a new key never shows tiles fetched with the old one.
    const name = `${keyFingerprint(settings.cartoApiKey)}-${zoom}-${x}-${y}${retina ? '-2x' : ''}.png`;
    const cached = path.join(cacheDir, name);
    try {
      const st = await fs.stat(cached);
      if (Date.now() - st.mtimeMs < TTL_MS) {
        return await reply.type('image/png').header('cache-control', 'private, max-age=86400').send(await fs.readFile(cached));
      }
    } catch {
      // not cached yet
    }

    let job = inflight.get(name);
    if (!job) {
      job = fetchTile(zoom, x, y, retina).finally(() => inflight.delete(name));
      inflight.set(name, job);
    }
    const got = await job;
    if (!got) return reply.code(502).header('cache-control', 'no-store').send({ error: 'tile_unavailable' });
    if (!got.cache) {
      // CARTO's "API KEY REQUIRED" tile: show it, but never keep it.
      return reply.type('image/png').header('cache-control', 'no-store').send(got.tile);
    }
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(cached, got.tile);
      if (++writes % PRUNE_EVERY === 0) void prune();
    } catch {
      // serve it anyway
    }
    return reply.type('image/png').header('cache-control', 'private, max-age=86400').send(got.tile);
  });
}
