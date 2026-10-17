/* eslint-disable @typescript-eslint/no-dynamic-delete -- the store is a reactive record keyed by item id; deleting a key is how an item leaves it. */
import { api, ApiError } from './api';

/**
 * Browser client for the HomeBase sync protocol (/sync/pull + /sync/push), the
 * same one the iOS app uses. Changes are applied locally first (optimistic),
 * then pushed; the server applies last-write-wins by `updatedAt` and enforces
 * ownership and sharing. Unlike the app there is no offline queue: a failed
 * push is reported and the item is reloaded from the server.
 */

// --- Payload shapes (mirror server/src/schemas.ts) ---------------------------

export interface NoteItem {
  id: string;
  text: string;
  done: boolean;
  position: number;
}
export interface NotePayload {
  title: string;
  body: string;
  isChecklist: boolean;
  pinned: boolean;
  items: NoteItem[];
}
export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly';
export interface ReminderPayload {
  title: string;
  notes: string;
  dueAt: string;
  repeatRule: RepeatRule;
  completedAt: string | null;
}
export interface WeightEntryPayload {
  date: string;
  weight: number;
  note: string;
}
export interface WorkoutLogPayload {
  date: string;
  dayType: string;
  duration: string;
  note: string;
  exercises: Array<{ id: string; name: string; note: string }>;
}
export interface FitnessProfilePayload {
  heightIn: number;
  startWeight: number;
  startDate: string;
  goals: number[];
}
export interface MealEntryPayload {
  date: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  name: string;
  recipeId: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  note: string;
}
export interface MeasurementPayload {
  recordedAt: string;
  neckCm: number | null;
  chestCm: number | null;
  leftArmCm: number | null;
  rightArmCm: number | null;
  leftThighCm: number | null;
  rightThighCm: number | null;
  waistCm: number | null;
}
export interface DailyFitnessPayload {
  date: string;
  steps: number | null;
  restingHr: number | null;
  avgHr: number | null;
  minHr: number | null;
  maxHr: number | null;
  activeKcal: number | null;
  exerciseMin: number | null;
}
export interface WorkoutPayload {
  hkUuid: string;
  activityType: string;
  startedAt: string;
  endedAt: string;
  durationS: number;
  kcal: number | null;
  distanceM: number | null;
}

export interface Payloads {
  notes: NotePayload;
  reminders: ReminderPayload;
  weight_entries: WeightEntryPayload;
  workout_logs: WorkoutLogPayload;
  fitness_profile: FitnessProfilePayload;
  meal_entries: MealEntryPayload;
  measurements: MeasurementPayload;
  daily_fitness: DailyFitnessPayload;
  workouts: WorkoutPayload;
}
export type Collection = keyof Payloads;
export type Shareable = 'notes' | 'reminders';

export interface Item<C extends Collection = Collection> {
  id: string;
  ownerId: string;
  updatedAt: string;
  payload: Payloads[C];
}

export interface Share {
  id: string;
  itemType: string;
  itemId: string;
  ownerId: string;
  sharedWithId: string;
  permission: 'read' | 'write';
  deletedAt: string | null;
}

export interface SyncUser {
  id: string;
  email: string;
  displayName: string;
}

interface PullResponse {
  changes: Array<{ collection: string; id: string; ownerId: string; updatedAt: string; deletedAt: string | null; payload: unknown }>;
  shares: Share[];
  users: SyncUser[];
  cursor: number;
  hasMore: boolean;
}

interface PushResponse {
  results: Array<{ collection: string; id: string; status: 'applied' | 'stale' | 'forbidden' | 'invalid' }>;
}

const COLLECTIONS: Collection[] = [
  'notes',
  'reminders',
  'weight_entries',
  'workout_logs',
  'fitness_profile',
  'meal_entries',
  'measurements',
  'daily_fitness',
  'workouts',
];

type Store = { [C in Collection]: Record<string, Item<C>> };
const emptyStore = (): Store =>
  Object.fromEntries(COLLECTIONS.map((c) => [c, {}])) as unknown as Store;

/** Strictly increasing ISO timestamps, so two quick edits never tie under LWW. */
let lastStamp = 0;
function stamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

class SyncStore {
  items = $state<Store>(emptyStore());
  shares = $state<Record<string, Share>>({});
  users = $state<SyncUser[]>([]);
  loaded = $state(false);
  loading = $state(false);
  error = $state('');
  me = $state('');

  private cursor = 0;
  private pulling: Promise<void> | null = null;

  /** First load (or a refresh): pulls every change since the last cursor. */
  async ensure(meId: string): Promise<void> {
    if (this.me && this.me !== meId) this.reset();
    this.me = meId;
    if (this.loaded) return;
    await this.pull();
  }

  reset(): void {
    this.items = emptyStore();
    this.shares = {};
    this.users = [];
    this.cursor = 0;
    this.loaded = false;
  }

  /** Delta pull; safe to call often (e.g. on every SSE "items" event). */
  pull(): Promise<void> {
    this.pulling ??= this.doPull(false).finally(() => {
      this.pulling = null;
    });
    return this.pulling;
  }

  /** Full re-sync where the server wins (after a refused or failed push). */
  private async resync(): Promise<void> {
    await this.pulling?.catch(() => undefined);
    this.cursor = 0;
    this.pulling = this.doPull(true).finally(() => {
      this.pulling = null;
    });
    return this.pulling;
  }

  private async doPull(serverWins: boolean): Promise<void> {
    this.loading = true;
    const seen: Record<string, true> = {};
    try {
      for (let page = 0; page < 200; page++) {
        const res = await api.get<PullResponse>(`/sync/pull?since=${this.cursor}`);
        for (const ch of res.changes) {
          if (!(COLLECTIONS as string[]).includes(ch.collection)) continue;
          const coll = this.items[ch.collection as Collection] as Record<string, Item>;
          const current = coll[ch.id];
          seen[`${ch.collection}:${ch.id}`] = true;
          const newer = serverWins || !current || current.updatedAt <= ch.updatedAt;
          if (ch.deletedAt) {
            if (newer) delete coll[ch.id];
            continue;
          }
          if (newer) {
            coll[ch.id] = { id: ch.id, ownerId: ch.ownerId, updatedAt: ch.updatedAt, payload: ch.payload as Payloads[Collection] };
          }
        }
        for (const s of res.shares) {
          if (s.deletedAt) {
            delete this.shares[s.id];
            // Unshared from me: the item is no longer mine to see.
            if (s.sharedWithId === this.me && (s.itemType === 'notes' || s.itemType === 'reminders')) {
              const coll = this.items[s.itemType] as Record<string, Item>;
              if (coll[s.itemId]?.ownerId !== this.me) delete coll[s.itemId];
            }
          } else {
            this.shares[s.id] = s;
          }
        }
        this.users = res.users;
        this.cursor = res.cursor;
        if (!res.hasMore) break;
      }
      if (serverWins) {
        // Anything the server no longer returns (deleted, or no longer shared) goes.
        for (const c of COLLECTIONS) {
          const coll = this.items[c] as Record<string, Item>;
          for (const id of Object.keys(coll)) if (!seen[`${c}:${id}`]) delete coll[id];
        }
      }
      this.loaded = true;
      this.error = '';
    } catch (err) {
      this.error = err instanceof ApiError ? err.code : 'Could not load data';
      throw err;
    } finally {
      this.loading = false;
    }
  }

  list<C extends Collection>(collection: C): Array<Item<C>> {
    return Object.values(this.items[collection]);
  }

  get<C extends Collection>(collection: C, id: string): Item<C> | undefined {
    return this.items[collection][id];
  }

  /** Create or update an item. Returns false if the server refused it. */
  async save<C extends Collection>(collection: C, id: string, payload: Payloads[C]): Promise<boolean> {
    const coll = this.items[collection] as Record<string, Item<C>>;
    const existing = coll[id];
    const updatedAt = stamp();
    coll[id] = { id, ownerId: existing?.ownerId ?? this.me, updatedAt, payload: structuredClone($state.snapshot(payload) as Payloads[C]) };
    return this.push([{ collection, id, updatedAt, deletedAt: null, payload: coll[id].payload }]);
  }

  /** Soft-delete (tombstone), so the deletion reaches the phones too. */
  async remove(collection: Collection, id: string): Promise<boolean> {
    const coll = this.items[collection] as Record<string, Item>;
    const prev = coll[id];
    delete coll[id];
    const now = stamp();
    const ok = await this.push([{ collection, id, updatedAt: now, deletedAt: now, payload: {} }]);
    if (!ok && prev) coll[id] = prev;
    return ok;
  }

  private async push(
    changes: Array<{ collection: Collection; id: string; updatedAt: string; deletedAt: string | null; payload: unknown }>,
  ): Promise<boolean> {
    try {
      const res = await api.post<PushResponse>('/sync/push', { changes });
      const bad = res.results.filter((r) => r.status !== 'applied');
      if (bad.length > 0) {
        this.error =
          bad[0]?.status === 'forbidden'
            ? 'You can only view this item; it was shared with you as read-only.'
            : bad[0]?.status === 'invalid'
              ? 'That change was rejected as invalid.'
              : 'Someone changed this item at the same time; showing the latest version.';
        // Re-sync from scratch so the local copy matches the server again.
        await this.resync();
        return false;
      }
      this.error = '';
      return true;
    } catch (err) {
      this.error = err instanceof ApiError ? `Couldn’t save (${err.code}).` : 'Couldn’t reach the hub to save.';
      await this.resync().catch(() => undefined);
      return false;
    }
  }

  // --- Sharing --------------------------------------------------------------

  partner(): SyncUser | undefined {
    return this.users.find((u) => u.id !== this.me);
  }

  shareFor(itemType: Shareable, itemId: string): Share | undefined {
    return Object.values(this.shares).find((s) => s.itemType === itemType && s.itemId === itemId);
  }

  /** read-only if the item belongs to someone else and was shared as "read". */
  canEdit(itemType: Shareable, item: Item): boolean {
    if (item.ownerId === this.me) return true;
    const s = Object.values(this.shares).find((x) => x.itemType === itemType && x.itemId === item.id && x.sharedWithId === this.me);
    return s?.permission === 'write';
  }

  async share(itemType: Shareable, itemId: string, sharedWithId: string, permission: 'read' | 'write'): Promise<void> {
    await api.post('/shares', { itemType, itemId, sharedWithId, permission });
    await this.pull();
  }

  async unshare(shareId: string): Promise<void> {
    await api.del(`/shares/${shareId}`);
    delete this.shares[shareId];
    await this.pull();
  }
}

export const sync = new SyncStore();
