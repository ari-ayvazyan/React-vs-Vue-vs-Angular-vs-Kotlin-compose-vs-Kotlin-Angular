import { Recurrence, Task } from './models';
import { addDays, parseDateKey, toDateKey } from './dates';
import { nextOrder } from './task-ops';

/** Adds whole months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonthsClamped(d: Date, months: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
}

/** The due date of the next occurrence: one interval after `from` (a YYYY-MM-DD key). */
export function advanceDueDate(from: string, recurrence: Exclude<Recurrence, 'none'>): string {
  const d = parseDateKey(from);
  switch (recurrence) {
    case 'daily':
      return toDateKey(addDays(d, 1));
    case 'weekly':
      return toDateKey(addDays(d, 7));
    case 'monthly':
      return toDateKey(addMonthsClamped(d, 1));
  }
}

export interface RecurrenceContext {
  today: string;
  nowIso: string;
  newId: (prefix: string) => string;
  /** First "to do" status of the task's workflow (defaults to the default workflow's `todo`). */
  todoStatusId?: (task: Task) => string;
}

/** Builds the next occurrence of a recurring task that was just completed. */
export function nextOccurrence(task: Task, order: number, ctx: RecurrenceContext): Task | null {
  if (task.recurrence === 'none') return null;
  return {
    ...task,
    id: ctx.newId('t'),
    status: 'todo',
    statusId: ctx.todoStatusId?.(task) ?? 'todo',
    dueDate: advanceDueDate(task.dueDate ?? ctx.today, task.recurrence),
    timeSpentMinutes: 0,
    subtasks: task.subtasks.map((s) => ({ ...s, id: ctx.newId('s'), done: false })),
    comments: [],
    blockedBy: [...task.blockedBy],
    tags: [...task.tags],
    createdAt: ctx.nowIso,
    completedAt: null,
    order,
  };
}

/**
 * Compares a task list before and after a mutation. For every recurring task that went from
 * not-done to done, prepends its next occurrence (status `todo`, appended to the To-do column).
 * Returns `after` unchanged (same identity) when nothing recurs.
 */
export function spawnRecurrences(
  before: readonly Task[],
  after: Task[],
  ctx: RecurrenceContext,
): { tasks: Task[]; spawned: Task[] } {
  const prev = new Map(before.map((t) => [t.id, t]));
  const spawned: Task[] = [];
  let order = -1;
  for (const t of after) {
    if (t.status !== 'done' || t.recurrence === 'none') continue;
    const old = prev.get(t.id);
    if (!old || old.status === 'done') continue;
    if (order < 0) order = nextOrder(after, 'todo');
    const copy = nextOccurrence(t, order++, ctx);
    if (copy) spawned.push(copy);
  }
  return spawned.length ? { tasks: [...spawned, ...after], spawned } : { tasks: after, spawned };
}
