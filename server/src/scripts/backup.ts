/**
 * One-off backup from the command line (the hub also runs one nightly):
 *   docker compose exec hub node dist/scripts/backup.js
 * Uses SQLite's online backup, so the hub can keep running.
 */
import { openDb } from '../db.js';
import { loadEnv } from '../env.js';
import { BackupService } from '../services/backup.js';

const env = loadEnv();
const db = openDb(env.dbPath);
const log = {
  info: (_obj: object, msg: string): void => console.log(msg),
  error: (obj: object, msg: string): void => console.error(msg, obj),
};
try {
  const keep = env.BACKUP_KEEP > 0 ? env : { ...env, BACKUP_KEEP: 14 };
  const info = await new BackupService(db, keep, log).run();
  console.log(`${info.file} (${info.bytes} bytes) in ${env.backupDir}`);
} catch {
  process.exitCode = 1;
} finally {
  db.close();
}
