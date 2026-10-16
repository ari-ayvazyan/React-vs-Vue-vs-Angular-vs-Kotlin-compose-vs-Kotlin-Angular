/** Date helpers working on local calendar days ('YYYY-MM-DD'). No external date library. */

const pad = (n: number): string => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function addDaysISO(iso: string, days: number): string {
  return toISODate(addDays(parseISODate(iso), days));
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const dow = (s.getDay() + 6) % 7; // Mon=0
  return addDays(s, -dow);
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISODate(parseISODate(s)) === s;
}

/** Local calendar day of an ISO timestamp. */
export function dayOfTimestamp(iso: string): string {
  return toISODate(new Date(iso));
}

export function formatDate(iso: string | null, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  if (!iso) return '';
  const d = iso.length === 10 ? parseISODate(iso) : new Date(iso);
  return d.toLocaleDateString('en-US', opts);
}

export function relativeDue(due: string, today: string): string {
  const diff = Math.round((parseISODate(due).getTime() - parseISODate(today).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${-diff}d overdue`;
  if (diff < 7) return `in ${diff}d`;
  return formatDate(due);
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Add calendar months to a 'YYYY-MM-DD' date. The day is clamped to the target month's length,
 * so Jan 31 + 1 month = Feb 28/29 (never rolls over into March).
 */
export function addMonthsISO(iso: string, months: number): string {
  const d = parseISODate(iso);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return toISODate(target);
}

/** Short relative time for timestamps: "just now", "5 min ago", "3 h ago", "yesterday", else a date. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const sec = Math.round((now.getTime() - then.getTime()) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(then).getTime()) / 86400000);
  if (dayDiff === 0) return `${h} h ago`;
  if (dayDiff === 1) return 'yesterday';
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(then.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

/** Full timestamp for tooltips. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Whole calendar days from `a` to `b` ('YYYY-MM-DD'), DST-safe. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
