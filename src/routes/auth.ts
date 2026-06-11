import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { env } from '../env.js';
import { credentialsSchema, registerSchema, refreshSchema } from '../schemas.js';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeFamilyByToken,
} from '../auth.js';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  // Tight per-IP limit on credential endpoints to slow brute force.
  const authLimit = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };

  app.post('/auth/register', authLimit, async (req, reply) => {
    if (!env.allowRegistration) {
      return reply.code(403).send({ error: 'registration_disabled' });
    }
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten().fieldErrors });
    }
    const email = parsed.data.email.toLowerCase();
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
      return reply.code(409).send({ error: 'email_taken' });
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, email, parsed.data.displayName, await hashPassword(parsed.data.password), new Date().toISOString());

    return {
      user: { id, email, displayName: parsed.data.displayName },
      accessToken: await signAccessToken(id, parsed.data.displayName),
      refreshToken: issueRefreshToken(id),
    };
  });

  app.post('/auth/login', authLimit, async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const user = db
      .prepare(`SELECT id, email, display_name, password_hash FROM users WHERE email = ?`)
      .get(parsed.data.email.toLowerCase()) as UserRow | undefined;
    const ok = user !== undefined && (await verifyPassword(user.password_hash, parsed.data.password));
    if (!ok || user === undefined) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    return {
      user: { id: user.id, email: user.email, displayName: user.display_name },
      accessToken: await signAccessToken(user.id, user.display_name),
      refreshToken: issueRefreshToken(user.id),
    };
  });

  app.post('/auth/refresh', authLimit, async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const rotated = rotateRefreshToken(parsed.data.refreshToken);
    if (!rotated) {
      return reply.code(401).send({ error: 'invalid_refresh_token' });
    }
    const user = db
      .prepare(`SELECT id, email, display_name FROM users WHERE id = ?`)
      .get(rotated.userId) as UserRow | undefined;
    if (!user) {
      return reply.code(401).send({ error: 'invalid_refresh_token' });
    }
    return {
      accessToken: await signAccessToken(user.id, user.display_name),
      refreshToken: rotated.token,
    };
  });

  app.post('/auth/logout', async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (parsed.success) {
      revokeFamilyByToken(parsed.data.refreshToken);
    }
    return reply.send({ ok: true });
  });
}
