import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthService } from '../auth.js';
import type { DB } from '../db.js';
import { credentialsSchema, registerSchema } from '../schemas.js';

/**
 * Account administration for the hub owner, used by the `users` command-line
 * script (there is no public sign-up or reset page). Same rules as
 * `/auth/register`: email + 10–128 character password, argon2id.
 */

export class UserAdminError extends Error {}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  activeSessions: number;
}

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'invalid input';
  const field = issue.path.join('.');
  if (field === 'password') return 'The password must be 10 to 128 characters.';
  if (field === 'email') return 'That doesn’t look like an email address.';
  if (field === 'displayName') return 'The name must be 1 to 50 characters.';
  return issue.message;
}

export async function createUser(
  db: DB,
  auth: AuthService,
  input: { email: string; displayName: string; password: string },
): Promise<{ id: string; email: string; displayName: string }> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw new UserAdminError(firstIssue(parsed.error));
  const email = parsed.data.email.toLowerCase();
  if (auth.findUserByEmail(email)) throw new UserAdminError(`An account for ${email} already exists.`);
  const id = randomUUID();
  db.prepare(`INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    email,
    parsed.data.displayName,
    await auth.hashPassword(parsed.data.password),
    new Date().toISOString(),
  );
  return { id, email, displayName: parsed.data.displayName };
}

/**
 * Sets a new password and signs the account out everywhere (all refresh
 * tokens revoked; any access token still held expires within its TTL).
 * Returns how many sessions were ended.
 */
export async function resetPassword(db: DB, auth: AuthService, emailInput: string, password: string): Promise<number> {
  const parsed = credentialsSchema.safeParse({ email: emailInput, password });
  if (!parsed.success) throw new UserAdminError(firstIssue(parsed.error));
  const user = auth.findUserByEmail(parsed.data.email.toLowerCase());
  if (!user) throw new UserAdminError(`No account for ${parsed.data.email}.`);
  const hash = await auth.hashPassword(parsed.data.password);
  return db.transaction(() => {
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, user.id);
    return db
      .prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
      .run(new Date().toISOString(), user.id).changes;
  })();
}

export function listUsers(db: DB): UserSummary[] {
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.created_at,
              (SELECT COUNT(*) FROM refresh_tokens r
                WHERE r.user_id = u.id AND r.revoked_at IS NULL AND r.expires_at > ?) AS sessions
         FROM users u ORDER BY u.created_at`,
    )
    .all(now) as Array<{ id: string; email: string; display_name: string; created_at: string; sessions: number }>;
  return rows.map((r) => ({ id: r.id, email: r.email, displayName: r.display_name, createdAt: r.created_at, activeSessions: r.sessions }));
}
