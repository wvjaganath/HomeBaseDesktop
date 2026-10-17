import net from 'node:net';
import path from 'node:path';
import { z } from 'zod';

// Environment is loaded by Node itself (`node --env-file-if-exists=.env`), so no
// dotenv dependency. Everything is validated here, once, at startup.

function isIpOrCidr(s: string): boolean {
  const [ip = '', prefix, extra] = s.split('/');
  const family = net.isIP(ip);
  if (family === 0 || extra !== undefined) return false;
  if (prefix === undefined) return true;
  const n = Number(prefix);
  return /^\d{1,3}$/.test(prefix) && n <= (family === 4 ? 32 : 128);
}

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().default('./data'),
  DB_PATH: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32'),
  SECRETS_KEY: z
    .string()
    .default('')
    .refine((v) => v === '' || /^[0-9a-fA-F]{64}$/.test(v), 'SECRETS_KEY must be 64 hex characters (openssl rand -hex 32) or empty'),
  ALLOW_REGISTRATION: bool.default(true),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  // auto: Secure (__Host-) cookies whenever the request arrived over HTTPS
  // (via the trusted proxy), plain cookies on the LAN-only http port.
  COOKIE_SECURE: z
    .enum(['auto', 'true', 'false'])
    .default('auto')
    .transform((v) => (v === 'auto' ? ('auto' as const) : v === 'true')),
  // Which reverse proxy may set X-Forwarded-*: false, or IPs/CIDRs (comma
  // separated). Never "true": anyone reaching the hub could spoof their IP.
  TRUST_PROXY: z
    .string()
    .default('false')
    .refine(
      (v) => v === 'false' || v.split(',').every((s) => isIpOrCidr(s.trim())),
      { message: 'TRUST_PROXY must be false or a comma-separated list of proxy IPs/CIDRs (e.g. 172.30.87.10)' },
    )
    .transform((v) => (v === 'false' ? false : v.split(',').map((s) => s.trim()))),

  HOME_LAT: z.coerce.number().min(-90).max(90).default(0),
  HOME_LON: z.coerce.number().min(-180).max(180).default(0),
  UNITS: z.enum(['imperial', 'metric']).default('imperial'),
  TIMEZONE: z.string().default('UTC'),

  TRACKER_URL: z
    .string()
    .default('')
    .refine((v) => v === '' || /^https?:\/\/[^/\s]+\/?$/.test(v), {
      message: 'TRACKER_URL must be a base URL like http://planetracker.local:8080 (no path)',
    })
    .transform((v) => v.replace(/\/$/, '')),

  // Internal URL of the MagicMirror² container (Docker network only). Empty = no Mirror tab.
  MIRROR_URL: z
    .string()
    .default('')
    .refine((v) => v === '' || /^http:\/\/[^/\s]+\/?$/.test(v), { message: 'MIRROR_URL must look like http://magicmirror:8080' })
    .transform((v) => v.replace(/\/$/, '')),

  RADAR_ENABLED: bool.default(true),
  RADAR_RADIUS_NM: z.coerce.number().int().min(5).max(100).default(30),
  ADSB_CONTACT: z.string().max(200).default(''),

  // Nightly database backups (0 = off). BACKUP_DIR defaults to DATA_DIR/backups.
  BACKUP_DIR: z.string().optional(),
  BACKUP_KEEP: z.coerce.number().int().min(0).max(365).default(14),
  BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(3),
});

export type Env = z.infer<typeof envSchema> & {
  dbPath: string;
  backupDir: string;
  isTest: boolean;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const data = parsed.data;
  return {
    ...data,
    dbPath: data.DB_PATH ?? path.join(data.DATA_DIR, 'homebase.db'),
    backupDir: data.BACKUP_DIR ?? path.join(data.DATA_DIR, 'backups'),
    isTest: data.NODE_ENV === 'test',
  };
}
