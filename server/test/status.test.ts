import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { loadEnv } from '../src/env.js';
import { BackupService } from '../src/services/backup.js';
import { registerUser, testApp } from './helpers.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-backup-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const quiet = { info: () => undefined, error: () => undefined };

describe('BackupService', () => {
  it('writes owner-only, consistent copies and keeps the newest N', async () => {
    const env = loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(40), DATA_DIR: tmp, BACKUP_KEEP: '2' });
    const db = openDb(env.dbPath);
    db.prepare(`INSERT INTO meta (key, value) VALUES ('probe', 42)`).run();
    const svc = new BackupService(db, env, quiet);
    // Two older backups already on disk, plus an unrelated file.
    fs.mkdirSync(env.backupDir, { recursive: true });
    for (const n of ['homebase-2020-01-01T000000.db', 'homebase-2020-01-02T000000.db']) fs.writeFileSync(path.join(env.backupDir, n), 'old');
    fs.writeFileSync(path.join(env.backupDir, 'notes.txt'), 'not a backup');
    const info = await svc.run();
    const list = svc.list().map((b) => b.file);
    expect(list).toEqual([info.file, 'homebase-2020-01-02T000000.db']);
    expect(fs.existsSync(path.join(env.backupDir, 'notes.txt'))).toBe(true); // never touches other files
    const file = path.join(env.backupDir, info.file);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const copy = openDb(file);
    expect((copy.prepare(`SELECT value FROM meta WHERE key = 'probe'`).get() as { value: number }).value).toBe(42);
    copy.close();
    db.close();
  });
});

describe('/api/status', () => {
  it('is for signed-in people only and reports each part of the hub', async () => {
    const app = await testApp();
    expect((await app.inject({ method: 'GET', url: '/api/status' })).statusCode).toBe(401);
    const u = await registerUser(app, 's@example.com');
    const res = await app.inject({ method: 'GET', url: '/api/status', headers: { authorization: `Bearer ${u.accessToken}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, Record<string, unknown>>>();
    expect(body.hub?.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.hub?.https).toBe(false);
    expect(body.backup?.enabled).toBe(false); // in-memory DB in tests
    expect(body.mirror).toEqual({ enabled: false, reachable: false });
    expect(body.tracker?.enabled).toBe(false);
    const run = await app.inject({ method: 'POST', url: '/api/status/backup', headers: { authorization: `Bearer ${u.accessToken}` } });
    expect(run.statusCode).toBe(409);
    await app.close();
  });
});
