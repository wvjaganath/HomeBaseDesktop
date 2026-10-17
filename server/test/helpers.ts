import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';

export async function testApp(overrides: Record<string, string> = {}): Promise<FastifyInstance> {
  const env = loadEnv({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-0123456789',
    DB_PATH: ':memory:',
    DATA_DIR: '/tmp/homebase-test-data',
    TRACKER_URL: '',
    RADAR_ENABLED: 'false',
    // Tests register several people through the open sign-up.
    ALLOW_REGISTRATION: 'true',
    ...overrides,
  });
  const app = await buildApp({ env, startServices: false, webDist: '/nonexistent' });
  await app.ready();
  return app;
}

export const ORIGIN = 'http://localhost:80';

export async function registerUser(
  app: FastifyInstance,
  email: string,
  displayName = 'Test',
  password = 'correct horse battery',
): Promise<{ id: string; accessToken: string; refreshToken: string }> {
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password, displayName } });
  if (res.statusCode !== 200) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const body = res.json<{ user: { id: string }; accessToken: string; refreshToken: string }>();
  return { id: body.user.id, accessToken: body.accessToken, refreshToken: body.refreshToken };
}

export function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}
