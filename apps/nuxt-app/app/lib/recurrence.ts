import type { Recurrence, Task } from './types';
import { addDaysISO, addMonthsISO } from './dates';
import { nextOrder } from './taskOps';

/** Advance a 'YYYY-MM-DD' date by one recurrence interval. */
export function advanceDate(iso: string, recurrence: Exclude<Recurrence, 'none'>): string {
  switch (recurrence) {
    case 'daily':
      return addDaysISO(iso, 1);
    case 'weekly':
      return addDaysISO(iso, 7);
    case 'monthly':
      return addMonthsISO(iso, 1);
  }
}

export interface RecurrenceContext {
  nowISO: string;
  /** local 'YYYY-MM-DD'; base date for tasks without a due date */
  today: string;
  /** id generator (injectable for tests) */
  makeId: (prefix: string) => string;
  /** first "To do" status of the task's workflow (default: the default workflow's `todo`) */
  todoStatusId?: (task: Task) => string;
}

/** Next occurrence of a recurring task: fresh `todo` copy with an advanced due date, reset progress and no comments. */
export function nextOccurrence(task: Task, ctx: RecurrenceContext, order: number): Task {
  if (task.recurrence === 'none') throw new Error('nextOccurrence() needs a recurring task');
  return {
    ...task,
    id: ctx.makeId('t'),
    statusId: ctx.todoStatusId ? ctx.todoStatusId(task) : 'todo',
    status: 'todo',
    dueDate: advanceDate(task.dueDate ?? ctx.today, task.recurrence),
    timeSpentMinutes: 0,
    subtasks: task.subtasks.map((s) => ({ ...s, id: ctx.makeId('s'), done: false })),
    tags: [...task.tags],
    // blockers carry over (they are all done, otherwise the original could not be completed); the
    // discussion belongs to the completed occurrence
    blockedBy: [...task.blockedBy],
    comments: [],
    createdAt: ctx.nowISO,
    completedAt: null,
    order,
  };
}

/**
 * Given the task list before and after a mutation, append the next occurrence of every recurring
 * task that was *transitioned* to done by that mutation. Returns `next` unchanged when nothing recurs.
 * Running this inside the same store commit is what makes a single undo revert both the completion
 * and the spawned copy.
 */
export function spawnRecurrences(prev: readonly Task[], next: Task[], ctx: RecurrenceContext): Task[] {
  const prevStatus = new Map(prev.map((t) => [t.id, t.status]));
  const completed = next.filter((t) => t.recurrence !== 'none' && t.status === 'done' && prevStatus.has(t.id) && prevStatus.get(t.id) !== 'done');
  if (completed.length === 0) return next;
  let order = nextOrder(next);
  return [...next, ...completed.map((t) => nextOccurrence(t, ctx, order++))];
}
