import { describe, expect, it } from 'vitest';
import { bearingDeg, cardinal, haversineMiles } from '../src/lib/geo.js';
import { isPrivateAddress } from '../src/security/safeFetch.js';
import { SecretBox } from '../src/security/secretBox.js';
import { GOOGLE_ICAL_RE } from '../src/services/calendar.js';
import { arrivalDelayLevel, departureDelayLevel, shortAirportName } from '../src/services/tracker.js';

describe('tracker delay colours match the LED tracker thresholds', () => {
  const t0 = 1_800_000_000;
  it('departure', () => {
    expect(departureDelayLevel(null, t0)).toBe('unknown');
    expect(departureDelayLevel(t0 + 20 * 60, t0)).toBe('ontime');
    expect(departureDelayLevel(t0 + 21 * 60, t0)).toBe('minor');
    expect(departureDelayLevel(t0 + 50 * 60, t0)).toBe('moderate');
    expect(departureDelayLevel(t0 + 120 * 60, t0)).toBe('major');
    expect(departureDelayLevel(t0 + 300 * 60, t0)).toBe('severe');
    expect(departureDelayLevel(t0 + 600 * 60, t0)).toBe('extreme');
  });
  it('arrival', () => {
    expect(arrivalDelayLevel(t0 - 60, t0)).toBe('ontime');
    expect(arrivalDelayLevel(t0 + 10 * 60, t0)).toBe('minor');
    expect(arrivalDelayLevel(t0 + 45 * 60, t0)).toBe('moderate');
  });
  it('shortens airport names', () => {
    expect(shortAirportName('Chicago Midway International Airport')).toBe('Chicago Midway');
    expect(shortAirportName('Ontario International Airport')).toBe('Ontario');
  });
});

describe('SSRF helpers', () => {
  it('classifies private and public addresses', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '192.168.1.20', '172.16.5.4', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('Google iCal URL allow-list', () => {
  it('accepts secret and public Google iCal addresses only', () => {
    expect(GOOGLE_ICAL_RE.test('https://calendar.google.com/calendar/ical/me%40gmail.com/private-0123456789abcdef0123456789abcdef/basic.ics')).toBe(true);
    expect(GOOGLE_ICAL_RE.test('https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics')).toBe(true);
    expect(GOOGLE_ICAL_RE.test('http://calendar.google.com/calendar/ical/me/public/basic.ics')).toBe(false);
    expect(GOOGLE_ICAL_RE.test('https://calendar.google.com.evil.example/calendar/ical/me/public/basic.ics')).toBe(false);
    expect(GOOGLE_ICAL_RE.test('https://169.254.169.254/latest/meta-data')).toBe(false);
  });
});

describe('SecretBox', () => {
  it('round-trips and detects tampering', () => {
    const box = new SecretBox('', 'x'.repeat(40));
    const sealed = box.seal('https://calendar.google.com/secret');
    expect(sealed).not.toContain('calendar');
    expect(box.open(sealed)).toBe('https://calendar.google.com/secret');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
  });
});

describe('geo', () => {
  it('computes distance and bearing', () => {
    // Chicago Midway → Ontario CA is ~1,685 statute miles.
    expect(Math.round(haversineMiles(41.786, -87.7524, 34.056, -117.6012) / 10) * 10).toBe(1690);
    expect(cardinal(bearingDeg(41.7, -87.9, 41.6, -87.9))).toBe('S');
    expect(cardinal(359)).toBe('N');
  });
});
