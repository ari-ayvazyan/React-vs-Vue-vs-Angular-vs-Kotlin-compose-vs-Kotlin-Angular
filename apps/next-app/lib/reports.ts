import { addDays, isoToDateKey } from './dates';
import { NO_PROJECT } from './filters';
import { PRIORITIES, type Member, type Priority, type Project, type Task } from './types';
import { descendantIds } from './workflow';

export interface DayValue {
  date: string;
  value: number;
}

/** Project filter: null = all projects, NO_PROJECT = tasks without a project, otherwise a project and its sub-projects. */
function projectMatcher(project: string | null, projects: Project[]): (t: Task) => boolean {
  if (project === null) return () => true;
  if (project === NO_PROJECT) return (t) => t.projectId === null;
  const scope = descendantIds(projects, project);
  return (t) => t.projectId !== null && scope.has(t.projectId);
}

/**
 * Open tasks at the end of each of the last `days` days (oldest first). A task counts as open on
 * day D if it was created on or before D and was not completed by the end of D. History is
 * reconstructed from createdAt/completedAt, so reopen/complete cycles before the last completion
 * are not visible (the app stores only the latest completion time).
 */
export function burndown(tasks: Task[], project: string | null, today: string, days = 30, projects: Project[] = []): DayValue[] {
  const inProject = projectMatcher(project, projects);
  const start = addDays(today, -(days - 1));
  // Difference array over the window: +1 from the creation day, -1 from the completion day.
  const delta = new Array<number>(days + 1).fill(0);
  const index = (key: string) => Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  for (const t of tasks) {
    if (!inProject(t)) continue;
    const created = isoToDateKey(t.createdAt);
    if (created > today) continue;
    const from = Math.max(0, index(created));
    let to = days; // exclusive end index
    if (t.category === 'done' && t.completedAt) {
      const done = isoToDateKey(t.completedAt);
      if (done < start) continue;
      to = Math.min(days, index(done));
    }
    if (to <= from) continue;
    delta[from]++;
    delta[to]--;
  }
  const out: DayValue[] = [];
  let running = 0;
  for (let i = 0; i < days; i++) {
    running += delta[i];
    out.push({ date: addDays(start, i), value: running });
  }
  return out;
}

export interface WorkloadRow {
  /** null = unassigned */
  member: Member | null;
  /** sum of estimates of open tasks, in hours (1 decimal) */
  hours: number;
  open: number;
  /** open tasks without an estimate (not included in hours) */
  unestimated: number;
}

/** Estimated open work per member, heaviest first; an "unassigned" row last when it has open tasks. */
export function workload(tasks: Task[], members: Member[]): WorkloadRow[] {
  const acc = new Map<string | null, { minutes: number; open: number; unestimated: number }>();
  const known = new Set(members.map((m) => m.id));
  for (const m of members) acc.set(m.id, { minutes: 0, open: 0, unestimated: 0 });
  for (const t of tasks) {
    if (t.category === 'done') continue;
    const key = t.assigneeId && known.has(t.assigneeId) ? t.assigneeId : null;
    const a = acc.get(key) ?? { minutes: 0, open: 0, unestimated: 0 };
    a.open++;
    if (t.estimateMinutes) a.minutes += t.estimateMinutes;
    else a.unestimated++;
    acc.set(key, a);
  }
  const hours = (min: number) => Math.round((min / 60) * 10) / 10;
  const rows: WorkloadRow[] = members
    .map((member) => {
      const a = acc.get(member.id)!;
      return { member, hours: hours(a.minutes), open: a.open, unestimated: a.unestimated };
    })
    .sort((x, y) => y.hours - x.hours);
  const none = acc.get(null);
  if (none && none.open) rows.push({ member: null, hours: hours(none.minutes), open: none.open, unestimated: none.unestimated });
  return rows;
}

export interface CycleTimeRow {
  priority: Priority;
  /** average days from creation to completion (1 decimal); null when nothing was completed */
  avgDays: number | null;
  count: number;
}

/** Average cycle time (createdAt → completedAt, in days) of completed tasks per priority, urgent first. */
export function cycleTimeByPriority(tasks: Task[]): CycleTimeRow[] {
  const sum = new Map<Priority, { ms: number; n: number }>(PRIORITIES.map((p) => [p, { ms: 0, n: 0 }]));
  for (const t of tasks) {
    if (t.category !== 'done' || !t.completedAt) continue;
    const ms = Date.parse(t.completedAt) - Date.parse(t.createdAt);
    if (!Number.isFinite(ms) || ms < 0) continue;
    const s = sum.get(t.priority)!;
    s.ms += ms;
    s.n++;
  }
  return [...PRIORITIES].reverse().map((priority) => {
    const { ms, n } = sum.get(priority)!;
    return { priority, count: n, avgDays: n ? Math.round((ms / n / 86_400_000) * 10) / 10 : null };
  });
}
