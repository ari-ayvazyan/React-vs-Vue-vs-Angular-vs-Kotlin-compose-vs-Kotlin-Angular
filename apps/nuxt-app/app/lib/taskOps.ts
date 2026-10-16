import type { Task } from './types';

/** Order value that sorts after every existing task (orders only matter within one board column). */
export function nextOrder(tasks: readonly Task[]): number {
  let max = -1;
  for (const t of tasks) if (t.order > max) max = t.order;
  return max + 1;
}

/** Tasks of a column sorted by their order (ties by id for stability). */
export function sortByOrder(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en', { numeric: true }));
}

/**
 * Put task `id` at `index` of a board column. `destIds` are the ids of the destination column in display order
 * *without* the moving task. `update` applies the column's status to the moving task. The destination column is
 * renumbered 0..n; other tasks keep their identity.
 */
export function placeInColumn(tasks: readonly Task[], id: string, destIds: readonly string[], index: number, update: (t: Task) => Task): Task[] {
  const moving = tasks.find((t) => t.id === id);
  if (!moving) return [...tasks];
  const ids = destIds.filter((x) => x !== id);
  const i = Math.max(0, Math.min(index, ids.length));
  ids.splice(i, 0, id);
  const orderOf = new Map(ids.map((x, k) => [x, k]));
  return tasks.map((t) => {
    const order = orderOf.get(t.id);
    const base = t.id === id ? update(t) : t;
    if (order === undefined || (base === t && t.order === order)) return base;
    return { ...base, order };
  });
}

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
