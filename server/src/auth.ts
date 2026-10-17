import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { DB } from './db.js';
import type { Env } from './env.js';
import { settingsFromEnv, type SettingsView } from './services/hubSettings.js';

const ISSUER = 'homebase';
const AUDIENCE = 'homebase-api';

// Above the OWASP argon2id baseline (m=19 MiB, t=2, p=1).
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

interface RefreshRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  settings: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// A fixed dummy hash so a login for an unknown email costs the same time as a
// real one (no user-enumeration timing oracle). Computed lazily once.
let dummyHash: Promise<string> | null = null;

export class AuthService {
  private readonly secret: Uint8Array;

  private readonly settings: SettingsView;

  constructor(
    private readonly db: DB,
    env: Env,
    settings?: SettingsView,
  ) {
    this.secret = new TextEncoder().encode(env.JWT_SECRET);
    this.settings = settings ?? settingsFromEnv(env);
  }

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verifyPassword(hash: string | undefined, password: string): Promise<boolean> {
    try {
      // Comparing to undefined (unknown user), not to a secret.
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (hash === undefined) {
        dummyHash ??= argon2.hash('not-a-real-password-homebase', ARGON2_OPTIONS);
        await argon2.verify(await dummyHash, password);
        return false;
      }
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  findUserByEmail(email: string): UserRow | undefined {
    return this.db
      .prepare(`SELECT id, email, display_name, password_hash FROM users WHERE email = ?`)
      .get(email.toLowerCase()) as UserRow | undefined;
  }

  findUserById(id: string): UserRow | undefined {
    return this.db
      .prepare(`SELECT id, email, display_name, password_hash FROM users WHERE id = ?`)
      .get(id) as UserRow | undefined;
  }

  signAccessToken(userId: string, displayName: string): Promise<string> {
    return new SignJWT({ name: displayName })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setJti(randomUUID())
      .setExpirationTime(`${this.settings().accessTokenTtlMin}m`)
      .sign(this.secret);
  }

  async verifyAccessToken(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: ISSUER,
        // Tokens minted by the previous server version carried no audience;
        // they expire within 15 minutes, after which only audience tokens exist.
        algorithms: ['HS256'],
        clockTolerance: 5,
      });
      if (payload.aud !== undefined && payload.aud !== AUDIENCE) return null;
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /** Issues a refresh token; only its SHA-256 hash is stored at rest. */
  issueRefreshToken(userId: string, familyId: string = randomUUID()): string {
    const token = randomBytes(48).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + this.settings().refreshTokenTtlDays * 86_400_000);
    this.db
      .prepare(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), userId, sha256(token), familyId, expires.toISOString(), now.toISOString());
    return token;
  }

  /**
   * Rotation with reuse detection: presenting an already-revoked token revokes
   * the whole family (a stolen-token replay kills the session chain).
   */
  rotateRefreshToken(presented: string): { userId: string; token: string } | null {
    return this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?`)
        .get(sha256(presented)) as RefreshRow | undefined;
      if (!row) return null;

      const now = new Date().toISOString();
      if (row.revoked_at !== null || row.expires_at < now) {
        this.db
          .prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL`)
          .run(now, row.family_id);
        return null;
      }

      this.db.prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?`).run(now, row.id);
      const token = this.issueRefreshToken(row.user_id, row.family_id);
      return { userId: row.user_id, token };
    })();
  }

  revokeFamilyByToken(presented: string): void {
    const row = this.db
      .prepare(`SELECT family_id FROM refresh_tokens WHERE token_hash = ?`)
      .get(sha256(presented)) as { family_id: string } | undefined;
    if (row) {
      this.db
        .prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL`)
        .run(new Date().toISOString(), row.family_id);
    }
  }

  // --- Kiosk device tokens -------------------------------------------------

  /** Creates a read-only display token. The plaintext is returned once only. */
  createDeviceToken(userId: string, name: string): { id: string; token: string } {
    const id = randomUUID();
    const token = `hbd_${randomBytes(32).toString('base64url')}`;
    this.db
      .prepare(
        `INSERT INTO device_tokens (id, user_id, name, token_hash, settings, created_at)
         VALUES (?, ?, ?, ?, '{}', ?)`,
      )
      .run(id, userId, name, sha256(token), new Date().toISOString());
    return { id, token };
  }

  verifyDeviceToken(token: string): DeviceRow | null {
    if (!/^hbd_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.db
      .prepare(
        `SELECT id, user_id, name, settings, created_at, last_used_at, revoked_at
         FROM device_tokens WHERE token_hash = ?`,
      )
      .get(sha256(token)) as DeviceRow | undefined;
    if (!row || row.revoked_at !== null) return null;
    // Throttle last-used writes to once a minute per device.
    const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
    if (Date.now() - last > 60_000) {
      this.db.prepare(`UPDATE device_tokens SET last_used_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
    }
    return row;
  }
}
