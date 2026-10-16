import { Member, PRIORITY_LABELS, Project, RECURRENCE_LABELS, STATUS_LABELS, Task } from './models';

/**
 * One CSV cell (RFC 4180): quoted when it contains a comma, quote or line break. Cells that a
 * spreadsheet would run as a formula (=, +, -, @, tab, CR at the start) are prefixed with `'`.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const TASK_CSV_HEADER = [
  'ID',
  'Title',
  'Status',
  'Status category',
  'Priority',
  'Project',
  'Assignee',
  'Tags',
  'Due date',
  'Estimate (min)',
  'Time spent (min)',
  'Subtasks done',
  'Subtasks total',
  'Blocked by',
  'Repeats',
  'Created',
  'Completed',
  'Description',
];

export interface CsvContext {
  projects: ReadonlyMap<string, Project>;
  /** Workflow status name of a task (defaults to the category label). */
  statusName?: (t: Task) => string;
  /** Project label, e.g. its path "Parent / Child" (defaults to the name). */
  projectName?: (id: string) => string;
  members: ReadonlyMap<string, Member>;
  tasks: ReadonlyMap<string, Task>;
}

/** The given tasks, in the given order, as CSV (header row first). */
export function tasksToCsv(tasks: readonly Task[], ctx: CsvContext): string {
  const rows = tasks.map((t) => [
    t.id,
    t.title,
    ctx.statusName?.(t) ?? STATUS_LABELS[t.status],
    STATUS_LABELS[t.status],
    PRIORITY_LABELS[t.priority],
    t.projectId
      ? (ctx.projectName?.(t.projectId) ?? ctx.projects.get(t.projectId)?.name ?? '')
      : '',
    t.assigneeId ? (ctx.members.get(t.assigneeId)?.name ?? '') : '',
    t.tags.join(' '),
    t.dueDate,
    t.estimateMinutes,
    t.timeSpentMinutes,
    t.subtasks.filter((s) => s.done).length,
    t.subtasks.length,
    t.blockedBy.map((id) => ctx.tasks.get(id)?.title ?? id).join('; '),
    t.recurrence === 'none' ? '' : RECURRENCE_LABELS[t.recurrence],
    t.createdAt,
    t.completedAt,
    t.description,
  ]);
  return toCsv([TASK_CSV_HEADER, ...rows]);
}
