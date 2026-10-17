import type { FastifyInstance } from 'fastify';
import { hubSettingsInput } from '../services/hubSettings.js';

/**
 * Settings → Hub: the hub's own settings, for signed-in people only (never
 * kiosk screens), CSRF-guarded like every cookie write, validated, rate
 * limited. The CARTO key is write-only: the browser only learns whether one is
 * saved and its first and last four characters.
 */
export default async function hubSettingsRoutes(app: FastifyInstance): Promise<void> {
  const { settings, home, env } = app.ctx;

  const view = () => ({
    settings: settings.publicView(),
    // Read-only context the page shows next to the fields.
    info: {
      timezone: env.timezone,
      trackerLeads: home.trackerLeads,
      effective: { home: home.get(), homeSource: home.source, units: home.units },
      leftoverEnvKeys: settings.leftoverEnvKeys,
    },
  });

  app.get('/api/hub-settings', { preHandler: [app.requireUser] }, async () => view());

  app.put('/api/hub-settings', { preHandler: [app.requireUser], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = hubSettingsInput.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return reply.code(400).send({ error: 'invalid_input', message: issue?.message ?? 'invalid settings', field: issue?.path.join('.') });
    }
    const before = settings.values;
    settings.update(parsed.data, req.userId);
    const changed = Object.keys(parsed.data).filter((k) => k !== 'cartoApiKey' && JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((parsed.data as Record<string, unknown>)[k]));
    if (parsed.data.cartoApiKey !== undefined && parsed.data.cartoApiKey !== '') changed.push('cartoApiKey');
    // Names of what changed, never values (the key is a secret).
    req.log.info({ event: 'hub_settings_saved', by: req.userId, changed }, 'hub settings saved');
    return view();
  });
}
