import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { db } from './db.js';
import { env } from './env.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function signAccessToken(userId: string, displayName: string): Promise<string> {
  return new SignJWT({ name: displayName })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer('homebase')
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_MIN}m`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: 'homebase' });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

interface RefreshRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: string;
  revoked_at: string | null;
}

/** Issues a refresh token; only its SHA-256 hash is stored at rest. */
export function issueRefreshToken(userId: string, familyId: string = randomUUID()): string {
  const token = randomBytes(48).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), userId, sha256(token), familyId, expires.toISOString(), now.toISOString());
  return token;
}

/**
 * Rotation with reuse detection: presenting an already-revoked token revokes
 * the whole family (a stolen-token replay kills the session chain).
 */
export function rotateRefreshToken(presented: string): { userId: string; token: string } | null {
  const row = db
    .prepare(`SELECT id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?`)
    .get(sha256(presented)) as RefreshRow | undefined;
  if (!row) return null;

  const now = new Date().toISOString();
  if (row.revoked_at !== null || row.expires_at < now) {
    db.prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL`).run(
      now,
      row.family_id,
    );
    return null;
  }

  db.prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?`).run(now, row.id);
  const token = issueRefreshToken(row.user_id, row.family_id);
  return { userId: row.user_id, token };
}

export function revokeFamilyByToken(presented: string): void {
  const row = db
    .prepare(`SELECT family_id FROM refresh_tokens WHERE token_hash = ?`)
    .get(sha256(presented)) as { family_id: string } | undefined;
  if (row) {
    db.prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL`).run(
      new Date().toISOString(),
      row.family_id,
    );
  }
}
