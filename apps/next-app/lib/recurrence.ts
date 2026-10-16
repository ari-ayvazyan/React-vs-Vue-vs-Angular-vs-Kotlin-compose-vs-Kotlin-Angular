import { addDays, addMonths, formatShort, isoToDateKey } from './dates';
import type { Project, Recurrence, Task, WorkflowStatus } from './types';
import { DEFAULT_WORKFLOW, statusForCategory, workflowResolver } from './workflow';

/** The due date of the next occurrence, counted from `from` ('YYYY-MM-DD'). */
export function advanceDueDate(from: string, recurrence: Exclude<Recurrence, 'none'>): string {
  switch (recurrence) {
    case 'daily':
      return addDays(from, 1);
    case 'weekly':
      return addDays(from, 7);
    case 'monthly':
      return addMonths(from, 1);
  }
}

/** Due date the next occurrence of `task` would get if it were completed on `today`. */
export function nextDueDate(task: Pick<Task, 'dueDate' | 'recurrence'>, today: string): string | null {
  if (task.recurrence === 'none') return null;
  return advanceDueDate(task.dueDate ?? today, task.recurrence);
}

/** `t12` → `t12-r1`; `t12-r1` → `t12-r2` (or the next free number). */
function occurrenceId(sourceId: string, taken: Set<string>): string {
  const base = sourceId.replace(/-r\d+$/, '');
  let n = 1;
  for (const id of taken) {
    const m = id.startsWith(`${base}-r`) ? /^-r(\d+)$/.exec(id.slice(base.length)) : null;
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  return `${base}-r${n}`;
}

/**
 * Builds the next occurrence of a recurring task that was just completed at `at` (ISO).
 * The copy is a fresh `todo` task: due date advanced by the interval (from the old due date, or
 * from the completion day if there was none), subtasks unchecked, no time tracked, no blockers or
 * comments, and appended to the end of the To do column.
 */
export function nextOccurrence(task: Task, at: string, tasks: Task[], workflow: readonly WorkflowStatus[] = DEFAULT_WORKFLOW): Task | null {
  if (task.recurrence === 'none') return null;
  let maxTodo = -1;
  const ids = new Set<string>();
  for (const t of tasks) {
    ids.add(t.id);
    if (t.category === 'todo' && t.order > maxTodo) maxTodo = t.order;
  }
  return {
    ...task,
    id: occurrenceId(task.id, ids),
    // the first "to do" status of the task's workflow
    statusId: statusForCategory(workflow, 'todo'),
    category: 'todo',
    dueDate: nextDueDate(task, isoToDateKey(at)),
    timeSpentMinutes: 0,
    subtasks: task.subtasks.map((s) => ({ ...s, done: false })),
    tags: [...task.tags],
    // A new occurrence starts with a clean slate: no blockers, no discussion.
    blockedBy: [],
    comments: [],
    createdAt: at,
    completedAt: null,
    order: maxTodo + 1,
  };
}

/**
 * After a mutation, appends the next occurrence for every task in `ids` that went from
 * a not-done category (in `before`) to the done category (in `after`) and repeats. Returns `after` unchanged if none did.
 */
export function spawnRecurrences(before: Task[], after: Task[], ids: Iterable<string>, at: string, projects: Project[] = []): Task[] {
  const wanted = new Set(ids);
  if (!wanted.size) return after;
  const prevCategory = new Map<string, Task['category']>();
  for (const t of before) if (wanted.has(t.id)) prevCategory.set(t.id, t.category);
  const resolve = workflowResolver(projects);
  let out = after;
  for (const t of after) {
    if (!wanted.has(t.id) || t.category !== 'done' || t.recurrence === 'none') continue;
    const prev = prevCategory.get(t.id);
    if (prev === undefined || prev === 'done') continue;
    const copy = nextOccurrence(t, at, out, resolve(t.projectId))!;
    out = [...out, copy];
  }
  return out;
}

/** Toast text for completing `task` at `at` (ISO); mentions when the next occurrence is due. */
export function completionMessage(task: Pick<Task, 'title' | 'dueDate' | 'recurrence'>, at: string): string {
  const next = nextDueDate(task, isoToDateKey(at));
  return next ? `Completed “${task.title}” · next one due ${formatShort(next)}` : `Completed “${task.title}”`;
}
