import { Member, Priority, Project, Task } from './models';
import { addDays, toDateKey } from './dates';
import { isOverdue } from './filters';

export interface Kpis {
  total: number;
  open: number;
  overdue: number;
  completed7d: number;
  completionRate: number; // 0..100 integer
  hoursTracked: number; // one decimal
}

const dayKeyOfIso = (iso: string) => toDateKey(new Date(iso));

export function computeKpis(tasks: readonly Task[], now: Date): Kpis {
  const today = toDateKey(now);
  const weekAgo = toDateKey(addDays(now, -6));
  let open = 0;
  let overdue = 0;
  let completed7d = 0;
  let minutes = 0;
  for (const t of tasks) {
    if (t.status !== 'done') open++;
    if (isOverdue(t, today)) overdue++;
    if (t.status === 'done' && t.completedAt) {
      const k = dayKeyOfIso(t.completedAt);
      if (k >= weekAgo && k <= today) completed7d++;
    }
    minutes += t.timeSpentMinutes;
  }
  const total = tasks.length;
  return {
    total,
    open,
    overdue,
    completed7d,
    completionRate: total ? Math.round(((total - open) / total) * 100) : 0,
    hoursTracked: Math.round((minutes / 60) * 10) / 10,
  };
}

export interface DayCount {
  date: string;
  count: number;
}

export function completedPerDay(tasks: readonly Task[], now: Date, days = 30): DayCount[] {
  const counts = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) counts.set(toDateKey(addDays(now, -i)), 0);
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completedAt) continue;
    const k = dayKeyOfIso(t.completedAt);
    const c = counts.get(k);
    if (c !== undefined) counts.set(k, c + 1);
  }
  return [...counts].map(([date, count]) => ({ date, count }));
}

export function openByPriority(tasks: readonly Task[]): Record<Priority, number> {
  const out: Record<Priority, number> = { low: 0, medium: 0, high: 0, urgent: 0 };
  for (const t of tasks) if (t.status !== 'done') out[t.priority]++;
  return out;
}

export interface AssigneeCount {
  /** null = unassigned */
  member: Member | null;
  count: number;
}

/**
 * Open (not done) tasks per member, in member order, followed by an "unassigned" entry.
 * Tasks pointing at an unknown member id count as unassigned.
 */
export function openByAssignee(
  tasks: readonly Task[],
  members: readonly Member[],
): AssigneeCount[] {
  const counts = new Map<string, number>(members.map((m) => [m.id, 0]));
  let unassigned = 0;
  for (const t of tasks) {
    if (t.status === 'done') continue;
    const c = t.assigneeId === null ? undefined : counts.get(t.assigneeId);
    if (c === undefined) unassigned++;
    else counts.set(t.assigneeId!, c + 1);
  }
  return [
    ...members.map((member) => ({ member, count: counts.get(member.id) ?? 0 })),
    { member: null, count: unassigned },
  ];
}

export interface ProjectProgress {
  project: Project;
  total: number;
  done: number;
  percent: number;
}

/**
 * Completion per project. With `subtree` (project id → itself + descendants) the counts include
 * tasks of sub-projects; without it only the project's own tasks count.
 */
export function projectProgress(
  tasks: readonly Task[],
  projects: readonly Project[],
  subtree?: ReadonlyMap<string, ReadonlySet<string>>,
): ProjectProgress[] {
  const own = new Map<string, { total: number; done: number }>();
  for (const p of projects) own.set(p.id, { total: 0, done: 0 });
  for (const t of tasks) {
    if (!t.projectId) continue;
    const e = own.get(t.projectId);
    if (!e) continue;
    e.total++;
    if (t.status === 'done') e.done++;
  }
  return projects.map((project) => {
    const e = { total: 0, done: 0 };
    for (const id of subtree?.get(project.id) ?? [project.id]) {
      const o = own.get(id);
      if (o) {
        e.total += o.total;
        e.done += o.done;
      }
    }
    return { project, ...e, percent: e.total ? Math.round((e.done / e.total) * 100) : 0 };
  });
}

/** Consecutive days with ≥1 completion, ending today or (if none today) yesterday. */
export function productivityStreak(tasks: readonly Task[], now: Date): number {
  const days = new Set<string>();
  for (const t of tasks)
    if (t.status === 'done' && t.completedAt) days.add(dayKeyOfIso(t.completedAt));
  let cursor = new Date(now);
  if (!days.has(toDateKey(cursor))) {
    cursor = addDays(cursor, -1);
    if (!days.has(toDateKey(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(toDateKey(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function upcomingDeadlines(tasks: readonly Task[], now: Date, days = 7, max = 8): Task[] {
  const today = toDateKey(now);
  const end = toDateKey(addDays(now, days));
  return tasks
    .filter(
      (t) => t.status !== 'done' && t.dueDate !== null && t.dueDate >= today && t.dueDate <= end,
    )
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0))
    .slice(0, max);
}

export function overdueTasks(tasks: readonly Task[], now: Date, max = 8): Task[] {
  const today = toDateKey(now);
  return tasks
    .filter((t) => isOverdue(t, today))
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0))
    .slice(0, max);
}

export function isSameDayKey(iso: string, key: string): boolean {
  return dayKeyOfIso(iso) === key;
}
