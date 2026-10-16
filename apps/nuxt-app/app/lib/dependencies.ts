import type { Task } from './types';

type ById = ReadonlyMap<string, Task>;

/**
 * Blockers of `task` that are still open. Ids that no longer exist are ignored, and so are tasks in
 * `completing` (tasks being completed in the same operation count as done).
 */
export function openBlockers(task: Pick<Task, 'blockedBy'>, byId: ById, completing: ReadonlySet<string> = new Set()): Task[] {
  const out: Task[] = [];
  for (const id of task.blockedBy) {
    const b = byId.get(id);
    if (b && b.status !== 'done' && !completing.has(id)) out.push(b);
  }
  return out;
}

/** Ids of all tasks that currently have at least one open blocker. */
export function blockedTaskIds(tasks: readonly Task[]): Set<string> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Set<string>();
  for (const t of tasks) if (t.blockedBy.length && openBlockers(t, byId).length) out.add(t.id);
  return out;
}

export interface BlockedCompletion {
  task: Task;
  blockers: Task[];
}

/**
 * Split the tasks requested to be completed into those that may be completed and those that are blocked.
 * Tasks completed together may unblock each other; removing a blocked task can block others, so this
 * iterates until stable.
 */
export function partitionCompletable(tasks: readonly Task[], ids: readonly string[]): { allowed: string[]; blocked: BlockedCompletion[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const completing = new Set(ids.filter((id) => byId.get(id) && byId.get(id)?.status !== 'done'));
  const blocked = new Map<string, BlockedCompletion>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of completing) {
      const task = byId.get(id) as Task;
      const blockers = openBlockers(task, byId, completing);
      if (blockers.length) {
        completing.delete(id);
        blocked.set(id, { task, blockers });
        changed = true;
      }
    }
  }
  // Recompute blockers against the final set so messages name everything that is still open.
  for (const [id, b] of blocked) blocked.set(id, { task: b.task, blockers: openBlockers(b.task, byId, completing) });
  return { allowed: ids.filter((id) => completing.has(id)), blocked: [...blocked.values()] };
}

/** True when `taskId` is (transitively) a blocker of `start`. */
function reaches(byId: ById, start: string, taskId: string): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop() as string;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = byId.get(id);
    if (t) stack.push(...t.blockedBy);
  }
  return false;
}

/**
 * Validate adding `blockerId` as a blocker of `taskId`. Returns an error message, or '' when allowed.
 * A dependency is rejected when it is a self-reference, a duplicate, or would close a cycle
 * (the blocker already depends, directly or transitively, on the task).
 */
export function validateDependency(tasks: readonly Task[], taskId: string, blockerId: string): string {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const task = byId.get(taskId);
  const blocker = byId.get(blockerId);
  if (!task || !blocker) return 'That task no longer exists.';
  if (taskId === blockerId) return 'A task cannot block itself.';
  if (task.blockedBy.includes(blockerId)) return `“${blocker.title}” already blocks this task.`;
  if (reaches(byId, blockerId, taskId)) return `“${blocker.title}” cannot block this task: it already depends on it (directly or through other tasks), which would create a cycle.`;
  return '';
}

/** True when the dependency graph described by `blockedBy` has a cycle (used by import validation). */
export function hasDependencyCycle(tasks: readonly Pick<Task, 'id' | 'blockedBy'>[]): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
  const visit = (id: string): boolean => {
    const s = state.get(id);
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const next of byId.get(id)?.blockedBy ?? []) if (byId.has(next) && visit(next)) return true;
    state.set(id, 2);
    return false;
  };
  return tasks.some((t) => visit(t.id));
}

/** Remove references to deleted tasks from every remaining task's `blockedBy` (untouched tasks keep identity). */
export function removeDependencyRefs(tasks: readonly Task[], deletedIds: ReadonlySet<string>): Task[] {
  return tasks.map((t) => (t.blockedBy.some((id) => deletedIds.has(id)) ? { ...t, blockedBy: t.blockedBy.filter((id) => !deletedIds.has(id)) } : t));
}

/** Human-readable error for blocked completions, naming the blockers. */
export function blockedMessage(blocked: readonly BlockedCompletion[]): string {
  const names = (ts: readonly Task[]): string => {
    const shown = ts.slice(0, 3).map((t) => `“${t.title}”`);
    return ts.length > 3 ? `${shown.join(', ')} and ${ts.length - 3} more` : shown.join(', ');
  };
  if (blocked.length === 1) {
    const b = blocked[0] as BlockedCompletion;
    return `Can’t complete “${b.task.title}”: blocked by ${names(b.blockers)}.`;
  }
  const allBlockers = [...new Map(blocked.flatMap((b) => b.blockers).map((t) => [t.id, t])).values()];
  return `${blocked.length} tasks can’t be completed yet: blocked by ${names(allBlockers)}.`;
}
