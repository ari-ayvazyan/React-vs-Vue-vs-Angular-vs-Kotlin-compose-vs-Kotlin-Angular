import type { Member, Project, Task } from './types';
import { PRIORITY_LABELS, RECURRENCE_LABELS, STATUS_LABELS } from './types';

export type CsvCell = string | number | null;

/**
 * One CSV field (RFC 4180): quoted when it contains a delimiter, quote or line break. Text that a spreadsheet
 * would evaluate as a formula (leading =, +, -, @, tab or CR) is prefixed with an apostrophe.
 */
export function csvField(v: CsvCell, opts: { text?: boolean } = {}): string {
  if (v === null) return '';
  let s = String(v);
  if (opts.text !== false && typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text with CRLF line endings. */
export function toCsv(header: readonly string[], rows: readonly CsvCell[][]): string {
  return [header.map((h) => csvField(h)), ...rows.map((r) => r.map((c) => csvField(c)))].map((r) => r.join(',')).join('\r\n') + '\r\n';
}

export interface CsvLookups {
  projects: ReadonlyMap<string, Project>;
  members: ReadonlyMap<string, Member>;
  tasks: ReadonlyMap<string, Task>;
  /** workflow status name of a task (defaults to the category label) */
  statusName?: (t: Task) => string;
}

export const TASK_CSV_HEADER = [
  'ID',
  'Title',
  'Status',
  'Category',
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
  'Repeat',
  'Created',
  'Completed',
  'Description',
] as const;

/** Tasks as CSV, in the given order (the caller passes the filtered + sorted list). */
export function tasksToCsv(tasks: readonly Task[], l: CsvLookups): string {
  const rows = tasks.map((t): CsvCell[] => [
    t.id,
    t.title,
    l.statusName?.(t) ?? STATUS_LABELS[t.status],
    STATUS_LABELS[t.status],
    PRIORITY_LABELS[t.priority],
    t.projectId ? (l.projects.get(t.projectId)?.name ?? '') : '',
    t.assigneeId ? (l.members.get(t.assigneeId)?.name ?? '') : '',
    t.tags.join(' '),
    t.dueDate,
    t.estimateMinutes,
    t.timeSpentMinutes,
    t.subtasks.filter((s) => s.done).length,
    t.subtasks.length,
    t.blockedBy.map((id) => l.tasks.get(id)?.title ?? id).join('; '),
    t.recurrence === 'none' ? '' : RECURRENCE_LABELS[t.recurrence],
    t.createdAt,
    t.completedAt,
    t.description,
  ]);
  return toCsv(TASK_CSV_HEADER, rows);
}
