import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { Env } from '../env.js';
import type { SecretBox } from '../security/secretBox.js';

/**
 * The hub's own settings, edited in the browser (Settings) and stored in the
 * database. Only what must exist before the database can be opened stays in
 * hub.env: JWT_SECRET (and the optional SECRETS_KEY that encrypts secrets in
 * the database). Docker-level things (ports, host names, time zone) live in
 * deploy/.env because a container can't change them.
 *
 * On first start the values in hub.env are copied in once, so upgrading keeps
 * what was configured. After that the database is the source of truth and
 * leftover hub.env lines are reported (Settings → Status) so they can go.
 */

const LABEL = /^[a-z0-9-]{1,63}$/;
const LAN_SUFFIXES = ['lan', 'local', 'home.arpa'];

const isLanHost = (host: string): boolean => {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h.includes(':')) return h.startsWith('fc') || h.startsWith('fd');
  const parts = h.split('.');
  // Home-network IPv4 addresses.
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a = 0, b = 0] = parts.map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (!parts.every((p) => LABEL.test(p)) || h === 'localhost' || h.endsWith('.localhost')) return false;
  // A plain LAN name (no dots), or one under a home-network suffix.
  return parts.length === 1 || LAN_SUFFIXES.some((sfx) => h.endsWith(`.${sfx}`));
};

/** http(s)://host[:port] on the home network, no path. */
export const lanBaseUrl = z
  .string()
  .trim()
  .max(200)
  .refine((v) => {
    if (v === '') return true;
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash && isLanHost(u.hostname);
    } catch {
      return false;
    }
  }, 'Use the board’s home-network address, like http://192.168.1.60:8080')
  .transform((v) => v.replace(/\/$/, ''));

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

export const hubSettingsSchema = z.strictObject({
  /** Used when no plane tracker supplies a home location. */
  home: z.strictObject({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullable(),
  /** Used when no plane tracker supplies its distance units. */
  units: z.enum(['imperial', 'metric']),
  allowRegistration: z.boolean(),
  accessTokenTtlMin: z.number().int().min(1).max(60),
  refreshTokenTtlDays: z.number().int().min(1).max(90),
  radarEnabled: z.boolean(),
  radarRadiusNm: z.number().int().min(5).max(100),
  // Shown to the ADS-B feeds in the User-Agent, so they can reach you.
  adsbContact: z
    .string()
    .trim()
    .max(200)
    .regex(/^[\x20-\x7e]*$/, 'Plain text only (an email address or web page)'),
  ledBoardUrl: lanBaseUrl,
  backupKeep: z.number().int().min(0).max(365),
  backupHour: z.number().int().min(0).max(23),
  logLevel: z.enum(LOG_LEVELS),
});
export type HubSettings = z.infer<typeof hubSettingsSchema>;

/** What the browser may send: settings, plus the map key (blank = keep, null = remove). */
export const hubSettingsInput = hubSettingsSchema.extend({
  cartoApiKey: z
    .union([z.null(), z.string().trim().max(200).regex(/^[A-Za-z0-9_.-]*$/, 'That doesn’t look like a CARTO key (letters, digits, - _ .)')])
    .optional(),
});

/** hub.env lines the hub no longer reads (now in Settings, or from TZ). */
export const MOVED_ENV_KEYS = [
  'ALLOW_REGISTRATION',
  'ACCESS_TOKEN_TTL_MIN',
  'REFRESH_TOKEN_TTL_DAYS',
  'LOG_LEVEL',
  'BACKUP_KEEP',
  'BACKUP_HOUR',
  'HOME_LAT',
  'HOME_LON',
  'UNITS',
  'TIMEZONE',
  'LED_BOARD_URL',
  'RADAR_ENABLED',
  'RADAR_RADIUS_NM',
  'ADSB_CONTACT',
  'CARTO_API_KEY',
] as const;

/** A live view of the settings (re-read on every use, so changes apply at once). */
export type SettingsView = () => HubSettings;

/** For code (and tests) without the database: the values hub.env would give. */
export const settingsFromEnv = (env: Env): SettingsView => {
  const v = fromEnv(env);
  return () => v;
};

function fromEnv(env: Env): HubSettings {
  const level = (LOG_LEVELS as readonly string[]).includes(env.LOG_LEVEL) ? (env.LOG_LEVEL as HubSettings['logLevel']) : 'info';
  const home = env.HOME_LAT === 0 && env.HOME_LON === 0 ? null : { lat: env.HOME_LAT, lon: env.HOME_LON };
  const board = lanBaseUrl.safeParse(env.LED_BOARD_URL);
  const contact = hubSettingsSchema.shape.adsbContact.safeParse(env.ADSB_CONTACT);
  return {
    home,
    units: env.UNITS,
    allowRegistration: env.ALLOW_REGISTRATION,
    accessTokenTtlMin: env.ACCESS_TOKEN_TTL_MIN,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    radarEnabled: env.RADAR_ENABLED,
    radarRadiusNm: env.RADAR_RADIUS_NM,
    adsbContact: contact.success ? contact.data : '',
    ledBoardUrl: board.success ? board.data : '',
    backupKeep: env.BACKUP_KEEP,
    backupHour: env.BACKUP_HOUR,
    logLevel: level,
  };
}

export class HubSettingsService {
  private current: HubSettings;
  private cartoKey = '';
  private readonly listeners = new Set<(next: HubSettings, prev: HubSettings) => void>();
  /** hub.env lines still present that the hub ignores now. */
  readonly leftoverEnvKeys: string[];

  constructor(
    private readonly db: DB,
    private readonly box: SecretBox,
    env: Env,
    private readonly log?: FastifyBaseLogger,
  ) {
    this.leftoverEnvKeys = MOVED_ENV_KEYS.filter((k) => env.setKeys.includes(k));
    const row = db.prepare(`SELECT value FROM hub_settings WHERE key = 'settings'`).get() as { value: string } | undefined;
    let loaded: HubSettings | null = null;
    if (row) {
      try {
        // Missing keys (a newer version added a setting) fall back to the env value.
        const parsed = hubSettingsSchema.safeParse({ ...fromEnv(env), ...(JSON.parse(row.value) as object) });
        if (parsed.success) loaded = parsed.data;
      } catch {
        loaded = null;
      }
    }
    if (loaded) {
      this.current = loaded;
    } else {
      // First start (or unreadable row): take what hub.env had, once.
      this.current = fromEnv(env);
      this.write('settings', JSON.stringify(this.current), null);
      if (env.CARTO_API_KEY) this.write('secret.cartoApiKey', box.seal(env.CARTO_API_KEY), null);
      this.log?.info('hub settings created from hub.env (edit them in Settings from now on)');
    }
    const key = db.prepare(`SELECT value FROM hub_settings WHERE key = 'secret.cartoApiKey'`).get() as { value: string } | undefined;
    if (key) {
      try {
        this.cartoKey = box.open(key.value);
      } catch {
        this.log?.warn('the saved CARTO key can’t be decrypted (JWT_SECRET or SECRETS_KEY changed); enter it again in Settings');
        this.cartoKey = '';
      }
    }
  }

  private write(key: string, value: string, by: string | null): void {
    this.db
      .prepare(
        `INSERT INTO hub_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(key, value, new Date().toISOString(), by);
  }

  get values(): HubSettings {
    return this.current;
  }

  get cartoApiKey(): string {
    return this.cartoKey;
  }

  onChange(fn: (next: HubSettings, prev: HubSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Save validated settings (the map key: undefined/'' = keep, null = remove). */
  update(input: z.infer<typeof hubSettingsInput>, by: string): HubSettings {
    const { cartoApiKey, ...rest } = input;
    const next = hubSettingsSchema.parse(rest);
    const prev = this.current;
    const tx = this.db.transaction(() => {
      this.write('settings', JSON.stringify(next), by);
      if (cartoApiKey === null) this.db.prepare(`DELETE FROM hub_settings WHERE key = 'secret.cartoApiKey'`).run();
      else if (cartoApiKey) this.write('secret.cartoApiKey', this.box.seal(cartoApiKey), by);
    });
    tx();
    if (cartoApiKey === null) this.cartoKey = '';
    else if (cartoApiKey) this.cartoKey = cartoApiKey;
    this.current = next;
    for (const fn of this.listeners) fn(next, prev);
    return next;
  }

  /** For the browser: never the key itself. */
  publicView(): HubSettings & { cartoApiKeySet: boolean; cartoApiKeyHint: string } {
    const k = this.cartoKey;
    return { ...this.current, cartoApiKeySet: k !== '', cartoApiKeyHint: k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k ? '••••' : '' };
  }
}
