import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FetchError, safeFetch } from '../security/safeFetch.js';

/**
 * Dark map tiles (CARTO "Dark Matter") for the Radar and record maps, fetched
 * by the hub with the owner's free CARTO key (Settings → Radar & maps).
 *
 * Since late summer 2026 CARTO stamps "API KEY REQUIRED" on tiles requested
 * without a key. Going through the hub keeps the key off every browser and the
 * Pi, lets all screens share one cache on disk (fewer requests against the
 * free 5 million a month), and means browsers only load images from the hub.
 */
const SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;
const HOSTS = SUBDOMAINS.map((s) => `${s}.basemaps.cartocdn.com`);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_TILE_BYTES = 512 * 1024;
const TTL_MS = 30 * 24 * 3600_000;
const MAX_CACHED = 10_000; // ~200 MB at typical tile sizes
const PRUNE_EVERY = 500;

const params = z.object({
  z: z.coerce.number().int().min(1).max(14),
  x: z.coerce.number().int().min(0),
  file: z.string().regex(/^\d{1,5}(@2x)?\.png$/),
});

export default async function tileRoutes(app: FastifyInstance): Promise<void> {
  const { env, settings } = app.ctx;
  const cacheDir = path.resolve(env.DATA_DIR, 'cache', 'tiles');
  const inflight = new Map<string, Promise<Buffer | null>>();
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

  async function fetchTile(zoom: number, x: number, y: number, retina: boolean): Promise<Buffer | null> {
    const sub = SUBDOMAINS[(x + y) % SUBDOMAINS.length] ?? 'a';
    const url = new URL(`https://${sub}.basemaps.cartocdn.com/dark_all/${zoom}/${x}/${y}${retina ? '@2x' : ''}.png`);
    const key = settings.cartoApiKey;
    if (key) url.searchParams.set('key', key);
    try {
      const res = await safeFetch(url.toString(), { allowHosts: HOSTS, timeoutMs: 8_000, maxBytes: MAX_TILE_BYTES, headers: { accept: 'image/png' } });
      return res.bodyBuffer.subarray(0, 8).equals(PNG_MAGIC) ? res.bodyBuffer : null;
    } catch (err) {
      // Never log the URL: it carries the key.
      app.log.debug({ status: err instanceof FetchError ? err.status : undefined }, 'map tile fetch failed');
      return null;
    }
  }

  app.get('/api/tiles/:z/:x/:file', { preHandler: [app.requireViewer], config: { rateLimit: { max: 1500, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_input' });
    const { z: zoom, x, file } = p.data;
    const y = Number.parseInt(file, 10);
    const retina = file.includes('@2x');
    const max = 2 ** zoom;
    if (x >= max || y >= max) return reply.code(400).send({ error: 'invalid_input' });

    // Cached tiles are kept per key state, so adding a key replaces watermarked ones.
    const name = `${settings.cartoApiKey ? 'k' : 'n'}-${zoom}-${x}-${y}${retina ? '-2x' : ''}.png`;
    const cached = path.join(cacheDir, name);
    try {
      const st = await fs.stat(cached);
      if (Date.now() - st.mtimeMs < TTL_MS) {
        return await reply.type('image/png').header('cache-control', 'private, max-age=604800').send(await fs.readFile(cached));
      }
    } catch {
      // not cached yet
    }

    let job = inflight.get(name);
    if (!job) {
      job = fetchTile(zoom, x, y, retina).finally(() => inflight.delete(name));
      inflight.set(name, job);
    }
    const tile = await job;
    if (!tile) return reply.code(502).send({ error: 'tile_unavailable' });
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(cached, tile);
      if (++writes % PRUNE_EVERY === 0) void prune();
    } catch {
      // serve it anyway
    }
    return reply.type('image/png').header('cache-control', 'private, max-age=604800').send(tile);
  });
}
