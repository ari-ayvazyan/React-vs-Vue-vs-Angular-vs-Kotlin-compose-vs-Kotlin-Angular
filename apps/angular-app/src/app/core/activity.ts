import {
  ACTIVITY_LIMIT,
  ActivityEntry,
  ActivityType,
  Member,
  PRIORITY_LABELS,
  Priority,
  Project,
  RECURRENCE_LABELS,
  Recurrence,
  STATUS_LABELS,
  Status,
  Task,
} from './models';
import { formatMinutes, formatShortDate } from './dates';
import { bodyToText } from './mentions';

/** Task fields tracked in the log, in display order. `order`/`completedAt` are derived and skipped. */
export const TRACKED_FIELDS = [
  'title',
  'description',
  'statusId',
  'priority',
  'projectId',
  'assigneeId',
  'recurrence',
  'dueDate',
  'estimateMinutes',
  'timeSpentMinutes',
  'tags',
  'subtasks',
  'blockedBy',
] as const satisfies readonly (keyof Task)[];
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export const FIELD_LABELS: Record<TrackedField, string> = {
  title: 'title',
  description: 'description',
  statusId: 'status',
  priority: 'priority',
  projectId: 'project',
  assigneeId: 'assignee',
  recurrence: 'repeat',
  dueDate: 'due date',
  estimateMinutes: 'estimate',
  timeSpentMinutes: 'time spent',
  tags: 'tags',
  subtasks: 'subtasks',
  blockedBy: 'dependencies',
};

const TEXT_CAP = 280;
const cap = (s: string) => (s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP - 1)}…` : s);

/** Serialises a field value for storage in an entry (strings or null; arrays comma-joined). */
export function serializeField(
  task: Task,
  field: TrackedField,
  statusName?: (t: Task) => string,
): string | null {
  const v = task[field];
  switch (field) {
    case 'statusId':
      // stored as the status name: readable even after the workflow changes
      return statusName ? statusName(task) : task.statusId;
    case 'tags':
    case 'blockedBy':
      return (v as string[]).length ? (v as string[]).join(',') : null;
    case 'subtasks':
      return task.subtasks.length
        ? cap(task.subtasks.map((s) => `${s.done ? '☑' : '☐'} ${s.title}`).join(', '))
        : null;
    case 'description':
      return task.description ? cap(task.description) : null;
    default:
      return v === null ? null : String(v);
  }
}

function typeOf(field: TrackedField): ActivityType {
  return field === 'statusId'
    ? 'status'
    : field === 'assigneeId'
      ? 'assignee'
      : field === 'blockedBy'
        ? 'dependency'
        : 'field';
}

export interface DiffContext {
  actorId: string | null;
  at: string;
  newId: (prefix: string) => string;
  /** Name of the task's workflow status (status changes are logged by name). */
  statusName?: (t: Task) => string;
}

/**
 * Activity entries describing how `before` turned into `after`: one per created/deleted task,
 * per changed tracked field, and per added comment. Unchanged tasks (same object) are skipped.
 */
export function diffActivity(
  before: readonly Task[],
  after: readonly Task[],
  ctx: DiffContext,
): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const entry = (
    task: Task,
    type: ActivityType,
    extra: Partial<Pick<ActivityEntry, 'field' | 'from' | 'to'>> = {},
  ) =>
    out.push({
      id: ctx.newId('a'),
      taskId: task.id,
      taskTitle: task.title,
      actorId: ctx.actorId,
      type,
      ...extra,
      at: ctx.at,
    });

  const prev = new Map(before.map((t) => [t.id, t]));
  const seen = new Set<string>();
  for (const t of after) {
    seen.add(t.id);
    const old = prev.get(t.id);
    if (!old) {
      entry(t, 'created', { to: t.title });
      continue;
    }
    if (old === t) continue;
    for (const field of TRACKED_FIELDS) {
      const from = serializeField(old, field, ctx.statusName);
      const to = serializeField(t, field, ctx.statusName);
      if (from !== to) entry(t, typeOf(field), { field, from, to });
    }
    if (t.comments !== old.comments) {
      const known = new Set(old.comments.map((c) => c.id));
      for (const c of t.comments) if (!known.has(c.id)) entry(t, 'comment', { to: cap(c.body) });
    }
  }
  for (const t of before) if (!seen.has(t.id)) entry(t, 'deleted', { from: t.title });
  return out;
}

/** Appends entries, dropping the oldest beyond the limit. Keeps identity when nothing is added. */
export function appendActivity(
  log: ActivityEntry[],
  entries: ActivityEntry[],
  limit = ACTIVITY_LIMIT,
): ActivityEntry[] {
  if (!entries.length) return log;
  const next = [...log, ...entries];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

// ---------- presentation ----------

export interface DescribeContext {
  members: ReadonlyMap<string, Member>;
  projects: ReadonlyMap<string, Project>;
  tasks: ReadonlyMap<string, Task>;
}

/** Human-readable value of a serialised field. */
export function formatValue(
  field: string | undefined,
  value: string | null | undefined,
  ctx: DescribeContext,
): string {
  if (value === null || value === undefined || value === '') {
    return field === 'assigneeId' ? 'unassigned' : field === 'projectId' ? 'no project' : 'none';
  }
  switch (field) {
    case 'status': // entries logged before workflows existed hold the category
      return STATUS_LABELS[value as Status] ?? value;
    case 'priority':
      return PRIORITY_LABELS[value as Priority] ?? value;
    case 'recurrence':
      return RECURRENCE_LABELS[value as Recurrence] ?? value;
    case 'projectId':
      return ctx.projects.get(value)?.name ?? 'a deleted project';
    case 'assigneeId':
      return ctx.members.get(value)?.name ?? 'a former member';
    case 'dueDate':
      return formatShortDate(value);
    case 'estimateMinutes':
    case 'timeSpentMinutes':
      return formatMinutes(Number(value));
    case 'tags':
      return value
        .split(',')
        .map((t) => `#${t}`)
        .join(' ');
    case 'blockedBy':
      return value
        .split(',')
        .map((id) => `“${ctx.tasks.get(id)?.title ?? 'a deleted task'}”`)
        .join(', ');
    default:
      return value;
  }
}

/** Sentence fragment after the actor's name, e.g. "changed status from To do to Done". */
export function describeActivity(e: ActivityEntry, ctx: DescribeContext): string {
  switch (e.type) {
    case 'created':
      return 'created the task';
    case 'deleted':
      return 'deleted the task';
    case 'comment':
      return `commented: “${bodyToText(e.to ?? '', ctx.members)}”`;
    case 'dependency': {
      const from = new Set((e.from ?? '').split(',').filter(Boolean));
      const to = new Set((e.to ?? '').split(',').filter(Boolean));
      const added = [...to].filter((id) => !from.has(id));
      const removed = [...from].filter((id) => !to.has(id));
      const parts: string[] = [];
      if (added.length)
        parts.push(`added blocker ${formatValue('blockedBy', added.join(','), ctx)}`);
      if (removed.length)
        parts.push(`removed blocker ${formatValue('blockedBy', removed.join(','), ctx)}`);
      return parts.join(' and ') || 'changed dependencies';
    }
    default: {
      const field = e.field ?? '';
      const label = FIELD_LABELS[field as TrackedField] ?? field;
      if (field === 'description' || field === 'subtasks')
        return e.to ? `updated the ${label}` : `cleared the ${label}`;
      return `changed ${label} from ${formatValue(field, e.from, ctx)} to ${formatValue(field, e.to, ctx)}`;
    }
  }
}

// ---------- querying (/activity page) ----------

export interface ActivityQuery {
  actor: string; // '' = anyone, 'none' = no actor, else member id
  type: ActivityType | '';
  page: number;
}

/** Newest first, filtered by actor and type. */
export function queryActivity(
  log: readonly ActivityEntry[],
  q: Omit<ActivityQuery, 'page'>,
): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (q.type && e.type !== q.type) continue;
    if (q.actor && (q.actor === 'none' ? e.actorId !== null : e.actorId !== q.actor)) continue;
    out.push(e);
  }
  return out;
}
