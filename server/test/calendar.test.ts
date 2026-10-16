import ical from 'node-ical';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerUser, testApp } from './helpers.js';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  // Weekly on Mondays at 9:00 UTC, with one week skipped (EXDATE).
  'BEGIN:VEVENT',
  'UID:weekly-1',
  'DTSTAMP:20261001T000000Z',
  'DTSTART:20261005T090000Z',
  'DTEND:20261005T100000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'EXDATE:20261012T090000Z',
  'SUMMARY:Sprint planning',
  'END:VEVENT',
  // An all-day event.
  'BEGIN:VEVENT',
  'UID:allday-1',
  'DTSTAMP:20261001T000000Z',
  'DTSTART;VALUE=DATE:20261031',
  'DTEND;VALUE=DATE:20261101',
  'SUMMARY:Halloween',
  'END:VEVENT',
  // A cancelled event must not show.
  'BEGIN:VEVENT',
  'UID:cancelled-1',
  'DTSTAMP:20261001T000000Z',
  'DTSTART:20261020T180000Z',
  'DTEND:20261020T190000Z',
  'STATUS:CANCELLED',
  'SUMMARY:Cancelled thing',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

let app: FastifyInstance;
beforeEach(async () => {
  app = await testApp();
});
afterEach(async () => {
  await app.close();
});

describe('calendar', () => {
  it('expands recurrences, honours EXDATE, keeps all-day dates, drops cancelled', async () => {
    const u = await registerUser(app, 'a@example.com');
    const { db, secretBox, calendar } = app.ctx;
    db.prepare(`INSERT INTO calendar_sources (id, user_id, name, color, url_enc, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      '00000000-0000-4000-8000-000000000001',
      u.id,
      'Work',
      '#2DD4BF',
      secretBox.seal('https://calendar.google.com/calendar/ical/x/public/basic.ics'),
      new Date().toISOString(),
    );
    // Inject parsed data as if the 5-minute refresh had fetched it.
    (calendar as unknown as { cache: Map<string, unknown> }).cache.set('00000000-0000-4000-8000-000000000001', {
      fetchedAt: Date.now(),
      ok: true,
      error: null,
      events: ical.sync.parseICS(ICS),
    });

    const events = calendar.events(u.id, '2026-10-01', '2026-11-08');
    const titles = events.map((e) => `${e.title}@${e.start.slice(0, 10)}`);
    expect(titles).toContain('Sprint planning@2026-10-05');
    expect(titles).not.toContain('Sprint planning@2026-10-12'); // EXDATE
    expect(titles).toContain('Sprint planning@2026-10-19');
    expect(titles).toContain('Sprint planning@2026-10-26');
    expect(titles).toContain('Sprint planning@2026-11-02');
    expect(titles.some((t) => t.startsWith('Cancelled'))).toBe(false);
    const halloween = events.find((e) => e.title === 'Halloween');
    expect(halloween?.allDay).toBe(true);
    expect(halloween?.start).toBe('2026-10-31');
    expect(halloween?.end).toBe('2026-11-01');

    // The API serves the same data and never exposes the secret URL.
    const res = await app.inject({
      method: 'GET',
      url: '/api/calendar?from=2026-10-01&to=2026-11-08',
      headers: { authorization: `Bearer ${u.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('calendar.google.com');
    expect(res.json().sources[0].name).toBe('Work');
  });

  it('rejects non-Google URLs and oversized ranges', async () => {
    const u = await registerUser(app, 'a@example.com');
    const auth = { authorization: `Bearer ${u.accessToken}` };
    const bad = await app.inject({ method: 'POST', url: '/api/calendars', headers: auth, payload: { name: 'x', url: 'http://169.254.169.254/latest', color: '#2DD4BF' } });
    expect(bad.statusCode).toBe(400);
    const range = await app.inject({ method: 'GET', url: '/api/calendar?from=2026-01-01&to=2026-12-31', headers: auth });
    expect(range.statusCode).toBe(400);
  });
});
