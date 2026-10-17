import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readLogoSource } from '../src/routes/logos.js';
import { registerUser, testApp } from './helpers.js';

let dir = '';
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-logos-'));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('logo files from the downloaded set', () => {
  it('accepts a real PNG and nothing else', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#3987e5' } }).png().toBuffer();
    await fs.writeFile(path.join(dir, 'UAL.png'), png);
    await fs.writeFile(path.join(dir, 'FAK.png'), 'not really a png');
    await fs.writeFile(path.join(dir, 'secret.txt'), 'JWT_SECRET=hunter2');
    await fs.symlink(path.join(dir, 'secret.txt'), path.join(dir, 'LNK.png'));
    await fs.symlink(path.join(dir, 'UAL.png'), path.join(dir, 'LN2.png'));

    expect(await readLogoSource(path.join(dir, 'UAL.png'))).toEqual(png);
    expect(await readLogoSource(path.join(dir, 'FAK.png'))).toBeNull();
    expect(await readLogoSource(path.join(dir, 'LNK.png'))).toBeNull();
    // Even a link to a genuine logo is refused: links can point anywhere.
    expect(await readLogoSource(path.join(dir, 'LN2.png'))).toBeNull();
    expect(await readLogoSource(path.join(dir, 'NONE.png'))).toBeNull();
  });

  it('serves a resized logo and 404s on a fake one', async () => {
    const data = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-data-'));
    const src = path.join(data, 'logo-src', 'flightaware_logos');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'SWA.png'), await sharp({ create: { width: 64, height: 64, channels: 4, background: '#e5a03a' } }).png().toBuffer());
    await fs.writeFile(path.join(src, 'BAD.png'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage')]));
    const app = await testApp({ DATA_DIR: data });
    const auth = { authorization: `Bearer ${(await registerUser(app, 'l@example.com')).accessToken}` };
    const ok = await app.inject({ method: 'GET', url: '/api/logo/SWA?h=32', headers: auth });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/webp');
    expect((await app.inject({ method: 'GET', url: '/api/logo/BAD?h=32', headers: auth })).statusCode).toBe(404);
    await app.close();
    await fs.rm(data, { recursive: true, force: true });
  });
});
