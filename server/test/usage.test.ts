import { describe, expect, it } from 'vitest';
import { countFr24PerDay } from '../src/services/trackerData.js';
import { localDay } from '../src/services/usage.js';
import { registerUser, testApp } from './helpers.js';

describe('outside requests per day (Settings → Status)', () => {
  it('counts FR24 lookups per day from the tracker’s API log, not the “no route” lines', () => {
    const log = [
      '2026-10-19 08:01:02  FR24                  AAL788      JFK→ORD       [AL:0 FA:$0.000 FR:1]',
      '2026-10-19 08:03:10  NONE                  N172SP      ?→?           [AL:0 FA:$0.000 FR:1]',
      '2026-10-20 09:00:00  FR24                  UAL1252     EWR→ORD       [AL:0 FA:$0.000 FR:2]',
      '2026-10-20 09:02:00  FR24                  UAL398      ?→?           [AL:0 FA:$0.000 FR:3]',
      'garbage line',
    ].join('\n');
    expect(countFr24PerDay(log)).toEqual({ '2026-10-19': 1, '2026-10-20': 2 });
  });

  it('keeps a daily count for each free feed the hub calls and reports the last 7 days', async () => {
    const app = await testApp({ TRACKER_URL: '' });
    const auth = { authorization: `Bearer ${(await registerUser(app, 'u@example.com')).accessToken}` };
    app.ctx.usage.count('adsb.lol');
    app.ctx.usage.count('adsb.lol');
    app.ctx.usage.count('adsb.fi');
    app.ctx.usage.count('adsbdb');
    const s = (await app.inject({ method: 'GET', url: '/api/status', headers: auth })).json<{
      outsideRequests: { days: Array<Record<string, number | string | null>>; last30: Record<string, number>; fr24Known: boolean };
    }>();
    const today = s.outsideRequests.days[0];
    expect(today).toMatchObject({ day: localDay(), 'adsb.lol': 2, 'adsb.fi': 1, adsbdb: 1, fr24: null });
    expect(s.outsideRequests.days).toHaveLength(7);
    expect(s.outsideRequests.last30).toMatchObject({ 'adsb.lol': 2, 'adsb.fi': 1, adsbdb: 1 });
    expect(s.outsideRequests.fr24Known).toBe(false); // no tracker in this test
    await app.close();
  });
});
