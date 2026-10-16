import { Task } from './models';

type TaskLookup = ReadonlyMap<string, Task>;

/** Blockers of `task` that exist and are not done yet. */
export function openBlockers(task: Task, tasks: TaskLookup): Task[] {
  const out: Task[] = [];
  for (const id of task.blockedBy) {
    const b = tasks.get(id);
    if (b && b.status !== 'done') out.push(b);
  }
  return out;
}

/** True when the task is not done and waits for at least one open blocker. */
export function isBlocked(task: Task, tasks: TaskLookup): boolean {
  return (
    task.status !== 'done' &&
    task.blockedBy.some((id) => {
      const b = tasks.get(id);
      return !!b && b.status !== 'done';
    })
  );
}

/** Tasks whose `blockedBy` contains `id` (the tasks this one is blocking). */
export function blockedByTask(id: string, tasks: Iterable<Task>): Task[] {
  const out: Task[] = [];
  for (const t of tasks) if (t.blockedBy.includes(id)) out.push(t);
  return out;
}

/**
 * Would making `taskId` blocked by `blockerId` create a cycle? Returns the offending path
 * `[blockerId, …, taskId]` (following `blockedBy` edges), or null when the edge is safe.
 */
export function dependencyCycle(
  taskId: string,
  blockerId: string,
  tasks: TaskLookup,
): string[] | null {
  if (taskId === blockerId) return [taskId];
  // DFS from the blocker along blockedBy; reaching taskId means taskId (transitively) blocks it.
  const prev = new Map<string, string | null>([[blockerId, null]]);
  const stack = [blockerId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const next of tasks.get(cur)?.blockedBy ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === taskId) {
        const path = [next];
        let p = prev.get(next) ?? null;
        while (p !== null) {
          path.unshift(p);
          p = prev.get(p) ?? null;
        }
        return path;
      }
      stack.push(next);
    }
  }
  return null;
}

/** True if the dependency graph (over existing tasks) contains a cycle. */
export function hasDependencyCycle(tasks: readonly Task[]): boolean {
  const map = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = finished
  const visit = (id: string): boolean => {
    const s = state.get(id);
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const next of map.get(id)?.blockedBy ?? []) if (map.has(next) && visit(next)) return true;
    state.set(id, 2);
    return false;
  };
  return tasks.some((t) => visit(t.id));
}

export interface DoneCheck {
  allowed: string[];
  /** Task ids that may not be completed, with the open blockers that prevent it. */
  rejected: { task: Task; blockers: Task[] }[];
}

/**
 * Splits `ids` (tasks about to be marked done) into allowed and rejected ones. Blockers completed
 * in the same batch count as done, so selecting a blocker and its dependant together works.
 */
export function checkCompletion(ids: Iterable<string>, tasks: TaskLookup): DoneCheck {
  const pending = new Set([...ids].filter((id) => tasks.get(id)?.status !== 'done'));
  const allowed = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const id of pending) {
      const t = tasks.get(id)!;
      if (openBlockers(t, tasks).every((b) => allowed.has(b.id))) {
        allowed.add(id);
        pending.delete(id);
        progressed = true;
      }
    }
  }
  const rejected = [...pending].map((id) => {
    const task = tasks.get(id)!;
    return { task, blockers: openBlockers(task, tasks).filter((b) => !allowed.has(b.id)) };
  });
  return { allowed: [...ids].filter((id) => !pending.has(id)), rejected };
}

/** Removes ids of tasks that no longer exist from every `blockedBy`. Keeps identity when clean. */
export function pruneBlockers(tasks: Task[]): Task[] {
  const ids = new Set(tasks.map((t) => t.id));
  let changed = false;
  const out = tasks.map((t) => {
    if (t.blockedBy.every((id) => ids.has(id))) return t;
    changed = true;
    return { ...t, blockedBy: t.blockedBy.filter((id) => ids.has(id)) };
  });
  return changed ? out : tasks;
}
