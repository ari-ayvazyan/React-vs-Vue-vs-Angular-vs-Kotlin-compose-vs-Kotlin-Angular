import type { Member, Project, Task } from './types';
import { findStatus, workflowResolver } from './workflow';

/** RFC 4180 field: quoted when it contains a comma, quote or line break; quotes doubled. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Text cells starting with = + - @ (or tab/CR) are interpreted as formulas by spreadsheet apps
 * (CSV injection); prefix them with an apostrophe. Applied to free text only, never to numbers.
 */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export const CSV_COLUMNS = [
  'id',
  'title',
  'status',
  'category',
  'priority',
  'project',
  'assignee',
  'tags',
  'due_date',
  'estimate_minutes',
  'time_spent_minutes',
  'recurrence',
  'blocked_by',
  'subtasks_done',
  'subtasks_total',
  'comments',
  'created_at',
  'completed_at',
  'description',
] as const;

/** CSV (CRLF line endings, header row) of exactly the given tasks, in the given order. */
export function tasksToCsv(tasks: Task[], projects: Project[], members: Member[]): string {
  const resolve = workflowResolver(projects);
  const statusName = (t: Task) => findStatus(resolve(t.projectId), t.statusId)?.name ?? t.statusId;
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const lines = [CSV_COLUMNS.join(',')];
  for (const t of tasks) {
    const row: (string | number | null)[] = [
      t.id,
      safeText(t.title),
      safeText(statusName(t)),
      t.category,
      t.priority,
      t.projectId ? safeText(projectName.get(t.projectId) ?? t.projectId) : '',
      t.assigneeId ? safeText(memberName.get(t.assigneeId) ?? t.assigneeId) : '',
      safeText(t.tags.join(' ')),
      t.dueDate,
      t.estimateMinutes,
      t.timeSpentMinutes,
      t.recurrence,
      t.blockedBy.join(' '),
      t.subtasks.filter((s) => s.done).length,
      t.subtasks.length,
      t.comments.length,
      t.createdAt,
      t.completedAt,
      safeText(t.description),
    ];
    lines.push(row.map(csvField).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
