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

/** A LAN base URL such as http://host:8080 (no path); '' turns the feature off. */
const baseUrl = (name: string, example: string) =>
  z
    .string()
    .default('')
    .refine((v) => v === '' || /^https?:\/\/[^/\s]+\/?$/.test(v), { message: `${name} must be a base URL like ${example} (no path)` })
    .transform((v) => v.replace(/\/$/, ''));

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
  // Only the first account by default; later ones are added in Settings → People.
  ALLOW_REGISTRATION: bool.default(false),
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

  TRACKER_URL: baseUrl('TRACKER_URL', 'http://planetracker.local:8080'),
  // true when the tracker runs on this server (docker-compose's `tracker`
  // service). The screens then hide the LED-only settings (Wi-Fi, panel).
  TRACKER_BUNDLED: bool.default(false),
  // The port Caddy serves the LED board feed on (TRACKER_FEED_PORT in deploy/.env).
  TRACKER_FEED_PORT: z.coerce.number().int().min(1).max(65535).default(8081),
  // Optional: the LED board Pi's own tracker web UI, so its display settings
  // (brightness, panel, Wi-Fi, which server it follows) can be edited here too.
  LED_BOARD_URL: baseUrl('LED_BOARD_URL', 'http://plane-clock.local:8080'),

  // Internal URL of the MagicMirror² container (Docker network only). Empty = no Mirror tab.
  MIRROR_URL: z
    .string()
    .default('')
    .refine((v) => v === '' || /^http:\/\/[^/\s]+\/?$/.test(v), { message: 'MIRROR_URL must look like http://magicmirror:8080' })
    .transform((v) => v.replace(/\/$/, '')),

  // The MagicMirror container's fixed address (docker-compose). Only it may ask
  // the hub for its start-up settings (/internal/mirror/*). Empty = off.
  MIRROR_CLIENT_IP: z
    .string()
    .default('')
    .refine((v) => v === '' || net.isIP(v) !== 0, 'MIRROR_CLIENT_IP must be an IP address'),

  RADAR_ENABLED: bool.default(true),
  // Free key for CARTO's dark map tiles (https://carto.com/basemaps/apikey/).
  // Without it the map background says "API KEY REQUIRED".
  CARTO_API_KEY: z
    .string()
    .default('')
    .refine((v) => v === '' || /^[A-Za-z0-9_.-]{8,200}$/.test(v), 'CARTO_API_KEY should be the key from carto.com/basemaps/apikey (letters, digits, - _ .)'),
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
  /** The hub's time zone: TZ (deploy/.env, shared by every container). */
  timezone: string;
  /** Names (never values) of the variables that were set and non-empty. */
  setKeys: string[];
};

const validZone = (z?: string): string | null => {
  if (!z) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return z;
  } catch {
    return null;
  }
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
    timezone: validZone(source.TZ) ?? validZone(data.TIMEZONE) ?? 'UTC',
    setKeys: Object.keys(source).filter((k) => /^[A-Z][A-Z0-9_]*$/.test(k) && (source[k] ?? '').trim() !== ''),
  };
}
