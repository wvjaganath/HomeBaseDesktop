import { z } from 'zod';
import type { DB } from '../db.js';

/**
 * Read-only views of a user's synced notes and reminders for the dashboard
 * (own items plus items shared with them). Writing still goes through the
 * existing /sync protocol so the iOS app and the web stay consistent.
 */

const reminderPayload = z.object({
  title: z.string(),
  notes: z.string().default(''),
  dueAt: z.string(),
  repeatRule: z.string().default('none'),
  completedAt: z.string().nullable().default(null),
});

const notePayload = z.object({
  title: z.string(),
  body: z.string().default(''),
  isChecklist: z.boolean().default(false),
  pinned: z.boolean().default(false),
  items: z
    .array(z.object({ id: z.string(), text: z.string(), done: z.boolean(), position: z.number() }))
    .default([]),
});

export interface DashboardReminder {
  id: string;
  title: string;
  dueAt: string;
  overdue: boolean;
  shared: boolean;
  repeatRule: string;
}

export interface DashboardNote {
  id: string;
  title: string;
  body: string;
  isChecklist: boolean;
  items: Array<{ id: string; text: string; done: boolean }>;
  shared: boolean;
  updatedAt: string;
}

interface Row {
  id: string;
  owner_id: string;
  updated_at: string;
  payload: string;
}

function visibleRows(db: DB, collection: 'notes' | 'reminders', userId: string): Row[] {
  return db
    .prepare(
      `SELECT i.id, i.owner_id, i.updated_at, i.payload FROM items i
       WHERE i.collection = ? AND i.deleted_at IS NULL
         AND (i.owner_id = ? OR EXISTS (
           SELECT 1 FROM shares s WHERE s.item_type = i.collection AND s.item_id = i.id
             AND s.shared_with_id = ? AND s.deleted_at IS NULL))`,
    )
    .all(collection, userId, userId) as Row[];
}

export function openReminders(db: DB, userId: string, now = new Date(), limit = 8): { items: DashboardReminder[]; total: number } {
  const list: DashboardReminder[] = [];
  for (const row of visibleRows(db, 'reminders', userId)) {
    const p = reminderPayload.safeParse(JSON.parse(row.payload));
    if (!p.success || p.data.completedAt !== null) continue;
    list.push({
      id: row.id,
      title: p.data.title,
      dueAt: p.data.dueAt,
      overdue: Date.parse(p.data.dueAt) < now.getTime(),
      shared: row.owner_id !== userId,
      repeatRule: p.data.repeatRule,
    });
  }
  list.sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1));
  return { items: list.slice(0, limit), total: list.length };
}

export function pinnedNotes(db: DB, userId: string, limit = 3): { items: DashboardNote[]; totalPinned: number } {
  const list: DashboardNote[] = [];
  for (const row of visibleRows(db, 'notes', userId)) {
    const p = notePayload.safeParse(JSON.parse(row.payload));
    if (!p.success || !p.data.pinned) continue;
    const items = [...p.data.items]
      .sort((a, b) => Number(a.done) - Number(b.done) || a.position - b.position)
      .map(({ id, text, done }) => ({ id, text, done }));
    list.push({
      id: row.id,
      title: p.data.title,
      body: p.data.body.slice(0, 400),
      isChecklist: p.data.isChecklist,
      items,
      shared: row.owner_id !== userId,
      updatedAt: row.updated_at,
    });
  }
  list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { items: list.slice(0, limit), totalPinned: list.length };
}
