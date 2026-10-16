/** Date helpers operating on local calendar days encoded as 'YYYY-MM-DD' keys. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAYS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar date of a Date object. */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local calendar date of an ISO timestamp. */
export function isoToDateKey(iso: string): string {
  return toDateKey(new Date(iso));
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(key: string, n: number): string {
  return utcToKey(keyToUtc(key) + n * DAY_MS);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / DAY_MS);
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayMon(key: string): number {
  return (new Date(keyToUtc(key)).getUTCDay() + 6) % 7;
}

export function startOfWeek(key: string): string {
  return addDays(key, -weekdayMon(key));
}

export function isValidDateKey(key: string): boolean {
  if (!DATE_KEY_RE.test(key)) return false;
  return utcToKey(keyToUtc(key)) === key;
}

/** "Oct 15" — locale independent so SSR and client agree. */
export function formatShort(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function formatLong(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Human friendly relative due label. */
export function relativeDue(key: string, today: string): string {
  const d = diffDays(today, key);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < 0) return `${-d}d overdue`;
  if (d < 7) return `In ${d}d`;
  return formatShort(key);
}

/** Month grid (Mon-first) covering the whole month: always full weeks. */
export function monthGrid(year: number, month0: number): string[] {
  const first = `${year}-${pad(month0 + 1)}-01`;
  const start = startOfWeek(first);
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const last = `${year}-${pad(month0 + 1)}-${pad(daysInMonth)}`;
  const end = addDays(last, 6 - weekdayMon(last));
  const total = diffDays(start, end) + 1;
  return Array.from({ length: total }, (_, i) => addDays(start, i));
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Same day-of-month `n` months later, clamped to the last day of the target month (Jan 31 + 1 → Feb 28/29). */
export function addMonths(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, daysInTarget))}`;
}

/** "Oct 16, 2026, 09:05" in local time — locale independent. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatLong(toDateKey(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
