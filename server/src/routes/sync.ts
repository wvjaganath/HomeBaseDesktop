import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nextSeq, currentSeq } from '../db.js';
import { pushSchema, pullQuerySchema, collectionPayloads, shareableCollections } from '../schemas.js';
import type { CollectionName } from '../schemas.js';

interface ItemRow {
  collection: string;
  id: string;
  owner_id: string;
  updated_at: string;
  deleted_at: string | null;
  server_seq: number;
  payload: string;
}

interface ShareRow {
  id: string;
  item_type: string;
  item_id: string;
  owner_id: string;
  shared_with_id: string;
  permission: string;
  created_at: string;
  deleted_at: string | null;
  server_seq: number;
}

const PULL_LIMIT = 1000;

export default async function syncRoutes(app: FastifyInstance): Promise<void> {
  const { db, bus } = app.ctx;
  const shareRecipients = db.prepare(
    `SELECT shared_with_id FROM shares WHERE item_type = ? AND item_id = ? AND deleted_at IS NULL`,
  );
  const getItem = db.prepare(
    `SELECT owner_id, updated_at, payload FROM items WHERE collection = ? AND id = ?`,
  );
  const getWriteShare = db.prepare(
    `SELECT 1 FROM shares
     WHERE item_type = ? AND item_id = ? AND shared_with_id = ? AND permission = 'write' AND deleted_at IS NULL`,
  );
  const upsertItem = db.prepare(
    `INSERT INTO items (collection, id, owner_id, updated_at, deleted_at, server_seq, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (collection, id) DO UPDATE SET
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       server_seq = excluded.server_seq,
       payload = excluded.payload`,
  );

  app.post('/sync/push', { preHandler: [app.requireUser], bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    const parsed = pushSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: z.flattenError(parsed.error) });
    }
    const me = req.userId;
    const results: Array<{ collection: string; id: string; status: string }> = [];
    const affected = new Set<string>();

    db.transaction(() => {
      for (const change of parsed.data.changes) {
        const existing = getItem.get(change.collection, change.id) as
          | Pick<ItemRow, 'owner_id' | 'updated_at' | 'payload'>
          | undefined;

        let ownerId = me;
        if (existing) {
          ownerId = existing.owner_id;
          const sharedWrite =
            shareableCollections.includes(change.collection as CollectionName) &&
            getWriteShare.get(change.collection, change.id, me) !== undefined;
          if (ownerId !== me && !sharedWrite) {
            results.push({ collection: change.collection, id: change.id, status: 'forbidden' });
            continue;
          }
          if (existing.updated_at >= change.updatedAt) {
            results.push({ collection: change.collection, id: change.id, status: 'stale' });
            continue;
          }
        }

        let payloadJson: string;
        if (change.deletedAt !== null) {
          payloadJson = existing?.payload ?? '{}';
        } else {
          const payloadParsed = collectionPayloads[change.collection].safeParse(change.payload);
          if (!payloadParsed.success) {
            results.push({ collection: change.collection, id: change.id, status: 'invalid' });
            continue;
          }
          payloadJson = JSON.stringify(payloadParsed.data);
        }

        upsertItem.run(
          change.collection,
          change.id,
          ownerId,
          change.updatedAt,
          change.deletedAt,
          nextSeq(db),
          payloadJson,
        );
        results.push({ collection: change.collection, id: change.id, status: 'applied' });
        affected.add(ownerId);
        for (const r of shareRecipients.all(change.collection, change.id) as Array<{ shared_with_id: string }>) {
          affected.add(r.shared_with_id);
        }
      }
    })();

    if (affected.size > 0) bus.emit('items', { userIds: [...affected] });
    return { results, serverSeq: currentSeq(db) };
  });

  app.get('/sync/pull', { preHandler: [app.requireUser] }, async (req, reply) => {
    const parsed = pullQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const me = req.userId;
    const since = parsed.data.since;

    const items = db
      .prepare(
        `SELECT * FROM items i
         WHERE i.server_seq > ?
           AND (
             i.owner_id = ?
             OR EXISTS (
               SELECT 1 FROM shares s
               WHERE s.item_type = i.collection AND s.item_id = i.id
                 AND s.shared_with_id = ? AND s.deleted_at IS NULL
             )
           )
         ORDER BY i.server_seq ASC
         LIMIT ${PULL_LIMIT}`,
      )
      .all(since, me, me) as ItemRow[];

    const shares = db
      .prepare(
        `SELECT * FROM shares WHERE server_seq > ? AND (owner_id = ? OR shared_with_id = ?) ORDER BY server_seq ASC`,
      )
      .all(since, me, me) as ShareRow[];

    const users = db
      .prepare(`SELECT id, email, display_name AS displayName FROM users`)
      .all();

    let cursor = since;
    for (const row of items) cursor = Math.max(cursor, row.server_seq);
    for (const row of shares) cursor = Math.max(cursor, row.server_seq);

    return {
      changes: items.map((row) => ({
        collection: row.collection,
        id: row.id,
        ownerId: row.owner_id,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
        payload: JSON.parse(row.payload) as unknown,
      })),
      shares: shares.map((row) => ({
        id: row.id,
        itemType: row.item_type,
        itemId: row.item_id,
        ownerId: row.owner_id,
        sharedWithId: row.shared_with_id,
        permission: row.permission,
        deletedAt: row.deleted_at,
      })),
      users,
      cursor,
      hasMore: items.length === PULL_LIMIT,
    };
  });
}
