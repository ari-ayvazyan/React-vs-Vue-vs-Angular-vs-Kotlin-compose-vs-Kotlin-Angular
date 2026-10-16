import type { StatusCategory, Task } from '../lib/types';
import type { Data } from '../lib/reducer';

let n = 0;
/**
 * Builds a task with sensible defaults; ids are unique per test run. `status` is a shorthand for
 * a default-workflow status (sets both `statusId` and `category`).
 */
export function task({ status, ...p }: Partial<Task> & { status?: StatusCategory } = {}): Task {
  n++;
  const s = status ?? p.category ?? 'todo';
  return {
    id: `x${n}`,
    title: `Task ${n}`,
    description: '',
    statusId: s,
    category: s,
    priority: 'medium',
    projectId: null,
    tags: [],
    dueDate: null,
    estimateMinutes: null,
    timeSpentMinutes: 0,
    subtasks: [],
    createdAt: new Date(2026, 9, 1).toISOString(),
    completedAt: null,
    order: 0,
    assigneeId: null,
    recurrence: 'none',
    blockedBy: [],
    comments: [],
    ...p,
  };
}

/** An undoable-state object with every collection empty; override what a test needs. */
export function emptyData(p: Partial<Data> = {}): Data {
  return { tasks: [], projects: [], members: [], activity: [], views: [], ...p };
}
