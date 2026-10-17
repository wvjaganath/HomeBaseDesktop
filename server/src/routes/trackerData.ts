import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { TrackerAdminError } from '../services/trackerAdmin.js';
import { callsignInput, pickInput, routeInput, TrackerData } from '../services/trackerData.js';

const ymd = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/**
 * The plane tracker's stats, records, API log and flight tracking for the
 * Flights screens. Reading is for people and kiosk screens; looking a flight up
 * (which spends API credits) and changing what's tracked are for signed-in
 * people only, rate limited.
 */
export default async function trackerDataRoutes(app: FastifyInstance): Promise<void> {
  const data = new TrackerData(app.ctx.env.TRACKER_URL);
  const view = { preHandler: [app.requireViewer], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const person = { preHandler: [app.requireUser], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const write = (max: number, timeWindow: string) => ({ preHandler: [app.requireUser], config: { rateLimit: { max, timeWindow } } });

  const fail = (reply: FastifyReply, err: unknown): FastifyReply => {
    if (err instanceof TrackerAdminError) {
      const status = err.code === 'not_configured' ? 409 : err.code === 'rejected' ? 422 : 502;
      return reply.code(status).send({ error: `tracker_${err.code}`, message: err.message });
    }
    throw err;
  };
  const bad = (reply: FastifyReply, error: z.ZodError): FastifyReply =>
    reply.code(400).send({ error: 'invalid_input', message: error.issues[0]?.message ?? 'invalid input', field: error.issues[0]?.path.join('.') });

  app.get('/api/tracker/stats', view, async (_req, reply) => {
    try {
      return await data.stats();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/tracker/stats/:date', view, async (req, reply) => {
    const p = ymd.safeParse(req.params);
    if (!p.success) return bad(reply, p.error);
    try {
      const day = await data.day(p.data.date);
      if (day) return day;
      return await reply.code(404).send({ error: 'not_found', message: 'No flights logged that day' });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/tracker/records', view, async (_req, reply) => {
    try {
      return await data.records();
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Which flights were looked up and when: for the people running the hub.
  app.get('/api/tracker/api-log', person, async (_req, reply) => {
    try {
      return { calls: await data.apiLog() };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/tracker/tracked', view, async (_req, reply) => {
    try {
      return { tracked: await data.tracked() };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/tracker/tracked/lookup', write(10, '1 minute'), async (req, reply) => {
    const p = callsignInput.safeParse(req.body);
    if (!p.success) return bad(reply, p.error);
    try {
      return await data.lookup(p.data.callsign);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/tracker/tracked', write(20, '1 minute'), async (req, reply) => {
    const p = pickInput.safeParse(req.body);
    if (!p.success) return bad(reply, p.error);
    try {
      const message = await data.track(p.data.callsign, p.data.leg);
      req.log.info({ event: 'tracker_track', by: req.userId, callsign: p.data.callsign }, 'tracking a flight');
      return { ok: true, message };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/tracker/tracked', write(20, '1 minute'), async (req, reply) => {
    try {
      const message = await data.stopTracking();
      req.log.info({ event: 'tracker_track_cleared', by: req.userId }, 'flight tracking cleared');
      return { ok: true, message };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/tracker/route-search', write(10, '1 minute'), async (req, reply) => {
    const p = routeInput.safeParse(req.body);
    if (!p.success) return bad(reply, p.error);
    try {
      return await data.searchRoute(p.data.origin, p.data.destination);
    } catch (err) {
      return fail(reply, err);
    }
  });
}
