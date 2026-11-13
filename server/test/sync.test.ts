import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerUser, testApp } from './helpers.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  await app.close();
});

const note = (title: string, pinned = true) => ({
  title,
  body: '',
  isChecklist: true,
  pinned,
  items: [{ id: randomUUID(), text: 'Milk', done: false, position: 0 }],
});

describe('sync protocol', () => {
  it('pushes, pulls, enforces ACLs and sharing', async () => {
    const a = await registerUser(app, 'a@example.com', 'A');
    const b = await registerUser(app, 'b@example.com', 'B');
    const noteId = randomUUID();
    const now = new Date().toISOString();

    const push = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${a.accessToken}` },
      payload: { changes: [{ collection: 'notes', id: noteId, updatedAt: now, deletedAt: null, payload: note('Groceries') }] },
    });
    expect(push.statusCode).toBe(200);
    expect(push.json().results[0].status).toBe('applied');

    // B cannot see or overwrite A's note before it is shared.
    const pullB = await app.inject({ method: 'GET', url: '/sync/pull?since=0', headers: { authorization: `Bearer ${b.accessToken}` } });
    expect(pullB.json().changes).toHaveLength(0);
    const hijack = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${b.accessToken}` },
      payload: { changes: [{ collection: 'notes', id: noteId, updatedAt: new Date(Date.now() + 1000).toISOString(), deletedAt: null, payload: note('Mine now') }] },
    });
    expect(hijack.json().results[0].status).toBe('forbidden');

    const share = await app.inject({
      method: 'POST',
      url: '/shares',
      headers: { authorization: `Bearer ${a.accessToken}` },
      payload: { itemType: 'notes', itemId: noteId, sharedWithId: b.id, permission: 'read' },
    });
    expect(share.statusCode).toBe(200);
    const pullB2 = await app.inject({ method: 'GET', url: '/sync/pull?since=0', headers: { authorization: `Bearer ${b.accessToken}` } });
    expect(pullB2.json().changes.map((c: { id: string }) => c.id)).toContain(noteId);

    // The dashboard view shows the shared pinned note to B, flagged as shared.
    const lists = await app.inject({ method: 'GET', url: '/api/lists', headers: { authorization: `Bearer ${b.accessToken}` } });
    expect(lists.json().notes.items[0].shared).toBe(true);
  });

  it('rejects invalid payloads per item without failing the batch', async () => {
    const a = await registerUser(app, 'a@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${a.accessToken}` },
      payload: {
        changes: [
          { collection: 'notes', id: randomUUID(), updatedAt: new Date().toISOString(), deletedAt: null, payload: { nope: true } },
          { collection: 'notes', id: randomUUID(), updatedAt: new Date().toISOString(), deletedAt: null, payload: note('ok') },
        ],
      },
    });
    expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(['invalid', 'applied']);
  });

  it('accepts body measurements of any size (no range limits) but still wants numbers', async () => {
    const a = await registerUser(app, 'a@example.com');
    // Values entered in inches arrive in cm: 15 in neck = 38.1 cm, 13 in arm = 33.02 cm.
    // The old ranges rejected these (and anything else) outright; now any finite number goes.
    const measurement = (overrides: Record<string, unknown>) => ({
      recordedAt: new Date().toISOString(),
      neckCm: 38.1, chestCm: null, leftArmCm: 33.02, rightArmCm: 5, leftThighCm: 500,
      rightThighCm: 0, waistCm: 86.36,
      ...overrides,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${a.accessToken}` },
      payload: {
        changes: [
          { collection: 'measurements', id: randomUUID(), updatedAt: new Date().toISOString(), deletedAt: null, payload: measurement({}) },
          { collection: 'measurements', id: randomUUID(), updatedAt: new Date().toISOString(), deletedAt: null, payload: measurement({ waistCm: 'thirty-four' }) },
        ],
      },
    });
    expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(['applied', 'invalid']);
  });

  it('accepts uppercase GUIDs as sent by the iOS app', async () => {
    const a = await registerUser(app, 'a@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${a.accessToken}` },
      payload: { changes: [{ collection: 'notes', id: randomUUID().toUpperCase(), updatedAt: new Date().toISOString(), deletedAt: null, payload: note('x') }] },
    });
    expect(res.json().results[0].status).toBe('applied');
  });
});
