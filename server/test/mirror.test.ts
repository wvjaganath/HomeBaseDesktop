import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allowedMirrorPath } from '../src/routes/mirror.js';
import { cookieHeader, registerUser, testApp } from './helpers.js';

// A stand-in MagicMirror that records what reaches it.
const seen: Array<{ url: string; cookie: string | undefined; auth: string | undefined; origin: string | undefined }> = [];
const upstream = http.createServer((req, res) => {
  seen.push({ url: req.url ?? '', cookie: req.headers.cookie, auth: req.headers.authorization, origin: req.headers.origin });
  if (req.url === '/socket.io/socket.io.esm.min.js') {
    res.setHeader('content-type', 'application/javascript');
    res.end('export const io = 1;');
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.end(`<html>mirror ${req.url ?? ''}</html>`);
});

let app: FastifyInstance;
let cookie = '';
let deviceBearer = '';
beforeAll(async () => {
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
  const port = (upstream.address() as AddressInfo).port;
  app = await testApp({ MIRROR_URL: `http://127.0.0.1:${port}` });
  const u = await registerUser(app, 'a@example.com');
  const login = await app.inject({
    method: 'POST',
    url: '/auth/web/login',
    headers: { origin: 'http://localhost:80' },
    payload: { email: 'a@example.com', password: 'correct horse battery' },
  });
  cookie = cookieHeader(login.headers['set-cookie']);
  const dev = await app.inject({ method: 'POST', url: '/api/devices', headers: { authorization: `Bearer ${u.accessToken}` }, payload: { name: 'Mirror' } });
  deviceBearer = `Bearer ${dev.json<{ pairPath: string }>().pairPath.split('t=')[1] ?? ''}`;
});
afterAll(async () => {
  await app.close();
  upstream.close();
});

describe('allowedMirrorPath', () => {
  it('allows only what the MagicMirror page needs', () => {
    for (const ok of ['/mirror/', '/mirror/js/main.js', '/mirror/config', '/mirror/config/', '/mirror/config/basepath.js', '/mirror/env', '/mirror/socket.io/', '/mirror/node_modules/moment/min/moment-with-locales.js', '/mirror/modules/MMM-HomeBase/MMM-HomeBase.css']) {
      expect(allowedMirrorPath(ok), ok).not.toBeNull();
    }
    for (const bad of ['/mirror/cors', '/mirror/cors?url=http://x', '/mirror/reload', '/mirror/config/config.js', '/mirror/tests/configs/a', '/mirror/%2e%2e/cors', '/mirror/js/../cors', '/mirror/js%2f..%2fcors', '/mirror/js\\..\\cors', '/mirror/node_modules/systeminformation/x.js', '/other']) {
      expect(allowedMirrorPath(bad), bad).toBeNull();
    }
  });
});

describe('/mirror proxy', () => {
  it('requires a signed-in person or a paired screen', async () => {
    expect((await app.inject({ method: 'GET', url: '/mirror/' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/mirror/', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('mirror /');
    expect((await app.inject({ method: 'GET', url: '/mirror/', headers: { authorization: deviceBearer } })).statusCode).toBe(200);
  });

  it('never forwards the hub’s cookies or tokens upstream', async () => {
    await app.inject({ method: 'GET', url: '/mirror/js/main.js', headers: { cookie } });
    const last = seen.at(-1);
    expect(last?.url).toBe('/js/main.js');
    expect(last?.cookie).toBeUndefined();
    expect(last?.auth).toBeUndefined();
  });

  it('blocks MagicMirror’s open proxy, reload and traversal tricks', async () => {
    const before = seen.length;
    for (const url of ['/mirror/cors?url=http://169.254.169.254/', '/mirror/reload', '/mirror/%2e%2e/cors', '/mirror/js%2f..%2fcors', '/mirror/tests/configs/x']) {
      expect((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode, url).toBe(404);
    }
    const post = await app.inject({ method: 'POST', url: '/mirror/config/', headers: { cookie, origin: 'http://localhost:80' }, payload: {} });
    expect(post.statusCode).toBe(404);
    expect(seen.length).toBe(before); // nothing reached MagicMirror
  });

  it('serves MagicMirror under its own CSP without inline scripts', async () => {
    const res = await app.inject({ method: 'GET', url: '/mirror/', headers: { cookie } });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self' 'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it('redirects /mirror to /mirror/ and serves the socket.io client file', async () => {
    const r = await app.inject({ method: 'GET', url: '/mirror', headers: { cookie } });
    expect(r.statusCode).toBe(301);
    expect(r.headers.location).toBe('/mirror/');
    const js = await app.inject({ method: 'GET', url: '/socket.io/socket.io.esm.min.js', headers: { cookie } });
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain('export const io');
    expect((await app.inject({ method: 'GET', url: '/socket.io/socket.io.esm.min.js' })).statusCode).toBe(401);
  });

  it('accepts same-origin module and font loads, rejects other sites', async () => {
    const own = await app.inject({ method: 'GET', url: '/mirror/js/main.js', headers: { cookie, origin: 'http://localhost:80' } });
    expect(own.statusCode).toBe(200);
    expect(seen.at(-1)?.url).toBe('/js/main.js');
    expect(seen.at(-1)?.origin).toBeUndefined();
    const foreign = await app.inject({ method: 'GET', url: '/mirror/js/main.js', headers: { cookie, origin: 'http://evil.example' } });
    expect(foreign.statusCode).toBe(403);
  });

  it('rejects websocket upgrades from other sites', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/mirror/socket.io/?EIO=4&transport=websocket',
      headers: { cookie, connection: 'Upgrade', upgrade: 'websocket', origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('screen tokens as Bearer', () => {
  it('are read-only', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/lists', headers: { authorization: deviceBearer } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/sync/push', headers: { authorization: deviceBearer }, payload: { changes: [] } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/lists', headers: { authorization: 'Bearer hbd_notarealtoken' } })).statusCode).toBe(401);
  });
});
