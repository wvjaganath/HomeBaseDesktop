import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db.js';
import type { Env } from '../env.js';

const NAME_RE = /^homebase-\d{4}-\d{2}-\d{2}T\d{6}\.db$/;

/** The bits of a logger this needs (Fastify's logger or console-like). */
export interface BackupLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface BackupInfo {
  file: string;
  at: string;
  bytes: number;
}

/**
 * Nightly, consistent SQLite backups (better-sqlite3's online backup API, so
 * the hub keeps running). Files are owner-only, named by timestamp, and the
 * newest BACKUP_KEEP are kept. Point BACKUP_DIR at a different disk if you can.
 */
export class BackupService {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<BackupInfo> | null = null;
  lastError: string | null = null;

  constructor(
    private readonly db: DB,
    private readonly env: Env,
    private readonly log: BackupLog,
  ) {}

  get enabled(): boolean {
    return this.env.BACKUP_KEEP > 0 && this.env.dbPath !== ':memory:';
  }

  /** Backups currently on disk, newest first. */
  list(): BackupInfo[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.env.backupDir);
    } catch {
      return [];
    }
    return names
      .filter((n) => NAME_RE.test(n))
      .sort()
      .reverse()
      .map((file) => {
        const st = fs.statSync(path.join(this.env.backupDir, file));
        return { file, at: st.mtime.toISOString(), bytes: st.size };
      });
  }

  /** Run one backup now (concurrent calls share the same run). */
  run(): Promise<BackupInfo> {
    this.running ??= this.doRun().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRun(): Promise<BackupInfo> {
    const dir = this.env.backupDir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '');
    const file = `homebase-${stamp}.db`;
    const final = path.join(dir, file);
    const tmp = `${final}.partial`;
    try {
      await this.db.backup(tmp);
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, final);
      this.lastError = null;
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      this.lastError = err instanceof Error ? err.message : String(err);
      this.log.error({ err }, 'backup failed');
      throw err;
    }
    for (const old of this.list().slice(this.env.BACKUP_KEEP)) {
      fs.rmSync(path.join(dir, old.file), { force: true });
    }
    const info = { file, at: new Date().toISOString(), bytes: fs.statSync(final).size };
    this.log.info({ event: 'backup_done', file, bytes: info.bytes }, 'database backed up');
    return info;
  }

  /** Schedule the nightly run at BACKUP_HOUR (container local time). */
  start(): void {
    if (!this.enabled) return;
    const schedule = (): void => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(this.env.BACKUP_HOUR, 7, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      this.timer = setTimeout(() => {
        this.run()
          .catch(() => undefined)
          .finally(schedule);
      }, next.getTime() - now.getTime());
      this.timer.unref();
    };
    schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
