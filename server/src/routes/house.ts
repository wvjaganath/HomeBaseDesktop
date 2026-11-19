import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { lanBaseUrlWith } from '../services/hubSettings.js';
import { readMachine } from '../services/machines.js';

const address = z.string().length(17).refine((v) => v.split(':').length === 6 && v.split(':').every((p) => /^[0-9A-F]{2}$/.test(p)));

/**
 * House: machines (node_exporter) and room sensors (Govee over Bluetooth).
 * Screens (people and kiosks) read the summary and history; changing
 * anything (Settings → House) is for signed-in people only.
 */
export default async function houseRoutes(app: FastifyInstance): Promise<void> {
  const { house, houseSettings, home, env } = app.ctx;

  app.get('/api/house', { preHandler: [app.requireViewer] }, async () => house.summary());

  app.get('/api/house/history', { preHandler: [app.requireViewer] }, async (req, reply) => {
    const q = z.object({ range: z.enum(['24h', '7d', '30d']).default('24h') }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' });
    return { range: q.data.range, machines: house.machines.history(), rooms: house.rooms.history(q.data.range) };
  });

  const settingsView = () => ({
    settings: houseSettings.values,
    sensors: house.rooms.all(),
    listeners: house.rooms.listenerStatus(),
    bundledListener: env.GOVEE_URL !== '',
    units: home.units,
  });

  app.get('/api/house-settings', { preHandler: [app.requireUser] }, async () => settingsView());

  app.put('/api/house-settings', { preHandler: [app.requireUser], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      houseSettings.update(req.body, req.userId);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issue = err.issues[0];
        return reply.code(400).send({ error: 'invalid_input', message: issue?.message ?? 'invalid settings', field: issue?.path.join('.') });
      }
      throw err;
    }
    req.log.info({ event: 'house_settings_saved', by: req.userId, machines: houseSettings.values.machines.length }, 'house settings saved');
    return settingsView();
  });

  // "Test" next to a machine address: one read of its node_exporter.
  app.post(
    '/api/house-settings/test-machine',
    { preHandler: [app.requireUser], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.object({ url: lanBaseUrlWith('Use the machine’s home-network address, like http://192.168.1.20:9100').refine((v) => v !== '', 'Enter an address') }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_input', message: body.error.issues[0]?.message });
      try {
        const r = await readMachine(body.data.url);
        if (r.cpuTotal === 0 && r.memTotal === null) return { ok: false, message: 'It answered, but that isn’t node_exporter' };
        return { ok: true, os: r.os, hostname: r.hostname, cores: r.cores, arch: r.arch, tempC: r.tempC, hasPower: r.throttled !== null };
      } catch {
        return { ok: false, message: 'Couldn’t reach node_exporter there (is it installed, and port 9100 open to this server?)' };
      }
    },
  );

  app.patch('/api/house/sensors/:address', { preHandler: [app.requireUser] }, async (req, reply) => {
    const params = z.object({ address }).safeParse(req.params);
    const body = z
      .strictObject({
        name: z.string().trim().max(40).optional(),
        shown: z.boolean().optional(),
        position: z.number().int().min(0).max(999).optional(),
      })
      .safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_input' });
    return house.rooms.update(params.data.address, body.data) ? settingsView() : reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/api/house/sensors/:address', { preHandler: [app.requireUser] }, async (req, reply) => {
    const params = z.object({ address }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_input' });
    return house.rooms.forget(params.data.address) ? settingsView() : reply.code(404).send({ error: 'not_found' });
  });
}
