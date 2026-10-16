import type { DelayLevel } from './types';

let tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
export function setTimezone(zone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    tz = zone;
  } catch {
    // keep the browser's zone
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts) + tz;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** "7:42" and "PM" separately, for the big clock. */
export function clockParts(d: Date): { time: string; period: string } {
  const parts = fmt({ hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const time = parts.filter((p) => p.type === 'hour' || p.type === 'minute' || p.type === 'literal').map((p) => p.value).join('').trim();
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  return { time, period };
}

export const longDate = (d: Date): string => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(d);
export const shortTime = (d: Date): string => fmt({ hour: 'numeric', minute: '2-digit' }).format(d);
export const compactTime = (d: Date): string =>
  fmt({ hour: 'numeric', minute: '2-digit' })
    .format(d)
    .replace(':00', '')
    .replace(' AM', 'a')
    .replace(' PM', 'p');
export const weekdayShort = (d: Date): string => fmt({ weekday: 'short' }).format(d).toUpperCase();
export const monthYear = (y: number, m: number): string =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(y, m, 1));

/** Today's date in the hub's time zone as YYYY-MM-DD. */
export function todayYmd(d = new Date()): string {
  const p = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD of an instant, in the hub's time zone. */
export function ymdInTz(iso: string): string {
  return todayYmd(new Date(iso));
}

export function relativeDue(iso: string, now: Date): string {
  const due = new Date(iso);
  const dueDay = todayYmd(due);
  const today = todayYmd(now);
  const tomorrow = todayYmd(new Date(now.getTime() + 86_400_000));
  const yesterday = todayYmd(new Date(now.getTime() - 86_400_000));
  if (dueDay === today) return `Today · ${shortTime(due)}`;
  if (dueDay === tomorrow) return `Tomorrow · ${shortTime(due)}`;
  if (dueDay === yesterday) return 'Yesterday';
  const days = (due.getTime() - now.getTime()) / 86_400_000;
  if (days > 0 && days < 7) return fmt({ weekday: 'short' }).format(due);
  return fmt({ month: 'short', day: 'numeric' }).format(due);
}

export const fmtInt = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US'));

export function distUnit(units: 'imperial' | 'metric'): string {
  return units === 'metric' ? 'km' : 'mi';
}

export const DELAY_COLORS: Record<DelayLevel, string> = {
  ontime: 'var(--ok)',
  minor: 'var(--warn)',
  moderate: 'var(--orange)',
  major: 'var(--bad)',
  severe: 'var(--purple)',
  extreme: 'var(--blue)',
  unknown: 'var(--unknown)',
};

/** Tomorrow.io weather codes (what the tracker uses) → icon + label. */
export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'sleet' | 'storm';
export function weatherKind(code: number | null): WeatherKind {
  if (code === null) return 'cloudy';
  const c = Math.round(code);
  if (c === 1000 || c === 10000 || c === 1100 || c === 11000) return 'clear';
  if (c === 1101 || c === 11010 || c === 1103 || c === 11030) return 'partly';
  if (c === 1102 || c === 1001 || c === 11020 || c === 10010) return 'cloudy';
  if (c >= 2000 && c < 3000) return 'fog';
  if (c >= 4000 && c < 5000) return 'rain';
  if (c >= 5000 && c < 6000) return 'snow';
  if (c >= 6000 && c < 8000) return 'sleet';
  if (c >= 8000 && c < 9000) return 'storm';
  const head = Number(String(c).slice(0, 4));
  return head !== c ? weatherKind(head) : 'cloudy';
}
export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear',
  partly: 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  rain: 'Rain',
  snow: 'Snow',
  sleet: 'Sleet',
  storm: 'Thunderstorms',
};

const MOON = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
export function moonName(phase: number | null): string {
  if (phase === null) return '';
  return MOON[Math.round(phase) % 8] ?? '';
}

/** Equirectangular offset (in miles) of a point from home; fine at radar scale. */
export function offsetMiles(home: { lat: number; lon: number }, lat: number, lon: number): { x: number; y: number } {
  const y = (lat - home.lat) * 69.05;
  const x = (lon - home.lon) * 69.17 * Math.cos((home.lat * Math.PI) / 180);
  return { x, y };
}
