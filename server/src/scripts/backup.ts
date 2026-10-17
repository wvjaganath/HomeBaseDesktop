/**
 * One-off backup from the command line (the hub also runs one nightly):
 *   docker compose exec hub node dist/scripts/backup.js
 * Uses SQLite's online backup, so the hub can keep running.
 */
import { openDb } from '../db.js';
import { loadEnv } from '../env.js';
import { BackupService } from '../services/backup.js';
import { settingsFromEnv } from '../services/hubSettings.js';

const env = loadEnv();
const db = openDb(env.dbPath);
const log = {
  info: (_obj: object, msg: string): void => console.log(msg),
  error: (obj: object, msg: string): void => console.error(msg, obj),
};
try {
  // How many to keep comes from Settings (stored in the database).
  const row = db.prepare(`SELECT value FROM hub_settings WHERE key = 'settings'`).get() as { value: string } | undefined;
  let keep = 14;
  try {
    const saved = row ? (JSON.parse(row.value) as { backupKeep?: unknown }).backupKeep : undefined;
    if (typeof saved === 'number' && saved > 0) keep = saved;
  } catch {
    // keep the default
  }
  const values = { ...settingsFromEnv(env)(), backupKeep: keep };
  const info = await new BackupService(db, env, log, () => values).run();
  console.log(`${info.file} (${info.bytes} bytes) in ${env.backupDir}`);
} catch {
  process.exitCode = 1;
} finally {
  db.close();
}
