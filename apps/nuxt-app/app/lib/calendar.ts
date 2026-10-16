import type { Task } from './types';
import { addDays, startOfWeek, toISODate } from './dates';

export interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
}

/** Month grid starting on Monday; always whole weeks (5 or 6 rows). `month` is 0-based. */
export function monthGrid(year: number, month: number): CalendarDay[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = startOfWeek(first);
  const days: CalendarDay[] = [];
  let d = start;
  while (d <= last || days.length % 7 !== 0) {
    days.push({ date: toISODate(d), day: d.getDate(), inMonth: d.getMonth() === month });
    d = addDays(d, 1);
  }
  return days;
}

export function tasksByDueDate(tasks: readonly Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.dueDate) continue;
    const list = map.get(t.dueDate);
    if (list) list.push(t);
    else map.set(t.dueDate, [t]);
  }
  return map;
}

export function parseMonthParam(v: string | undefined, fallback: Date): { year: number; month: number } {
  const m = v?.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const month = Number(m[2]) - 1;
    if (month >= 0 && month < 12) return { year: Number(m[1]), month };
  }
  return { year: fallback.getFullYear(), month: fallback.getMonth() };
}

export function monthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}
