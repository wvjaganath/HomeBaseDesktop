import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createUser, listUsers, UserAdminError } from '../services/userAdmin.js';

/**
 * The household's accounts, for Settings → People. Any signed-in person can
 * see who has an account and add someone (with a starting password they then
 * change). Resetting someone else's password is deliberately not offered here:
 * that would let one account take over another. Use the users script on the PC.
 */
export default async function peopleRoutes(app: FastifyInstance): Promise<void> {
  const { db, auth } = app.ctx;

  app.get('/api/people', { preHandler: [app.requireUser] }, async (req) => ({
    people: listUsers(db).map((u) => ({ id: u.id, email: u.email, displayName: u.displayName, createdAt: u.createdAt, me: u.id === req.userId })),
  }));

  app.post(
    '/api/people',
    { preHandler: [app.requireUser], config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = z.object({ email: z.string(), displayName: z.string(), password: z.string() }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
      try {
        const user = await createUser(db, auth, body.data);
        req.log.info({ event: 'user_added', by: req.userId, userId: user.id }, 'account added from Settings');
        return { person: user };
      } catch (err) {
        if (err instanceof UserAdminError) return reply.code(400).send({ error: 'invalid_input', message: err.message });
        throw err;
      }
    },
  );
}
