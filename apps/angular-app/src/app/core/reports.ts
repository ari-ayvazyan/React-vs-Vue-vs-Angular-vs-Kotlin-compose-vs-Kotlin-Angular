import { Member, PRIORITIES, Priority, Task } from './models';
import { addDays, toDateKey } from './dates';
import { DayCount } from './stats';
import { matchesProject } from './filters';

const DAY_MS = 86_400_000;
const dayOf = (iso: string) => toDateKey(new Date(iso));

export { matchesProject as inProject } from './filters';

/**
 * Burndown: number of open tasks at the end of each of the last `days` days. A task counts as
 * open on day D if it was created on or before D and not completed on or before D. This is
 * reconstructed from the current tasks (created/completed dates), so deleted tasks are not counted.
 */
export function burndown(
  tasks: readonly Task[],
  project: string,
  now: Date,
  days = 30,
  /** Project id → itself + descendants, so a project's burndown includes its sub-projects. */
  subtree?: ReadonlyMap<string, ReadonlySet<string>>,
): DayCount[] {
  const keys = Array.from({ length: days }, (_, i) => toDateKey(addDays(now, i - days + 1)));
  const spans: [string, string | null][] = [];
  for (const t of tasks) {
    if (!matchesProject(t, project, subtree)) continue;
    spans.push([
      dayOf(t.createdAt),
      t.status === 'done' && t.completedAt ? dayOf(t.completedAt) : null,
    ]);
  }
  return keys.map((date) => ({
    date,
    count: spans.filter(([c, d]) => c <= date && (d === null || d > date)).length,
  }));
}

export interface Workload {
  /** null = unassigned */
  member: Member | null;
  /** Sum of estimates of open tasks, in minutes. */
  minutes: number;
  openTasks: number;
  /** Open tasks without an estimate (not included in `minutes`). */
  unestimated: number;
}

/** Workload of open tasks per member (member order), followed by an "unassigned" entry. */
export function workloadByAssignee(tasks: readonly Task[], members: readonly Member[]): Workload[] {
  const rows = new Map<string | null, Workload>();
  for (const m of members) rows.set(m.id, { member: m, minutes: 0, openTasks: 0, unestimated: 0 });
  rows.set(null, { member: null, minutes: 0, openTasks: 0, unestimated: 0 });
  for (const t of tasks) {
    if (t.status === 'done') continue;
    const row = rows.get(t.assigneeId) ?? rows.get(null)!;
    row.openTasks++;
    if (t.estimateMinutes === null) row.unestimated++;
    else row.minutes += t.estimateMinutes;
  }
  return [...rows.values()];
}

export interface CycleTime {
  priority: Priority;
  /** Average days from creation to completion; null when nothing was completed. */
  avgDays: number | null;
  count: number;
}

/** Average cycle time (createdAt → completedAt) of completed tasks, per priority (low → urgent). */
export function cycleTimeByPriority(tasks: readonly Task[]): CycleTime[] {
  const acc = new Map<Priority, { sum: number; n: number }>(
    PRIORITIES.map((p) => [p, { sum: 0, n: 0 }]),
  );
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completedAt) continue;
    const ms = Date.parse(t.completedAt) - Date.parse(t.createdAt);
    if (!Number.isFinite(ms)) continue;
    const a = acc.get(t.priority)!;
    a.sum += Math.max(0, ms) / DAY_MS;
    a.n++;
  }
  return PRIORITIES.map((priority) => {
    const { sum, n } = acc.get(priority)!;
    return { priority, count: n, avgDays: n ? Math.round((sum / n) * 10) / 10 : null };
  });
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
