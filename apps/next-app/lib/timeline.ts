import { MONTH_NAMES, WEEKDAYS_MON, addDays, diffDays, isoToDateKey, startOfWeek, weekdayMon } from './dates';
import type { Project, Task } from './types';
import { projectMap, projectPath, projectTree } from './workflow';

export type Zoom = 'week' | 'month' | 'quarter';
export const ZOOMS: readonly Zoom[] = ['week', 'month', 'quarter'];
export const ZOOM_LABEL: Record<Zoom, string> = { week: 'Week', month: 'Month', quarter: 'Quarter' };
/** Horizontal scale: pixels per day. */
export const ZOOM_PX: Record<Zoom, number> = { week: 44, month: 16, quarter: 6 };

export interface Span {
  /** first day of the bar ('YYYY-MM-DD') */
  start: string;
  /** last day of the bar = the due date */
  end: string;
  /** due date lies before the creation day: the bar collapses to the due day */
  inverted: boolean;
}

/** Bar from the creation day to the due date; null for tasks without a due date. */
export function taskSpan(task: Pick<Task, 'createdAt' | 'dueDate'>): Span | null {
  if (!task.dueDate) return null;
  const created = isoToDateKey(task.createdAt);
  if (task.dueDate < created) return { start: task.dueDate, end: task.dueDate, inverted: true };
  return { start: created, end: task.dueDate, inverted: false };
}

export interface Range {
  start: string;
  /** inclusive */
  end: string;
  days: number;
}

function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

function monthEnd(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${key.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

/** Visible date range covering all spans and today, padded and aligned to the zoom's unit. */
export function timelineRange(spans: Span[], today: string, zoom: Zoom): Range {
  let lo = today;
  let hi = today;
  for (const s of spans) {
    if (s.start < lo) lo = s.start;
    if (s.end > hi) hi = s.end;
  }
  let start: string;
  let end: string;
  if (zoom === 'week') {
    start = startOfWeek(addDays(lo, -2));
    end = addDays(startOfWeek(addDays(hi, 2)), 6);
  } else {
    start = monthStart(addDays(lo, -3));
    end = monthEnd(addDays(hi, 3));
  }
  return { start, end, days: diffDays(start, end) + 1 };
}

export interface Tick {
  date: string;
  label: string;
  /** stronger grid line + label */
  major: boolean;
}

/** Header ticks: days (week zoom), Mondays (month zoom) or months with weekly minor lines (quarter zoom). */
export function timelineTicks(range: Range, zoom: Zoom): Tick[] {
  const ticks: Tick[] = [];
  for (let i = 0; i < range.days; i++) {
    const d = addDays(range.start, i);
    const day = Number(d.slice(8));
    const month = MONTH_NAMES[Number(d.slice(5, 7)) - 1].slice(0, 3);
    if (zoom === 'week') {
      ticks.push({ date: d, label: `${WEEKDAYS_MON[weekdayMon(d)].charAt(0)} ${day}`, major: weekdayMon(d) === 0 });
    } else if (zoom === 'month') {
      if (weekdayMon(d) === 0) ticks.push({ date: d, label: `${month} ${day}`, major: day <= 7 });
    } else if (day === 1) {
      ticks.push({ date: d, label: `${month} ${d.slice(0, 4)}`, major: true });
    } else if (weekdayMon(d) === 0) {
      ticks.push({ date: d, label: '', major: false });
    }
  }
  return ticks;
}

/** Month bands for the upper header row (week and month zoom). */
export function monthBands(range: Range): { start: string; days: number; label: string }[] {
  const out: { start: string; days: number; label: string }[] = [];
  let cur = range.start;
  while (cur <= range.end) {
    const end = monthEnd(cur) < range.end ? monthEnd(cur) : range.end;
    out.push({ start: cur, days: diffDays(cur, end) + 1, label: `${MONTH_NAMES[Number(cur.slice(5, 7)) - 1]} ${cur.slice(0, 4)}` });
    cur = addDays(end, 1);
  }
  return out;
}

export interface TimelineGroup {
  /** project id, or NO_GROUP for tasks without a project */
  id: string;
  name: string;
  color: string | null;
  tasks: { task: Task; span: Span }[];
  /** combined extent of the group's bars */
  span: Span | null;
}

export const NO_GROUP = 'none';

/** Dated tasks grouped by project (tree order, "No project" last), each sorted by start then due. */
export function groupTimeline(tasks: Task[], projects: Project[]): { groups: TimelineGroup[]; undated: Task[] } {
  // Tree order; sub-project groups are named by their path ("Website › Landing").
  const groups = new Map<string, TimelineGroup>();
  const byId = projectMap(projects);
  for (const { project: p } of projectTree(projects)) groups.set(p.id, { id: p.id, name: projectPath(byId, p.id), color: p.color, tasks: [], span: null });
  const none: TimelineGroup = { id: NO_GROUP, name: 'No project', color: null, tasks: [], span: null };
  const undated: Task[] = [];
  for (const t of tasks) {
    const span = taskSpan(t);
    if (!span) {
      undated.push(t);
      continue;
    }
    (groups.get(t.projectId ?? '') ?? none).tasks.push({ task: t, span });
  }
  const out = [...groups.values(), none].filter((g) => g.tasks.length);
  for (const g of out) {
    g.tasks.sort((a, b) => a.span.start.localeCompare(b.span.start) || a.span.end.localeCompare(b.span.end) || a.task.title.localeCompare(b.task.title));
    let start = g.tasks[0].span.start;
    let end = g.tasks[0].span.end;
    for (const { span } of g.tasks) {
      if (span.start < start) start = span.start;
      if (span.end > end) end = span.end;
    }
    g.span = { start, end, inverted: false };
  }
  return { groups: out, undated };
}

/** x position (px) of the left edge of a day. */
export function dayX(range: Range, day: string, pxPerDay: number): number {
  return diffDays(range.start, day) * pxPerDay;
}

/** New due date after dragging the bar's right end by `dx` pixels; never before the bar start. */
export function draggedDue(span: Span, dx: number, pxPerDay: number): string {
  const delta = Math.round(dx / pxPerDay);
  const due = addDays(span.end, delta);
  return due < span.start ? span.start : due;
}

export interface Edge {
  from: string;
  to: string;
}

/** Dependency edges blocker → blocked between tasks that are both shown. */
export function dependencyEdges(tasks: Task[], shown: Set<string>): Edge[] {
  const out: Edge[] = [];
  for (const t of tasks) {
    if (!shown.has(t.id)) continue;
    for (const b of t.blockedBy) if (shown.has(b)) out.push({ from: b, to: t.id });
  }
  return out;
}
