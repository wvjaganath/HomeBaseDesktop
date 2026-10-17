import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sha256, type AuthService } from '../auth.js';
import type { DB } from '../db.js';
import { credentialsSchema, registerSchema } from '../schemas.js';

/**
 * Account administration: the `users` command-line script on the PC and the
 * browser's sign-up / change-password / reset screens. Same rules as
 * `/auth/register`: email + 10–128 character password, argon2id.
 */

export class UserAdminError extends Error {
  constructor(
    message: string,
    /** exists: email taken · closed: sign-up isn't open · invalid: bad input · other */
    readonly code: 'exists' | 'closed' | 'invalid' | 'other' = 'other',
  ) {
    super(message);
  }
}

export function hasAnyUser(db: DB): boolean {
  return db.prepare(`SELECT 1 FROM users LIMIT 1`).get() !== undefined;
}

/**
 * Whether the sign-in screen / iOS app may create accounts: always for the
 * very first account (a fresh hub has no other way in), otherwise only when
 * ALLOW_REGISTRATION=true.
 */
export function registrationOpen(db: DB, allowRegistration: boolean): boolean {
  return allowRegistration || !hasAnyUser(db);
}

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
  opts: { onlyIfNoAccounts?: boolean } = {},
): Promise<{ id: string; email: string; displayName: string }> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw new UserAdminError(firstIssue(parsed.error), 'invalid');
  const email = parsed.data.email.toLowerCase();
  if (auth.findUserByEmail(email)) throw new UserAdminError(`An account for ${email} already exists.`, 'exists');
  const hash = await auth.hashPassword(parsed.data.password);
  const id = randomUUID();
  // Checks and insert run together with no await in between, so two people
  // racing to create the "first" account can't both succeed.
  db.transaction(() => {
    if (opts.onlyIfNoAccounts && hasAnyUser(db)) {
      throw new UserAdminError('This hub already has an account. Ask someone signed in to add you in Settings → People.', 'closed');
    }
    if (auth.findUserByEmail(email)) throw new UserAdminError(`An account for ${email} already exists.`, 'exists');
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id,
      email,
      parsed.data.displayName,
      hash,
      new Date().toISOString(),
    );
  })();
  return { id, email, displayName: parsed.data.displayName };
}

/**
 * Sets a new password and signs the account out everywhere (all refresh
 * tokens revoked; any access token still held expires within its TTL).
 * Returns how many sessions were ended.
 */
const passwordSchema = z.string().min(10).max(128);
const RESET_TTL_MS = 30 * 60_000;

async function setPasswordAndSignOut(db: DB, auth: AuthService, userId: string, password: string): Promise<number> {
  const ok = passwordSchema.safeParse(password);
  if (!ok.success) throw new UserAdminError('The password must be 10 to 128 characters.');
  const hash = await auth.hashPassword(password);
  return db.transaction(() => {
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, userId);
    return db
      .prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
      .run(new Date().toISOString(), userId).changes;
  })();
}

/** Signed-in password change; needs the current password. Ends every session. */
export async function changePassword(db: DB, auth: AuthService, userId: string, current: string, next: string): Promise<void> {
  const user = auth.findUserById(userId);
  if (!user || !(await auth.verifyPassword(user.password_hash, current))) {
    throw new UserAdminError('Your current password is incorrect.');
  }
  if (current === next) throw new UserAdminError('The new password must be different.');
  await setPasswordAndSignOut(db, auth, userId, next);
}

/**
 * A one-time link for a forgotten password (valid 30 minutes). Only the hub's
 * owner can make one, from the PC, so a person signed in on the web can't use
 * it to take over someone else's account. Earlier unused links stop working.
 */
export function createResetToken(db: DB, auth: AuthService, email: string): { token: string; expiresAt: string } {
  const user = auth.findUserByEmail(email.toLowerCase());
  if (!user) throw new UserAdminError(`No account for ${email}.`);
  const token = `hbr_${randomBytes(32).toString('base64url')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_TTL_MS).toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).run(now.toISOString(), user.id);
    db.prepare(`INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      randomUUID(),
      user.id,
      sha256(token),
      expiresAt,
      now.toISOString(),
    );
  })();
  return { token, expiresAt };
}

/** Uses a reset link: sets the password, ends every session, burns the link. */
export async function useResetToken(db: DB, auth: AuthService, token: string, password: string): Promise<{ email: string }> {
  if (!passwordSchema.safeParse(password).success) throw new UserAdminError('The password must be 10 to 128 characters.');
  const row = /^hbr_[A-Za-z0-9_-]{43}$/.test(token)
    ? (db.prepare(`SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?`).get(sha256(token)) as
        | { id: string; user_id: string; expires_at: string; used_at: string | null }
        | undefined)
    : undefined;
  const now = new Date().toISOString();
  if (!row || row.used_at !== null || row.expires_at < now) {
    throw new UserAdminError('This reset link has expired or was already used. Ask for a new one.');
  }
  // Burn first, so a second request racing this one can't reuse it.
  const burned = db.prepare(`UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL`).run(now, row.id).changes;
  if (burned !== 1) throw new UserAdminError('This reset link has expired or was already used. Ask for a new one.');
  await setPasswordAndSignOut(db, auth, row.user_id, password);
  return { email: auth.findUserById(row.user_id)?.email ?? '' };
}

export async function resetPassword(db: DB, auth: AuthService, emailInput: string, password: string): Promise<number> {
  const parsed = credentialsSchema.safeParse({ email: emailInput, password });
  if (!parsed.success) throw new UserAdminError(firstIssue(parsed.error));
  const user = auth.findUserByEmail(parsed.data.email.toLowerCase());
  if (!user) throw new UserAdminError(`No account for ${parsed.data.email}.`);
  return setPasswordAndSignOut(db, auth, user.id, parsed.data.password);
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
