import { Project, Task } from './models';
import { MONTH_NAMES, addDays, diffDays, parseDateKey, startOfWeek, toDateKey } from './dates';

export type Zoom = 'week' | 'month' | 'quarter';
export const ZOOMS: readonly Zoom[] = ['week', 'month', 'quarter'];
/** Pixels per day at each zoom level. */
export const ZOOM_PX: Record<Zoom, number> = { week: 40, month: 14, quarter: 4 };
/** The range never extends more than this many days from today (keeps the canvas bounded). */
export const MAX_SPAN_DAYS = 730;

export interface TimelineItem {
  task: Task;
  /** YYYY-MM-DD; the creation day, or the due day if that is earlier. */
  start: string;
  /** YYYY-MM-DD; the due day. */
  end: string;
}

export interface TimelineGroup {
  /** Project id, or 'none' for tasks without a project. */
  id: string;
  name: string;
  color: string | null;
  items: TimelineItem[];
}

export interface TimelineData {
  groups: TimelineGroup[];
  /** Tasks without a due date (cannot be drawn). */
  undated: Task[];
}

const NO_PROJECT = 'none';

/** Groups dated tasks by project (project order, then "No project"); empty groups are omitted. */
export function buildTimeline(
  tasks: readonly Task[],
  projects: readonly Project[],
  opts: { hideDone?: boolean } = {},
): TimelineData {
  const byGroup = new Map<string, TimelineItem[]>();
  const undated: Task[] = [];
  const known = new Set(projects.map((p) => p.id));
  for (const task of tasks) {
    if (opts.hideDone && task.status === 'done') continue;
    if (!task.dueDate) {
      undated.push(task);
      continue;
    }
    const created = toDateKey(new Date(task.createdAt));
    const item = {
      task,
      start: created < task.dueDate ? created : task.dueDate,
      end: task.dueDate,
    };
    const gid = task.projectId && known.has(task.projectId) ? task.projectId : NO_PROJECT;
    const list = byGroup.get(gid);
    if (list) list.push(item);
    else byGroup.set(gid, [item]);
  }
  const byStart = (a: TimelineItem, b: TimelineItem) =>
    a.start.localeCompare(b.start) ||
    a.end.localeCompare(b.end) ||
    a.task.title.localeCompare(b.task.title, undefined, { numeric: true });
  const groups: TimelineGroup[] = [];
  for (const p of projects) {
    const items = byGroup.get(p.id);
    if (items) groups.push({ id: p.id, name: p.name, color: p.color, items: items.sort(byStart) });
  }
  const none = byGroup.get(NO_PROJECT);
  if (none)
    groups.push({ id: NO_PROJECT, name: 'No project', color: null, items: none.sort(byStart) });
  return { groups, undated };
}

export interface TimelineRange {
  /** First day shown (YYYY-MM-DD). */
  start: string;
  /** Number of days shown. */
  days: number;
}

/**
 * The visible date range: all bars plus today, padded and aligned to the zoom's unit
 * (Monday for week/month zoom, the 1st of a month for quarter zoom), clamped around today.
 */
export function timelineRange(
  groups: readonly TimelineGroup[],
  today: string,
  zoom: Zoom,
): TimelineRange {
  let min = today;
  let max = today;
  for (const g of groups)
    for (const it of g.items) {
      if (it.start < min) min = it.start;
      if (it.end > max) max = it.end;
    }
  const t = parseDateKey(today);
  const lo = toDateKey(addDays(t, -MAX_SPAN_DAYS));
  const hi = toDateKey(addDays(t, MAX_SPAN_DAYS));
  if (min < lo) min = lo;
  if (max > hi) max = hi;
  const pad = zoom === 'week' ? 3 : zoom === 'month' ? 7 : 14;
  let start = addDays(parseDateKey(min), -pad);
  let end = addDays(parseDateKey(max), pad);
  if (zoom === 'quarter') {
    start = new Date(start.getFullYear(), start.getMonth(), 1);
    end = new Date(end.getFullYear(), end.getMonth() + 1, 0);
  } else {
    start = startOfWeek(start);
    end = addDays(startOfWeek(end), 6);
  }
  return { start: toDateKey(start), days: diffDays(toDateKey(end), toDateKey(start)) + 1 };
}

/** Days from the range start to `key` (may be negative or beyond the range). */
export function dayOffset(range: TimelineRange, key: string): number {
  return diffDays(key, range.start);
}

export interface AxisTick {
  key: string;
  /** Days from the range start. */
  offset: number;
  label: string;
  /** Starts a new larger unit (week in week zoom, month otherwise): drawn stronger. */
  major: boolean;
}

const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Header ticks: days (week zoom), Mondays (month zoom) or month starts (quarter zoom). */
export function axisTicks(range: TimelineRange, zoom: Zoom): AxisTick[] {
  const out: AxisTick[] = [];
  const start = parseDateKey(range.start);
  for (let i = 0; i < range.days; i++) {
    const d = addDays(start, i);
    const key = toDateKey(d);
    const dom = d.getDate();
    if (zoom === 'week') {
      out.push({
        key,
        offset: i,
        label: `${WEEKDAY_INITIALS[d.getDay()]} ${dom}`,
        major: d.getDay() === 1,
      });
    } else if (zoom === 'month') {
      if (d.getDay() === 1)
        out.push({
          key,
          offset: i,
          label: `${SHORT_MONTHS[d.getMonth()]} ${dom}`,
          major: dom <= 7,
        });
    } else if (dom === 1) {
      const label =
        d.getMonth() === 0 || out.length === 0
          ? `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`
          : SHORT_MONTHS[d.getMonth()];
      out.push({ key, offset: i, label, major: d.getMonth() % 3 === 0 });
    }
  }
  return out;
}

export type TimelineRow =
  | { kind: 'group'; group: TimelineGroup; collapsed: boolean }
  | { kind: 'task'; item: TimelineItem; groupId: string };

/** One row per group header, plus one per task of expanded groups. */
export function flattenRows(
  groups: readonly TimelineGroup[],
  collapsed: ReadonlySet<string>,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const group of groups) {
    const isCollapsed = collapsed.has(group.id);
    rows.push({ kind: 'group', group, collapsed: isCollapsed });
    if (!isCollapsed)
      for (const item of group.items) rows.push({ kind: 'task', item, groupId: group.id });
  }
  return rows;
}

/** Index range [first, last) of rows to render for a scroll position (with overscan). */
export function visibleWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan = 8,
): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  return { first, last: Math.max(first, last) };
}

/** New due date after dragging the bar end by `deltaDays`; never before `minKey` (the bar start). */
export function shiftDueDate(due: string, deltaDays: number, minKey: string): string {
  const next = toDateKey(addDays(parseDateKey(due), Math.round(deltaDays)));
  return next < minKey ? minKey : next;
}
