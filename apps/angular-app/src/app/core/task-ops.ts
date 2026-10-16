import { Status, Task } from './models';

/** Applies a status change, maintaining completedAt. */
export function withStatus(task: Task, status: Status, nowIso: string): Task {
  if (task.status === status) return task;
  return { ...task, status, completedAt: status === 'done' ? nowIso : null };
}

export function columnTasks(tasks: readonly Task[], status: Status): Task[] {
  return tasks.filter((t) => t.status === status).sort((a, b) => a.order - b.order);
}

/**
 * Moves a task to `toStatus` at position `toIndex` (index in the target column, excluding the moved task)
 * and renumbers `order` in affected columns. Returns a new array (unchanged tasks keep identity).
 */
export function moveTask(
  tasks: readonly Task[],
  id: string,
  toStatus: Status,
  toIndex: number,
  nowIso: string,
): Task[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return [...tasks];
  const fromStatus = task.status;
  const target = columnTasks(tasks, toStatus).filter((t) => t.id !== id);
  const idx = Math.max(0, Math.min(toIndex, target.length));
  const moved = withStatus(task, toStatus, nowIso);
  target.splice(idx, 0, moved);
  const updates = new Map<string, Task>();
  target.forEach((t, i) =>
    updates.set(t.id, t.order === i && t !== moved ? t : { ...t, order: i }),
  );
  if (fromStatus !== toStatus) {
    columnTasks(tasks, fromStatus)
      .filter((t) => t.id !== id)
      .forEach((t, i) => updates.set(t.id, t.order === i ? t : { ...t, order: i }));
  }
  return tasks.map((t) => updates.get(t.id) ?? t);
}

export function nextOrder(tasks: readonly Task[], status: Status): number {
  let max = -1;
  for (const t of tasks) if (t.status === status && t.order > max) max = t.order;
  return max + 1;
}

/** A board column: a whole category ("All projects") or one workflow status. */
export interface ColumnTarget {
  category: Status;
  /** Workflow status to set; omitted for category columns (the store's reconcile picks one). */
  statusId?: string;
  /** Which tasks are in the target column (for ordering). */
  inColumn: (t: Task) => boolean;
}

/**
 * Moves a task into a column at `toIndex` (index among the column's other tasks) and renumbers
 * `order` in that column. Returns a new array (unchanged tasks keep identity).
 */
export function moveTaskTo(
  tasks: readonly Task[],
  id: string,
  target: ColumnTarget,
  toIndex: number,
  nowIso: string,
): Task[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return [...tasks];
  const column = tasks
    .filter((t) => t.id !== id && target.inColumn(t))
    .sort((a, b) => a.order - b.order);
  const idx = Math.max(0, Math.min(toIndex, column.length));
  let moved = withStatus(task, target.category, nowIso);
  if (target.statusId && moved.statusId !== target.statusId)
    moved = { ...moved, statusId: target.statusId };
  column.splice(idx, 0, moved);
  const updates = new Map<string, Task>();
  column.forEach((t, i) =>
    updates.set(t.id, t.order === i && t !== moved ? t : { ...t, order: i }),
  );
  return tasks.map((t) => updates.get(t.id) ?? t);
}
