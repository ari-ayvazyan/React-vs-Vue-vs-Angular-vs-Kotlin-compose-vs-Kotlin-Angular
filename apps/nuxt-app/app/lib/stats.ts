import type { Member, Priority, Project, Task } from './types';
import { PRIORITIES } from './types';
import { addDays, dayOfTimestamp, daysBetween, parseISODate, toISODate } from './dates';
import { isOverdue, matchesProject } from './filters';
import { makeProjectScope } from './projects';
import type { ProjectScope } from './projects';

export interface Kpis {
  total: number;
  open: number;
  overdue: number;
  completed7d: number;
  completionRate: number;
  hoursTracked: number;
}

export function computeKpis(tasks: readonly Task[], today: string): Kpis {
  const weekStart = toISODate(addDays(parseISODate(today), -6));
  let open = 0;
  let overdue = 0;
  let done = 0;
  let completed7d = 0;
  let minutes = 0;
  for (const t of tasks) {
    minutes += t.timeSpentMinutes;
    if (t.status === 'done') {
      done++;
      if (t.completedAt) {
        const d = dayOfTimestamp(t.completedAt);
        if (d >= weekStart && d <= today) completed7d++;
      }
    } else {
      open++;
      if (isOverdue(t, today)) overdue++;
    }
  }
  return {
    total: tasks.length,
    open,
    overdue,
    completed7d,
    completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    hoursTracked: Math.round((minutes / 60) * 10) / 10,
  };
}

export interface DayCount {
  date: string;
  count: number;
}

/** Tasks completed per day for the `days` days ending today (oldest first). */
export function completedPerDay(tasks: readonly Task[], today: string, days = 30): DayCount[] {
  const start = addDays(parseISODate(today), -(days - 1));
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (t.status === 'done' && t.completedAt) {
      const d = dayOfTimestamp(t.completedAt);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  const out: DayCount[] = [];
  for (let i = 0; i < days; i++) {
    const date = toISODate(addDays(start, i));
    out.push({ date, count: counts.get(date) ?? 0 });
  }
  return out;
}

export function openByPriority(tasks: readonly Task[]): Record<Priority, number> {
  const out = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;
  for (const t of tasks) if (t.status !== 'done') out[t.priority]++;
  return out;
}

export interface ProjectProgress {
  project: Project;
  total: number;
  done: number;
  percent: number;
}

/** Task counts and completion per project, including the tasks of all its sub-projects. */
export function projectProgress(projects: readonly Project[], tasks: readonly Task[]): ProjectProgress[] {
  const direct = new Map<string, { total: number; done: number }>();
  for (const t of tasks) {
    if (!t.projectId) continue;
    const e = direct.get(t.projectId) ?? { total: 0, done: 0 };
    e.total++;
    if (t.status === 'done') e.done++;
    direct.set(t.projectId, e);
  }
  const scope = makeProjectScope(projects);
  return projects.map((project) => {
    let total = 0;
    let done = 0;
    for (const id of scope(project.id)) {
      const e = direct.get(id);
      if (e) {
        total += e.total;
        done += e.done;
      }
    }
    return { project, total, done, percent: total ? Math.round((done / total) * 100) : 0 };
  });
}

/** Consecutive days with ≥1 completion, ending today or (if nothing today yet) yesterday. */
export function productivityStreak(tasks: readonly Task[], today: string): number {
  const days = new Set<string>();
  for (const t of tasks) if (t.status === 'done' && t.completedAt) days.add(dayOfTimestamp(t.completedAt));
  let cursor = parseISODate(today);
  if (!days.has(today)) cursor = addDays(cursor, -1);
  let streak = 0;
  while (days.has(toISODate(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Open tasks due within the next `days` days (today inclusive), soonest first. */
export function upcomingDeadlines(tasks: readonly Task[], today: string, days = 7, max = 8): Task[] {
  const end = toISODate(addDays(parseISODate(today), days));
  return tasks
    .filter((t) => t.status !== 'done' && t.dueDate !== null && t.dueDate >= today && t.dueDate <= end)
    .sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string) || a.id.localeCompare(b.id, 'en', { numeric: true }))
    .slice(0, max);
}

export function overdueTasks(tasks: readonly Task[], today: string, max = 8): Task[] {
  return tasks
    .filter((t) => isOverdue(t, today))
    .sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string))
    .slice(0, max);
}

export interface AssigneeLoad {
  /** null = unassigned */
  member: Member | null;
  open: number;
}

/**
 * Open (not done) tasks per member, in member order, followed by an "unassigned" entry.
 * Tasks pointing at an unknown member id count as unassigned.
 */
export function openByAssignee(members: readonly Member[], tasks: readonly Task[]): AssigneeLoad[] {
  const counts = new Map<string, number>(members.map((m) => [m.id, 0]));
  let unassigned = 0;
  for (const t of tasks) {
    if (t.status === 'done') continue;
    const c = t.assigneeId === null ? undefined : counts.get(t.assigneeId);
    if (c === undefined) unassigned++;
    else counts.set(t.assigneeId as string, c + 1);
  }
  return [...members.map((member) => ({ member, open: counts.get(member.id) ?? 0 })), { member: null, open: unassigned }];
}

/**
 * Burndown: number of open tasks at the end of each of the last `days` days (oldest first).
 * A task counts as open on day d when it was created on or before d and was not completed by the end of d.
 * `project`: '' = all tasks, 'none' = tasks without a project, otherwise a project id.
 */
export function burndown(tasks: readonly Task[], today: string, project = '', days = 30, scope?: ProjectScope): DayCount[] {
  const start = addDays(parseISODate(today), -(days - 1));
  const series: string[] = [];
  for (let i = 0; i < days; i++) series.push(toISODate(addDays(start, i)));
  // difference array over the window: +1 on the creation day, -1 the day after completion
  const delta = new Array<number>(days + 1).fill(0);
  const first = series[0] as string;
  /** position of a day in the window: 0 before it, `days` after it */
  const index = (day: string): number => (day < first ? 0 : day > today ? days : daysBetween(first, day));
  for (const t of tasks) {
    if (!matchesProject(t, project, scope)) continue;
    const created = dayOfTimestamp(t.createdAt);
    if (created > today) continue;
    const from = index(created);
    let to = days; // exclusive end of the open interval within the window
    if (t.status === 'done') {
      if (!t.completedAt) continue;
      // open at the end of day d ⇔ created ≤ d and not completed by d
      to = index(dayOfTimestamp(t.completedAt));
    }
    if (to <= from) continue;
    (delta[from] as number)++;
    (delta[to] as number)--;
  }
  const out: DayCount[] = [];
  let open = 0;
  for (let i = 0; i < days; i++) {
    open += delta[i] as number;
    out.push({ date: series[i] as string, count: open });
  }
  return out;
}

export interface Workload {
  /** null = unassigned */
  member: Member | null;
  open: number;
  /** sum of estimates of open tasks, minutes */
  minutes: number;
  /** open tasks without an estimate */
  unestimated: number;
}

/** Workload per member (member order) plus an unassigned entry: open tasks and their summed estimates. */
export function workloadByAssignee(members: readonly Member[], tasks: readonly Task[]): Workload[] {
  const rows = new Map<string, Workload>(members.map((m) => [m.id, { member: m, open: 0, minutes: 0, unestimated: 0 }]));
  const none: Workload = { member: null, open: 0, minutes: 0, unestimated: 0 };
  for (const t of tasks) {
    if (t.status === 'done') continue;
    const row = (t.assigneeId && rows.get(t.assigneeId)) || none;
    row.open++;
    if (t.estimateMinutes) row.minutes += t.estimateMinutes;
    else row.unestimated++;
  }
  return [...rows.values(), none];
}

export interface CycleTime {
  /** average days from creation to completion, null when no completed tasks */
  avgDays: number | null;
  count: number;
}

/** Average cycle time (createdAt → completedAt, in days, one decimal) of completed tasks per priority. */
export function cycleTimeByPriority(tasks: readonly Task[]): Record<Priority, CycleTime> {
  const acc = Object.fromEntries(PRIORITIES.map((p) => [p, { sum: 0, count: 0 }])) as Record<Priority, { sum: number; count: number }>;
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completedAt) continue;
    const ms = Date.parse(t.completedAt) - Date.parse(t.createdAt);
    if (!Number.isFinite(ms) || ms < 0) continue;
    acc[t.priority].sum += ms / 86400000;
    acc[t.priority].count++;
  }
  return Object.fromEntries(
    PRIORITIES.map((p) => [p, { avgDays: acc[p].count ? Math.round((acc[p].sum / acc[p].count) * 10) / 10 : null, count: acc[p].count }]),
  ) as Record<Priority, CycleTime>;
}
