import { addDays, isoToDateKey } from './dates';
import { isOverdue } from './filters';
import { childrenMap } from './workflow';
import { PRIORITIES, type Member, type Priority, type Project, type Task } from './types';

export interface Kpis {
  total: number;
  open: number;
  overdue: number;
  completed7d: number;
  completionRate: number;
  hoursTracked: number;
}

export function computeKpis(tasks: Task[], today: string): Kpis {
  const weekStart = addDays(today, -6);
  let open = 0;
  let overdue = 0;
  let done = 0;
  let completed7d = 0;
  let minutes = 0;
  for (const t of tasks) {
    minutes += t.timeSpentMinutes;
    if (t.category === 'done') {
      done++;
      if (t.completedAt) {
        const k = isoToDateKey(t.completedAt);
        if (k >= weekStart && k <= today) completed7d++;
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

/** Completed tasks per day for the last `days` days ending today (oldest first). */
export function completedPerDay(tasks: Task[], today: string, days = 30): DayCount[] {
  const start = addDays(today, -(days - 1));
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (t.category !== 'done' || !t.completedAt) continue;
    const k = isoToDateKey(t.completedAt);
    if (k >= start && k <= today) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    return { date, count: counts.get(date) ?? 0 };
  });
}

export function openByPriority(tasks: Task[]): Record<Priority, number> {
  const out = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;
  for (const t of tasks) if (t.category !== 'done') out[t.priority]++;
  return out;
}

export interface ProjectProgress {
  project: Project;
  total: number;
  done: number;
  pct: number;
}

/** Task counts and completion per project, including all of its sub-projects. */
export function projectProgress(tasks: Task[], projects: Project[]): ProjectProgress[] {
  const own = new Map<string, { total: number; done: number }>();
  for (const p of projects) own.set(p.id, { total: 0, done: 0 });
  for (const t of tasks) {
    const e = t.projectId ? own.get(t.projectId) : undefined;
    if (!e) continue;
    e.total++;
    if (t.category === 'done') e.done++;
  }
  // Roll up: each project's totals include its descendants'.
  const rolled = new Map<string, { total: number; done: number }>();
  const children = childrenMap(projects);
  const visit = (id: string, path: Set<string>): { total: number; done: number } => {
    const cached = rolled.get(id);
    if (cached) return cached;
    const sum = { ...own.get(id)! };
    for (const c of children.get(id) ?? []) {
      if (path.has(c.id)) continue;
      const r = visit(c.id, new Set(path).add(c.id));
      sum.total += r.total;
      sum.done += r.done;
    }
    rolled.set(id, sum);
    return sum;
  };
  return projects.map((project) => {
    const { total, done } = visit(project.id, new Set([project.id]));
    return { project, total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  });
}

export interface AssigneeLoad {
  /** null = unassigned */
  member: Member | null;
  open: number;
}

/**
 * Open (not done) tasks per member, busiest first (ties keep member order), followed by an
 * "unassigned" row when any open task has no (known) assignee.
 */
export function openPerAssignee(tasks: Task[], members: Member[]): AssigneeLoad[] {
  const counts = new Map<string, number>(members.map((m) => [m.id, 0]));
  let unassigned = 0;
  for (const t of tasks) {
    if (t.category === 'done') continue;
    const c = t.assigneeId !== null ? counts.get(t.assigneeId) : undefined;
    if (c === undefined) unassigned++;
    else counts.set(t.assigneeId!, c + 1);
  }
  const rows: AssigneeLoad[] = members
    .map((member) => ({ member, open: counts.get(member.id)! }))
    .sort((a, b) => b.open - a.open);
  if (unassigned) rows.push({ member: null, open: unassigned });
  return rows;
}

/** Consecutive days with ≥1 completion, ending today (or yesterday if nothing yet today). */
export function productivityStreak(tasks: Task[], today: string): number {
  const days = new Set<string>();
  for (const t of tasks) if (t.category === 'done' && t.completedAt) days.add(isoToDateKey(t.completedAt));
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Open tasks due within the next `days` days (today inclusive), soonest first. */
export function upcomingDeadlines(tasks: Task[], today: string, days = 7, limit = 8): Task[] {
  const end = addDays(today, days);
  return tasks
    .filter((t) => t.category !== 'done' && t.dueDate !== null && t.dueDate >= today && t.dueDate <= end)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export function overdueTasks(tasks: Task[], today: string): Task[] {
  return tasks.filter((t) => isOverdue(t, today)).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
}
