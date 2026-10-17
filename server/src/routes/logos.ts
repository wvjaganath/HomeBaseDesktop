import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { safeFetch } from '../security/safeFetch.js';

/**
 * Airline logos by ICAO code, resized server-side to exactly the size a screen
 * needs (WebP) so the Pi never decodes oversized images.
 *
 * Source: a local clone of github.com/Jxck-S/airline-logos at a pinned commit,
 * in $DATA_DIR/logo-src (see deploy/docker-compose.yml, "logos" service).
 * Its files are treated as untrusted: plain PNG files only, size-capped.
 * Fallback: the tracker's own small logo, shown pixelated by the client.
 */
const SOURCES = {
  square: ['custom_logos', 'flightaware_logos', 'radarbox_logos'],
  banner: ['custom_banners', 'avcodes_banners', 'radarbox_banners', 'fr24_banners'],
} as const;

const SIZES = [24, 32, 48, 64, 96, 128, 160, 192, 256] as const;

const paramsSchema = z.object({ icao: z.string().regex(/^[A-Z0-9]{2,4}$/) });
const querySchema = z.object({
  kind: z.enum(['square', 'banner']).default('square'),
  h: z.coerce
    .number()
    .int()
    .default(96)
    .transform((h) => SIZES.reduce((best, s) => (Math.abs(s - h) < Math.abs(best - h) ? s : best), 96)),
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

/**
 * A logo file from the downloaded set, only if it's a plain file (not a
 * symlink, which a changed upstream repo could point anywhere), not oversized,
 * and really a PNG. Otherwise null, and the next source is tried.
 */
export async function readLogoSource(file: string): Promise<Buffer | null> {
  try {
    const st = await fs.lstat(file);
    if (!st.isFile() || st.size === 0 || st.size > MAX_SOURCE_BYTES) return null;
    const buf = await fs.readFile(file);
    return buf.subarray(0, 8).equals(PNG_MAGIC) ? buf : null;
  } catch {
    return null;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export default async function logoRoutes(app: FastifyInstance): Promise<void> {
  const { env } = app.ctx;
  const srcRoot = path.resolve(env.DATA_DIR, 'logo-src');
  const cacheRoot = path.resolve(env.DATA_DIR, 'cache', 'logos');
  const trackerHost = env.TRACKER_URL ? new URL(env.TRACKER_URL).hostname : '';

  app.get('/api/logo/:icao', { preHandler: [app.requireViewer] }, async (req, reply) => {
    const params = paramsSchema.safeParse(req.params);
    const query = querySchema.safeParse(req.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'invalid_input' });
    const { icao } = params.data;
    const { kind, h } = query.data;

    const cached = path.join(cacheRoot, `${kind}-${icao}-${h}.webp`);
    reply.header('cache-control', 'private, max-age=86400');
    if (await exists(cached)) {
      return reply.type('image/webp').send(await fs.readFile(cached));
    }

    for (const dir of SOURCES[kind]) {
      const src = await readLogoSource(path.join(srcRoot, dir, `${icao}.png`));
      if (!src) continue;
      let out: Buffer;
      try {
        out = await sharp(src, { limitInputPixels: 4_000_000, failOn: 'error' })
          .resize({ height: h, width: kind === 'banner' ? h * 8 : h, fit: 'inside', kernel: 'lanczos3', withoutEnlargement: false })
          .webp({ quality: 90, alphaQuality: 100 })
          .toBuffer();
      } catch {
        continue; // damaged image: try the next source
      }
      await fs.mkdir(cacheRoot, { recursive: true });
      await fs.writeFile(cached, out);
      return reply.type('image/webp').send(out);
    }

    if (kind === 'square' && trackerHost) {
      try {
        const res = await safeFetch(`${env.TRACKER_URL}/logos/${icao}.png`, {
          allowHosts: [trackerHost],
          allowHttp: true,
          allowPrivate: true,
          timeoutMs: 4_000,
          maxBytes: 256 * 1024,
        });
        reply.header('x-logo-source', 'tracker');
        if (!res.bodyBuffer.subarray(0, 8).equals(PNG_MAGIC)) throw new Error('not a png');
        return await reply.type('image/png').send(res.bodyBuffer);
      } catch {
        // fall through
      }
    }
    reply.header('cache-control', 'private, max-age=3600');
    return reply.code(404).send({ error: 'no_logo' });
  });
}
