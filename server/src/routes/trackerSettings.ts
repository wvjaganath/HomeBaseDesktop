import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { TrackerAdmin, TrackerAdminError, trackerSettingsSchema, wifiConnectSchema } from '../services/trackerAdmin.js';

/**
 * The LED plane tracker's settings, edited from HomeBase (Settings → Plane
 * tracker). The tracker's own web UI has no login, so on the hub these are for
 * signed-in people only: never kiosk screens, CSRF-guarded like every cookie
 * write, validated before anything is sent, and rate limited.
 */
export default async function trackerSettingsRoutes(app: FastifyInstance): Promise<void> {
  const admin = new TrackerAdmin(app.ctx.env);
  const user = { preHandler: [app.requireUser] };
  const limit = (max: number, timeWindow: string) => ({ preHandler: [app.requireUser], config: { rateLimit: { max, timeWindow } } });

  const fail = (reply: FastifyReply, err: unknown): FastifyReply => {
    if (err instanceof TrackerAdminError) {
      const status = err.code === 'not_configured' ? 409 : err.code === 'rejected' ? 422 : 502;
      return reply.code(status).send({ error: `tracker_${err.code}`, message: err.message });
    }
    throw err;
  };

  app.get('/api/tracker-admin/settings', user, async (_req, reply) => {
    try {
      return { configured: true, ...(await admin.getSettings()) };
    } catch (err) {
      if (err instanceof TrackerAdminError && err.code === 'not_configured') return { configured: false };
      return fail(reply, err);
    }
  });

  app.put('/api/tracker-admin/settings', limit(20, '1 minute'), async (req, reply) => {
    const parsed = trackerSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.slice(2).join('.') ?? '';
      return reply.code(400).send({ error: 'invalid_input', message: `${where ? `${where}: ` : ''}${issue?.message ?? 'invalid settings'}`, field: issue?.path.join('.') });
    }
    try {
      await admin.saveSettings(parsed.data);
      req.log.info({ event: 'tracker_settings_saved', by: req.userId }, 'plane tracker settings saved');
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/tracker-admin/restart', limit(3, '1 minute'), async (req, reply) => {
    try {
      await admin.restart();
      req.log.info({ event: 'tracker_restarted', by: req.userId }, 'plane tracker restart requested');
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/tracker-admin/status', user, async (_req, reply) => {
    try {
      return await admin.status();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/tracker-admin/wifi', user, async (_req, reply) => {
    try {
      return { wifi: await admin.wifiStatus() };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // A scan changes nothing but takes the radio for a few seconds: POST + limit.
  app.post('/api/tracker-admin/wifi/scan', limit(6, '1 minute'), async (_req, reply) => {
    try {
      return { scan: await admin.wifiScan() };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/tracker-admin/wifi/connect', limit(5, '10 minutes'), async (req, reply) => {
    const parsed = wifiConnectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', message: 'Enter the network name (and password if it has one).' });
    let r: { status: number; body: unknown };
    try {
      r = await admin.wifiConnect(parsed.data);
    } catch (err) {
      return fail(reply, err);
    }
    // Never log the password; the SSID is enough to see what happened.
    req.log.info({ event: 'tracker_wifi_connect', by: req.userId, ssid: parsed.data.ssid, status: r.status }, 'plane tracker Wi-Fi change requested');
    const body = z
      .looseObject({ success: z.boolean().optional(), switched: z.boolean().optional(), message: z.string().optional(), error: z.string().optional() })
      .safeParse(r.body);
    return reply.code(r.status >= 500 ? 502 : r.status === 400 ? 400 : 200).send(body.success ? body.data : { success: false, error: 'Unexpected reply from the tracker' });
  });
}
