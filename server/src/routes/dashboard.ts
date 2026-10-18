import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CALENDAR_COLORS, calendarSourceInput } from '../services/calendar.js';
import { openReminders, pinnedNotes } from '../services/lists.js';
import { CALLSIGN_RE, HEX_RE } from '../services/routeLookup.js';

/** CARTO Dark Matter raster tiles (Leaflet template), keyed when a key is saved. */
export const cartoTileUrl = (key: string): string =>
  `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png${key ? `?key=${encodeURIComponent(key)}` : ''}`;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Read-only data for the screens (people and kiosk devices) + calendar settings. */
export default async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const { env, db, tracker, radar, routes, calendar, home, settings } = app.ctx;

  app.get('/api/config', { preHandler: [app.requireViewer] }, async () => ({
    units: home.units,
    timezone: env.timezone,
    home: home.get() ?? { lat: 0, lon: 0 },
    homeSource: home.source,
    radarRadiusNm: settings.values.radarRadiusNm,
    trackerEnabled: env.TRACKER_URL !== '',
    trackerBundled: env.TRACKER_BUNDLED,
    radarEnabled: radar.snapshot.data.enabled,
    radarOff: radar.snapshot.data.off,
    mapKey: settings.cartoApiKey !== '',
    // CARTO's terms: tiles go straight from CARTO to each screen (no relaying or
    // caching on the hub), so the screens get the tile address with the key.
    mapTileUrl: cartoTileUrl(settings.cartoApiKey),
    mirrorEnabled: env.MIRROR_URL !== '',
    calendarColors: CALENDAR_COLORS,
  }));

  app.get('/api/tracker', { preHandler: [app.requireViewer] }, async () => tracker.snapshot);

  app.get('/api/radar', { preHandler: [app.requireViewer] }, async () => {
    radar.touch();
    return radar.snapshot;
  });

  app.get(
    '/api/radar/details/:hex',
    { preHandler: [app.requireViewer], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const params = z.object({ hex: z.string().regex(HEX_RE) }).safeParse(req.params);
      const query = z.object({ callsign: z.string().regex(CALLSIGN_RE).optional() }).safeParse(req.query);
      if (!params.success || !query.success) return reply.code(400).send({ error: 'invalid_input' });
      const [route, airframe] = await Promise.all([
        query.data.callsign ? routes.route(query.data.callsign).catch(() => null) : Promise.resolve(null),
        routes.airframe(params.data.hex).catch(() => null),
      ]);
      return { route, airframe };
    },
  );

  app.get('/api/lists', { preHandler: [app.requireViewer] }, async (req) => ({
    reminders: openReminders(db, req.userId),
    notes: pinnedNotes(db, req.userId),
  }));

  app.get('/api/calendar', { preHandler: [app.requireViewer] }, async (req, reply) => {
    const q = z.object({ from: ymd, to: ymd }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      return { events: calendar.events(req.userId, q.data.from, q.data.to), sources: calendar.listSources(req.userId) };
    } catch {
      return reply.code(400).send({ error: 'invalid_range' });
    }
  });

  // --- Calendar sources (people only; URLs are write-only secrets) ------------

  app.get('/api/calendars', { preHandler: [app.requireUser] }, async (req) => ({
    sources: calendar.listSources(req.userId),
  }));

  app.post(
    '/api/calendars',
    { preHandler: [app.requireUser], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = calendarSourceInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', details: z.flattenError(parsed.error).fieldErrors });
      }
      try {
        return await calendar.addSource(req.userId, parsed.data);
      } catch (err) {
        if (err instanceof Error && err.message === 'too_many_calendars') return reply.code(409).send({ error: 'too_many_calendars' });
        throw err;
      }
    },
  );

  app.patch('/api/calendars/:id', { preHandler: [app.requireUser] }, async (req, reply) => {
    const params = z.object({ id: z.guid() }).safeParse(req.params);
    const body = z
      .object({ name: z.string().trim().min(1).max(60).optional(), color: z.enum(CALENDAR_COLORS).optional() })
      .safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_input' });
    return calendar.updateSource(req.userId, params.data.id, body.data) ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/api/calendars/:id', { preHandler: [app.requireUser] }, async (req, reply) => {
    const params = z.object({ id: z.guid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_input' });
    return calendar.removeSource(req.userId, params.data.id) ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
}
