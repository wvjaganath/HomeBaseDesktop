import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;

// Append-only migrations: never edit an existing entry, always add a new one.
// Entry 0 is the original HomeBase schema; existing databases keep working.
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
  // 2026-10: HomeBase Desktop hub — kiosk device tokens and calendar sources.
  `
  CREATE TABLE device_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );
  CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);

  CREATE TABLE calendar_sources (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    url_enc TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX idx_calendar_sources_user ON calendar_sources(user_id);
  `,
  // 2026-10: one-time password reset links (made on the PC with the users script).
  `
  CREATE TABLE password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_password_resets_user ON password_resets(user_id);
  `,
  // 2026-10: hub settings edited in the browser (Settings), instead of hub.env.
  `
  CREATE TABLE hub_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
  `,
];

export function openDb(dbPath: string): DB {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (dbPath !== ':memory:') {
    // The DB holds password hashes and encrypted secrets: owner-only access.
    try {
      fs.chmodSync(dbPath, 0o600);
    } catch {
      // Not fatal (e.g. a filesystem without POSIX modes); logged by caller if needed.
    }
  }
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let i = version; i < migrations.length; i++) {
    const sql = migrations[i];
    if (sql === undefined) break;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

/** Monotonic change counter driving delta pulls. Call inside a transaction. */
export function nextSeq(db: DB): number {
  const row = db
    .prepare(`UPDATE meta SET value = value + 1 WHERE key = 'sync_seq' RETURNING value`)
    .get() as { value: number };
  return row.value;
}

export function currentSeq(db: DB): number {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'sync_seq'`).get() as { value: number };
  return row.value;
}
