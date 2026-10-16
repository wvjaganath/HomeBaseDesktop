import path from 'node:path';
import { z } from 'zod';

// Environment is loaded by Node itself (`node --env-file-if-exists=.env`), so no
// dotenv dependency. Everything is validated here, once, at startup.

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
    .regex(/^([0-9a-fA-F]{64})?$/, 'SECRETS_KEY must be 64 hex characters (openssl rand -hex 32) or empty')
    .default(''),
  ALLOW_REGISTRATION: bool.default(true),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: bool.default(false),
  TRUST_PROXY: bool.default(false),

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

  RADAR_ENABLED: bool.default(true),
  RADAR_RADIUS_NM: z.coerce.number().int().min(5).max(100).default(30),
  ADSB_CONTACT: z.string().max(200).default(''),
});

export type Env = z.infer<typeof envSchema> & {
  dbPath: string;
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
    isTest: data.NODE_ENV === 'test',
  };
}
