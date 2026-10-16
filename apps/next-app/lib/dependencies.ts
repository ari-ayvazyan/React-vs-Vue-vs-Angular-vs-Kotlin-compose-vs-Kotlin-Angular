import type { Task } from './types';

export type TaskLookup = Map<string, Task>;

export function taskMap(tasks: Task[]): TaskLookup {
  return new Map(tasks.map((t) => [t.id, t]));
}

/** Blockers of `task` that still exist and are not done. */
export function openBlockers(task: Task, byId: TaskLookup): Task[] {
  const out: Task[] = [];
  for (const id of task.blockedBy) {
    const b = byId.get(id);
    if (b && b.category !== 'done') out.push(b);
  }
  return out;
}

/** True when the task is open and waits on at least one open blocker. */
export function isBlocked(task: Task, byId: TaskLookup): boolean {
  return task.category !== 'done' && task.blockedBy.some((id) => {
    const b = byId.get(id);
    return b !== undefined && b.category !== 'done';
  });
}

/**
 * The dependency chain that would close a cycle if `taskId` became blocked by `blockerId`:
 * `[blockerId, …, taskId]` where each element is blocked by the next one. null = no cycle.
 * Adding a task as its own blocker is reported as `[taskId]`.
 */
export function findCycle(byId: TaskLookup, taskId: string, blockerId: string): string[] | null {
  if (taskId === blockerId) return [taskId];
  // DFS from the blocker along "is blocked by" edges; reaching taskId means taskId ← … ← blocker ← taskId.
  const parent = new Map<string, string | null>([[blockerId, null]]);
  const stack = [blockerId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const next of byId.get(id)?.blockedBy ?? []) {
      if (parent.has(next)) continue;
      parent.set(next, id);
      if (next === taskId) {
        const path = [taskId];
        let cur: string | null | undefined = id;
        while (cur) {
          path.unshift(cur);
          cur = parent.get(cur);
        }
        return path;
      }
      stack.push(next);
    }
  }
  return null;
}

/** First cycle anywhere in the graph (for import validation), as a list of task ids, or null. */
export function graphCycle(tasks: Task[]): string[] | null {
  const byId = taskMap(tasks);
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = finished
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const next of byId.get(id)?.blockedBy ?? []) {
      const s = state.get(next);
      if (s === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (s === undefined && byId.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const t of tasks) {
    if (state.has(t.id)) continue;
    const found = visit(t.id);
    if (found) return found;
  }
  return null;
}

export interface BlockedCompletion {
  task: Task;
  blockers: Task[];
}

/** Of the tasks in `ids`, those that are not done yet and cannot be completed because of open blockers. */
export function blockedCompletions(tasks: Task[], ids: Iterable<string>): BlockedCompletion[] {
  const byId = taskMap(tasks);
  const out: BlockedCompletion[] = [];
  for (const id of ids) {
    const task = byId.get(id);
    if (!task || task.category === 'done') continue;
    const blockers = openBlockers(task, byId);
    if (blockers.length) out.push({ task, blockers });
  }
  return out;
}

const quote = (t: Task) => `“${t.title}”`;

function list(items: string[], max = 3): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
}

/** Error toast text for completions that were refused. */
export function blockedMessage(blocked: BlockedCompletion[]): string {
  if (blocked.length === 1) {
    const { task, blockers } = blocked[0];
    return `Can’t complete ${quote(task)}: blocked by ${list(blockers.map(quote))}.`;
  }
  const names = new Map<string, Task>();
  for (const b of blocked) for (const t of b.blockers) names.set(t.id, t);
  return `Can’t complete ${blocked.length} blocked tasks (${list(blocked.map((b) => quote(b.task)), 2)}): waiting on ${list([...names.values()].map(quote))}.`;
}

/** Error text for a dependency that would create a cycle; `path` comes from findCycle (each item waits on the next). */
export function cycleMessage(path: string[], byId: TaskLookup): string {
  const name = (id: string) => `“${byId.get(id)?.title ?? id}”`;
  if (path.length === 1) return 'A task cannot be blocked by itself.';
  const [blocker] = path;
  const task = path[path.length - 1];
  const chain = path.map(name).join(' → ');
  return `Can’t add ${name(blocker)}: it already waits on ${name(task)} (${chain}), so this would create a cycle.`;
}
