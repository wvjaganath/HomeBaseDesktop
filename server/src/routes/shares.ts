import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nextSeq } from '../db.js';
import { shareCreateSchema } from '../schemas.js';

export default async function shareRoutes(app: FastifyInstance): Promise<void> {
  const { db, bus } = app.ctx;
  app.get('/users', { preHandler: [app.requireUser] }, async () => {
    return {
      users: db.prepare(`SELECT id, email, display_name AS displayName FROM users`).all(),
    };
  });

  app.post('/shares', { preHandler: [app.requireUser] }, async (req, reply) => {
    const parsed = shareCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: z.flattenError(parsed.error).fieldErrors });
    }
    const me = req.userId;
    const { itemType, itemId, sharedWithId, permission } = parsed.data;

    if (sharedWithId === me) {
      return reply.code(400).send({ error: 'cannot_share_with_self' });
    }
    const target = db.prepare(`SELECT id FROM users WHERE id = ?`).get(sharedWithId);
    if (!target) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    const item = db
      .prepare(`SELECT owner_id FROM items WHERE collection = ? AND id = ? AND deleted_at IS NULL`)
      .get(itemType, itemId) as { owner_id: string } | undefined;
    if (!item || item.owner_id !== me) {
      // 404 either way: don't reveal whether someone else's item exists.
      return reply.code(404).send({ error: 'item_not_found' });
    }

    const shareId = randomUUID();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO shares (id, item_type, item_id, owner_id, shared_with_id, permission, created_at, deleted_at, server_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT (item_type, item_id, shared_with_id) DO UPDATE SET
           permission = excluded.permission,
           deleted_at = NULL,
           server_seq = excluded.server_seq`,
      ).run(shareId, itemType, itemId, me, sharedWithId, permission, new Date().toISOString(), nextSeq(db));
      // Touch the item so the recipient's next delta pull picks it up even
      // though the item row itself didn't change.
      db.prepare(`UPDATE items SET server_seq = ? WHERE collection = ? AND id = ?`).run(
        nextSeq(db),
        itemType,
        itemId,
      );
    })();
    bus.emit('items', { userIds: [me, sharedWithId] });

    return { ok: true };
  });

  app.delete('/shares/:id', { preHandler: [app.requireUser] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const share = db
      .prepare(`SELECT owner_id, shared_with_id FROM shares WHERE id = ? AND deleted_at IS NULL`)
      .get(id) as { owner_id: string; shared_with_id: string } | undefined;
    if (!share || share.owner_id !== req.userId) {
      return reply.code(404).send({ error: 'share_not_found' });
    }
    db.prepare(`UPDATE shares SET deleted_at = ?, server_seq = ? WHERE id = ?`).run(
      new Date().toISOString(),
      nextSeq(db),
      id,
    );
    bus.emit('items', { userIds: [share.owner_id, share.shared_with_id] });
    return { ok: true };
  });
}
