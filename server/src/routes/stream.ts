import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const MAX_STREAMS = 40;
const MAX_PER_PRINCIPAL = 6;
const HEARTBEAT_MS = 25_000;

const querySchema = z.object({
  topics: z
    .string()
    .max(100)
    .default('tracker,items,calendar')
    .transform((s) => new Set(s.split(',').filter((t) => ['tracker', 'radar', 'items', 'calendar'].includes(t)))),
});

/**
 * Server-Sent Events: one long-lived connection per screen. The server polls
 * upstream sources and pushes small updates; screens never poll.
 */
export default async function streamRoutes(app: FastifyInstance): Promise<void> {
  const { bus, tracker, radar } = app.ctx;
  let open = 0;
  const perPrincipal = new Map<string, number>();

  app.get('/api/stream', { preHandler: [app.requireViewer] }, async (req, reply) => {
    const q = querySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' });
    const topics = q.data.topics;
    const p = req.principal;
    if (!p) return reply.code(401).send({ error: 'unauthorized' });
    const key = p.kind === 'device' ? `d:${p.deviceId}` : `u:${p.userId}`;
    if (open >= MAX_STREAMS || (perPrincipal.get(key) ?? 0) >= MAX_PER_PRINCIPAL) {
      return reply.code(429).send({ error: 'too_many_streams' });
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    });
    open += 1;
    perPrincipal.set(key, (perPrincipal.get(key) ?? 0) + 1);

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('hello', { topics: [...topics], build: app.webBuild });

    const unsubs: Array<() => void> = [];
    if (topics.has('tracker')) {
      send('tracker', tracker.snapshot);
      unsubs.push(bus.on('tracker', () => send('tracker', tracker.snapshot)));
    }
    if (topics.has('radar')) {
      radar.touch();
      send('radar', radar.snapshot);
      unsubs.push(bus.on('radar', () => send('radar', radar.snapshot)));
    }
    if (topics.has('items')) {
      unsubs.push(
        bus.on('items', ({ userIds }) => {
          if (userIds.includes(p.userId)) send('items', {});
        }),
      );
    }
    if (topics.has('calendar')) {
      unsubs.push(
        bus.on('calendar', ({ userId }) => {
          if (userId === p.userId) send('calendar', {});
        }),
      );
    }
    if (p.kind === 'device') {
      unsubs.push(
        bus.on('device', ({ deviceId, action }) => {
          if (deviceId !== p.deviceId) return;
          send('device', { action });
          if (action === 'revoked') res.end();
        }),
      );
    }

    const heartbeat = setInterval(() => {
      res.write(': keep-alive\n\n');
      if (topics.has('radar')) radar.touch();
    }, HEARTBEAT_MS);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      for (const u of unsubs) u();
      open -= 1;
      const n = (perPrincipal.get(key) ?? 1) - 1;
      if (n <= 0) perPrincipal.delete(key);
      else perPrincipal.set(key, n);
    };
    req.raw.once('close', cleanup);
    return reply;
  });
}
