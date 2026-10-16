import type { Project, Task } from './types';
import { addDaysISO, dayOfTimestamp, daysBetween, parseISODate, startOfWeek, toISODate } from './dates';
import { projectTree } from './projects';

export type Zoom = 'week' | 'month' | 'quarter';
export const ZOOMS: readonly Zoom[] = ['week', 'month', 'quarter'];
export const ZOOM_LABELS: Record<Zoom, string> = { week: 'Week', month: 'Month', quarter: 'Quarter' };
/** Pixels per day for each zoom level. */
export const DAY_WIDTH: Record<Zoom, number> = { week: 40, month: 14, quarter: 5 };
export const ROW_HEIGHT = 30;
export const GROUP_HEIGHT = 34;

export interface TimelineGroupRow {
  kind: 'group';
  /** project id or 'none' */
  key: string;
  label: string;
  color: string | null;
  count: number;
  collapsed: boolean;
  y: number;
}

export interface TimelineTaskRow {
  kind: 'task';
  task: Task;
  groupKey: string;
  /** local day the task was created */
  start: string;
  due: string;
  y: number;
}

export type TimelineRow = TimelineGroupRow | TimelineTaskRow;

export interface TimelineModel {
  rows: TimelineRow[];
  height: number;
  /** first day shown (a Monday) */
  rangeStart: string;
  /** number of days shown */
  days: number;
  /** tasks without a due date (same filters), grouped order */
  undated: Task[];
  /** total dated tasks, including those in collapsed groups */
  datedCount: number;
}

export interface TimelineOptions {
  today: string;
  collapsed?: ReadonlySet<string>;
  hideDone?: boolean;
}

/**
 * Lay out the timeline: tasks with a due date grouped by project (project order, then "No project"),
 * sorted by start date inside a group. The date range covers every dated task and today, padded and aligned
 * to whole weeks, and does not change when groups are collapsed.
 */
export function buildTimeline(tasks: readonly Task[], projects: readonly Project[], opts: TimelineOptions): TimelineModel {
  const collapsed = opts.collapsed ?? new Set<string>();
  const projectIds = new Set(projects.map((p) => p.id));
  const byGroup = new Map<string, TimelineTaskRow[]>();
  const undated: Task[] = [];
  let min = opts.today;
  let max = opts.today;
  let datedCount = 0;
  for (const task of tasks) {
    if (opts.hideDone && task.status === 'done') continue;
    if (!task.dueDate) {
      undated.push(task);
      continue;
    }
    const start = dayOfTimestamp(task.createdAt);
    const key = task.projectId && projectIds.has(task.projectId) ? task.projectId : 'none';
    const list = byGroup.get(key) ?? [];
    list.push({ kind: 'task', task, groupKey: key, start, due: task.dueDate, y: 0 });
    byGroup.set(key, list);
    datedCount++;
    const lo = start < task.dueDate ? start : task.dueDate;
    const hi = start < task.dueDate ? task.dueDate : start;
    if (lo < min) min = lo;
    if (hi > max) max = hi;
  }

  const groups: { key: string; label: string; color: string | null }[] = [
    // tree order; sub-projects are separate groups labelled with their path ("Website / Docs")
    ...projectTree(projects).map((n) => ({ key: n.project.id, label: n.path, color: n.project.color })),
    { key: 'none', label: 'No project', color: null },
  ];
  const rows: TimelineRow[] = [];
  let y = 0;
  for (const g of groups) {
    const list = byGroup.get(g.key);
    if (!list?.length) continue;
    list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.due < b.due ? -1 : a.due > b.due ? 1 : a.task.id.localeCompare(b.task.id, 'en', { numeric: true })));
    const isCollapsed = collapsed.has(g.key);
    rows.push({ kind: 'group', key: g.key, label: g.label, color: g.color, count: list.length, collapsed: isCollapsed, y });
    y += GROUP_HEIGHT;
    if (isCollapsed) continue;
    for (const r of list) {
      r.y = y;
      rows.push(r);
      y += ROW_HEIGHT;
    }
  }

  const rangeStart = toISODate(startOfWeek(parseISODate(addDaysISO(min, -3))));
  const rangeEnd = addDaysISO(max, 10);
  const days = Math.max(28, daysBetween(rangeStart, rangeEnd) + 1);
  return { rows, height: y, rangeStart, days, undated, datedCount };
}

/** Horizontal geometry of a bar: covers whole days from start to due (inclusive), whichever comes first. */
export function barGeometry(start: string, due: string, rangeStart: string, dayWidth: number): { x: number; width: number; inverted: boolean; dueX: number } {
  const s = daysBetween(rangeStart, start);
  const d = daysBetween(rangeStart, due);
  const inverted = d < s;
  const lo = Math.min(s, d);
  const hi = Math.max(s, d);
  // the due handle sits on the due day's outer edge: right edge normally, left edge when due precedes start
  return { x: lo * dayWidth, width: (hi - lo + 1) * dayWidth, inverted, dueX: inverted ? d * dayWidth : (d + 1) * dayWidth };
}

/** New due date after dragging the due edge by `dx` pixels. */
export function dueAfterDrag(due: string, dx: number, dayWidth: number): string {
  return addDaysISO(due, Math.round(dx / dayWidth));
}

export interface AxisTick {
  /** day index from rangeStart */
  day: number;
  label: string;
}

/** Month labels (top header row) and day/week ticks (bottom row) for a zoom level. */
export function axisTicks(rangeStart: string, days: number, zoom: Zoom): { months: AxisTick[]; ticks: AxisTick[] } {
  const months: AxisTick[] = [];
  const ticks: AxisTick[] = [];
  const first = parseISODate(rangeStart);
  for (let i = 0; i < days; i++) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
    if (i === 0 || d.getDate() === 1) {
      const fmt: Intl.DateTimeFormatOptions = zoom === 'quarter' ? { month: 'short', year: 'numeric' } : { month: 'long', year: 'numeric' };
      months.push({ day: i, label: d.toLocaleDateString('en-US', fmt) });
    }
    const monday = d.getDay() === 1;
    if (zoom === 'week') ticks.push({ day: i, label: `${d.toLocaleDateString('en-US', { weekday: 'narrow' })} ${d.getDate()}` });
    else if (monday) ticks.push({ day: i, label: String(d.getDate()) });
  }
  return { months, ticks };
}

export interface DependencyLink {
  from: TimelineTaskRow;
  to: TimelineTaskRow;
}

/** Arrows from blocker to blocked task, for pairs where both rows are visible. */
export function dependencyLinks(rows: readonly TimelineRow[]): DependencyLink[] {
  const visible = new Map<string, TimelineTaskRow>();
  for (const r of rows) if (r.kind === 'task') visible.set(r.task.id, r);
  const out: DependencyLink[] = [];
  for (const to of visible.values()) {
    for (const id of to.task.blockedBy) {
      const from = visible.get(id);
      if (from) out.push({ from, to });
    }
  }
  return out;
}

/**
 * Elbow path from (x1, y1) – the blocker's due edge – to (x2, y2) – the blocked task's start edge.
 * When the target starts left of the source, the path detours between the two rows.
 */
export function linkPath(x1: number, y1: number, x2: number, y2: number, rowHeight = ROW_HEIGHT): string {
  const gap = 8;
  if (x2 - x1 >= gap * 2) {
    const mx = x1 + gap;
    return `M${x1},${y1} H${mx} V${y2} H${x2}`;
  }
  const midY = y2 > y1 ? y2 - rowHeight / 2 : y2 + rowHeight / 2;
  return `M${x1},${y1} H${x1 + gap} V${midY} H${x2 - gap} V${y2} H${x2}`;
}
