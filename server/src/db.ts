import Database from 'better-sqlite3';
import { env } from './env.js';

export const db = new Database(env.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Append-only migrations: never edit an existing entry, always add a new one.
const migrations: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    family_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_refresh_family ON refresh_tokens(family_id);

  CREATE TABLE items (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id),
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    server_seq INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE INDEX idx_items_seq ON items(server_seq);
  CREATE INDEX idx_items_owner ON items(owner_id);

  CREATE TABLE shares (
    id TEXT PRIMARY KEY,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id),
    shared_with_id TEXT NOT NULL REFERENCES users(id),
    permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    server_seq INTEGER NOT NULL,
    UNIQUE (item_type, item_id, shared_with_id)
  );
  CREATE INDEX idx_shares_seq ON shares(server_seq);

  CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
  INSERT INTO meta (key, value) VALUES ('sync_seq', 0);
  `,
];

export function migrate(): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let i = version; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

/** Monotonic change counter driving delta pulls. Call inside a transaction. */
export function nextSeq(): number {
  const row = db
    .prepare(`UPDATE meta SET value = value + 1 WHERE key = 'sync_seq' RETURNING value`)
    .get() as { value: number };
  return row.value;
}

export function currentSeq(): number {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'sync_seq'`).get() as { value: number };
  return row.value;
}
