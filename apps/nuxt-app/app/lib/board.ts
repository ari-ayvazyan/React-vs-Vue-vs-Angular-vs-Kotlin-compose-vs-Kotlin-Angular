import type { StatusCategory, Task, WorkflowStatus } from './types';
import { STATUSES } from './types';
import type { WorkflowResolver } from './workflows';
import { CATEGORY_LABELS, DEFAULT_WORKFLOW } from './workflows';
import { sortByOrder } from './taskOps';

/**
 * Board columns. For a single project the board shows that project's workflow statuses ("workflow" mode);
 * otherwise (all projects / no project) it shows the three categories ("category" mode), as before workflows.
 */
export type BoardMode = 'workflow' | 'category';

export interface BoardColumn {
  /** status id (workflow mode) or category (category mode); also used in data-testid="board-column-<key>" */
  key: string;
  name: string;
  color: string;
  category: StatusCategory;
}

export function boardColumns(projectId: string | null, wf: WorkflowResolver): { mode: BoardMode; columns: BoardColumn[] } {
  if (projectId) return { mode: 'workflow', columns: wf.workflowOf(projectId).map((s) => ({ key: s.id, name: s.name, color: s.color, category: s.category })) };
  const defaults = new Map(DEFAULT_WORKFLOW.map((s) => [s.category, s]));
  return {
    mode: 'category',
    columns: STATUSES.map((c) => ({ key: c, name: CATEGORY_LABELS[c], color: defaults.get(c)?.color ?? '#64748b', category: c })),
  };
}

/**
 * Column a task appears in: its own status when the board shows it, otherwise the first column of the task's
 * category (a sub-project with a customised workflow shown on its parent's board).
 */
export function columnKeyOf(task: Task, mode: BoardMode, columns: readonly BoardColumn[]): string {
  if (mode === 'category') return task.status;
  if (columns.some((c) => c.key === task.statusId)) return task.statusId;
  return (columns.find((c) => c.category === task.status) ?? (columns[0] as BoardColumn)).key;
}

/** Tasks per column key, each column sorted by order. */
export function groupByColumn(tasks: readonly Task[], mode: BoardMode, columns: readonly BoardColumn[]): Record<string, Task[]> {
  const out: Record<string, Task[]> = Object.fromEntries(columns.map((c) => [c.key, [] as Task[]]));
  for (const t of tasks) out[columnKeyOf(t, mode, columns)]?.push(t);
  for (const k of Object.keys(out)) out[k] = sortByOrder(out[k] as Task[]);
  return out;
}

/**
 * The status a task gets when dropped in a column: the column's status if it exists in the task's own workflow,
 * else the first status of the column's category in the task's workflow. A task dropped into the category it is
 * already in keeps its status.
 */
export function statusForColumn(task: Task, column: BoardColumn, mode: BoardMode, wf: WorkflowResolver): WorkflowStatus {
  if (mode === 'workflow') {
    const own = wf.statusOf(task.projectId, column.key);
    if (own) return own;
  } else if (task.status === column.category) {
    const current = wf.statusOf(task.projectId, task.statusId);
    if (current) return current;
  }
  return wf.firstOfCategory(task.projectId, column.category);
}
