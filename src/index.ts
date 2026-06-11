import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import { migrate } from './db.js';
import { verifyAccessToken } from './auth.js';
import authRoutes from './routes/auth.js';
import syncRoutes from './routes/sync.js';
import shareRoutes from './routes/shares.js';

migrate();

const app = Fastify({
  logger: true,
  bodyLimit: 2 * 1024 * 1024,
});

await app.register(helmet);
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

app.decorate('authenticate', async (req, reply) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  const userId = token ? await verifyAccessToken(token) : null;
  if (!userId) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  req.userId = userId;
});

app.get('/health', async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(syncRoutes);
await app.register(shareRoutes);

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
