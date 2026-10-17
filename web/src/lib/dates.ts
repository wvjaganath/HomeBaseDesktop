/** Local-calendar date helpers for "YYYY-MM-DD" strings (no time zone shifts). */

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const todayStr = (): string => ymd(new Date());

/** Noon local time of a YYYY-MM-DD date, as epoch ms (safe across DST). */
export function ymdToTime(s: string): number {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).getTime();
}

export function addDays(s: string, n: number): string {
  const t = new Date(ymdToTime(s));
  t.setDate(t.getDate() + n);
  return ymd(t);
}

export function prettyDate(s: string): string {
  return new Date(ymdToTime(s)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export type Range = '1M' | '3M' | '6M' | '1Y' | 'All';
export const RANGES: Range[] = ['1M', '3M', '6M', '1Y', 'All'];

/** Earliest YYYY-MM-DD included by a range (inclusive), or '' for All. */
export function rangeStart(r: Range): string {
  const days = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, All: 0 }[r];
  return days === 0 ? '' : addDays(todayStr(), -days);
}
