import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/db.js';
import { weekReminders } from '../src/services/lists.js';

describe('week of reminders (Home)', () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(':memory:');
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u1', 'a@x', 'A', 'x', 'now')`).run();
  });
  afterEach(() => db.close());

  const add = (id: string, dueAt: Date, extra: object = {}): void => {
    db.prepare(`INSERT INTO items (collection, id, owner_id, updated_at, server_seq, payload) VALUES ('reminders', ?, 'u1', 'now', 1, ?)`).run(
      id,
      JSON.stringify({ title: id, notes: '', dueAt: dueAt.toISOString(), repeatRule: 'weekly', completedAt: null, ...extra }),
    );
  };

  it('keeps overdue ones and the next 7 days through the end of the last day', () => {
    const now = new Date(2026, 10, 19, 16, 12); // Thu Nov 19, 4:12 PM
    add('overdue', new Date(2026, 10, 17, 18, 0));
    add('today', new Date(2026, 10, 19, 17, 30));
    add('day7-late', new Date(2026, 10, 26, 23, 30));
    add('day8', new Date(2026, 10, 27, 0, 30));
    add('done', new Date(2026, 10, 20, 9, 0), { completedAt: new Date().toISOString() });
    const week = weekReminders(db, 'u1', now);
    expect(week.items.map((r) => r.id)).toEqual(['overdue', 'today', 'day7-late']);
    expect(week.items[0]?.overdue).toBe(true);
    expect(week.items[1]?.repeatRule).toBe('weekly');
    expect(week.total).toBe(3);
  });
});
