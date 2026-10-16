import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_PATH: z.string().default('./homebase.db'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters — generate with: openssl rand -hex 32'),
  ALLOW_REGISTRATION: z.enum(['true', 'false']).default('true'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const [key, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${messages?.join(', ')}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  allowRegistration: parsed.data.ALLOW_REGISTRATION === 'true',
};
