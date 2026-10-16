import { formatLong } from './dates';
import { decodeMentions } from './mentions';
import {
  ACTIVITY_TYPES,
  PRIORITY_LABEL,
  RECURRENCE_LABEL,
  STATUS_LABEL,
  TRACKED_FIELDS,
  type ActivityEntry,
  type ActivityType,
  type ActivityValue,
  type Member,
  type Priority,
  type Project,
  type Recurrence,
  type Status,
  type Subtask,
  type Task,
  type TrackedField,
} from './types';

/** Oldest entries are dropped beyond this, to keep localStorage bounded. */
export const ACTIVITY_LIMIT = 5000;
/** Long text values are stored truncated. */
const TEXT_LIMIT = 280;

export interface ActivityContext {
  actorId: string | null;
  at: string;
  nextId: () => string;
}

function clip(s: string): string {
  return s.length > TEXT_LIMIT ? `${s.slice(0, TEXT_LIMIT - 1)}…` : s;
}

function subtaskSummary(subtasks: Subtask[]): string[] {
  return subtasks.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title}`);
}

/** The value of a tracked field as stored in the log. */
export function fieldValue(task: Task, field: TrackedField): ActivityValue {
  switch (field) {
    case 'description':
      return clip(task.description);
    case 'subtasks':
      return subtaskSummary(task.subtasks);
    case 'tags':
    case 'blockedBy':
      return [...task[field]];
    case 'status':
      // Workflow status id (v1 logs stored the category, which equals the default status ids).
      return task.statusId;
    default:
      return task[field];
  }
}

function sameValue(a: ActivityValue, b: ActivityValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

/**
 * Entries describing every change between two task lists: creations, deletions, one entry per
 * changed tracked field, and one per added/removed comment. Unchanged tasks (same object) are skipped.
 */
export function diffActivity(before: Task[], after: Task[], ctx: ActivityContext): ActivityEntry[] {
  if (before === after) return [];
  const prev = new Map(before.map((t) => [t.id, t]));
  const entries: ActivityEntry[] = [];
  const push = (e: Omit<ActivityEntry, 'id' | 'actorId' | 'at'>) => entries.push({ id: ctx.nextId(), actorId: ctx.actorId, at: ctx.at, ...e });

  for (const t of after) {
    const old = prev.get(t.id);
    prev.delete(t.id);
    if (old === t) continue;
    if (!old) {
      push({ taskId: t.id, type: 'create', to: t.title });
      continue;
    }
    for (const field of TRACKED_FIELDS) {
      const from = fieldValue(old, field);
      const to = fieldValue(t, field);
      if (!sameValue(from, to)) push({ taskId: t.id, type: 'update', field, from, to });
    }
    if (old.comments !== t.comments) {
      const oldIds = new Set(old.comments.map((c) => c.id));
      const newIds = new Set(t.comments.map((c) => c.id));
      for (const c of t.comments) if (!oldIds.has(c.id)) push({ taskId: t.id, type: 'comment', to: clip(c.body) });
      for (const c of old.comments) if (!newIds.has(c.id)) push({ taskId: t.id, type: 'comment', from: clip(c.body), to: null });
    }
  }
  for (const t of prev.values()) push({ taskId: t.id, type: 'delete', from: t.title });
  return entries;
}

/** Appends entries, keeping at most `limit` (newest). */
export function appendActivity(log: ActivityEntry[], entries: ActivityEntry[], limit = ACTIVITY_LIMIT): ActivityEntry[] {
  if (!entries.length) return log;
  const next = [...log, ...entries];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

// ---------------------------------------------------------------------------
// Filtering (the /activity page)

/** Special actor filter value for entries without a (known) actor. */
export const NO_ACTOR = 'none';

export interface ActivityQuery {
  actor: string | null;
  type: ActivityType | null;
  page: number;
}

/** Newest first. */
export function filterActivity(log: ActivityEntry[], query: Pick<ActivityQuery, 'actor' | 'type'>): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (query.type && e.type !== query.type) continue;
    if (query.actor && (query.actor === NO_ACTOR ? e.actorId !== null : e.actorId !== query.actor)) continue;
    out.push(e);
  }
  return out;
}

/** Entries of one task, newest first. */
export function taskActivity(log: ActivityEntry[], taskId: string): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (let i = log.length - 1; i >= 0; i--) if (log[i].taskId === taskId) out.push(log[i]);
  return out;
}

// ---------------------------------------------------------------------------
// Human readable descriptions

export interface ActivityLookup {
  tasks: Map<string, Pick<Task, 'title'>>;
  projects: Map<string, Pick<Project, 'name'>>;
  members: Member[];
  /** Name of a workflow status as seen from a task (workflows are per project). */
  statusName?: (taskId: string, statusId: string) => string | undefined;
}

const FIELD_LABEL: Record<TrackedField, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  projectId: 'project',
  tags: 'tags',
  dueDate: 'due date',
  estimateMinutes: 'estimate',
  timeSpentMinutes: 'time spent',
  subtasks: 'subtasks',
  assigneeId: 'assignee',
  recurrence: 'repeat',
  blockedBy: 'blockers',
};

const q = (s: string) => `“${s}”`;

function arr(v: ActivityValue | undefined): string[] {
  return Array.isArray(v) ? v : [];
}

function added(from: ActivityValue | undefined, to: ActivityValue | undefined) {
  const a = arr(from);
  const b = arr(to);
  return { add: b.filter((x) => !a.includes(x)), remove: a.filter((x) => !b.includes(x)) };
}

function joinClauses(parts: string[]): string {
  return parts.filter(Boolean).join(' and ');
}

/** Formats one side of a change for display (null → "none"). */
function show(field: TrackedField, v: ActivityValue | undefined, lookup: ActivityLookup, taskId = ''): string {
  if (v === null || v === undefined || v === '') return 'none';
  switch (field) {
    case 'status':
      return lookup.statusName?.(taskId, String(v)) ?? STATUS_LABEL[v as Status] ?? String(v);
    case 'priority':
      return PRIORITY_LABEL[v as Priority] ?? String(v);
    case 'recurrence':
      return RECURRENCE_LABEL[v as Recurrence] ?? String(v);
    case 'projectId':
      return lookup.projects.get(String(v))?.name ?? 'a deleted project';
    case 'assigneeId':
      return lookup.members.find((m) => m.id === v)?.name ?? 'a removed member';
    case 'dueDate':
      return formatLong(String(v));
    case 'estimateMinutes':
    case 'timeSpentMinutes':
      return `${v} min`;
    default:
      return Array.isArray(v) ? v.join(', ') : String(v);
  }
}

/** A sentence fragment like `changed status from To do to Done` (the actor is rendered separately). */
export function describeEntry(e: ActivityEntry, lookup: ActivityLookup): string {
  switch (e.type) {
    case 'create':
      return 'created the task';
    case 'delete':
      return 'deleted the task';
    case 'comment':
      return e.to === null ? 'removed a comment' : 'commented';
    case 'update':
      break;
  }
  const field = e.field!;
  const { from, to } = e;
  const title = (id: string) => q(lookup.tasks.get(id)?.title ?? 'a deleted task');
  switch (field) {
    case 'blockedBy': {
      const { add, remove } = added(from, to);
      return joinClauses([
        add.length ? `added blocker${add.length > 1 ? 's' : ''} ${add.map(title).join(', ')}` : '',
        remove.length ? `removed blocker${remove.length > 1 ? 's' : ''} ${remove.map(title).join(', ')}` : '',
      ]);
    }
    case 'tags': {
      const { add, remove } = added(from, to);
      return joinClauses([
        add.length ? `added ${add.map((t) => `#${t}`).join(' ')}` : '',
        remove.length ? `removed ${remove.map((t) => `#${t}`).join(' ')}` : '',
      ]);
    }
    case 'subtasks': {
      const a = arr(from);
      const b = arr(to);
      const done = (xs: string[]) => xs.filter((x) => x.startsWith('[x]')).length;
      if (a.length === b.length) return `updated subtasks (${done(b)}/${b.length} done)`;
      return b.length > a.length ? `added a subtask (${b.length} total)` : `removed a subtask (${b.length} left)`;
    }
    case 'description':
      return to ? 'edited the description' : 'cleared the description';
    case 'title':
      return `renamed it from ${q(String(from))} to ${q(String(to))}`;
    case 'assigneeId':
      if (to === null) return `unassigned ${show(field, from, lookup)}`;
      return from === null ? `assigned it to ${show(field, to, lookup)}` : `reassigned it from ${show(field, from, lookup)} to ${show(field, to, lookup)}`;
    case 'timeSpentMinutes':
      return `logged ${Number(to) - Number(from)} min (now ${to} min)`;
    default:
      if (from === null || from === undefined || from === '') return `set ${FIELD_LABEL[field]} to ${show(field, to, lookup, e.taskId)}`;
      if (to === null || to === undefined || to === '') return `cleared ${FIELD_LABEL[field]} (was ${show(field, from, lookup, e.taskId)})`;
      return `changed ${FIELD_LABEL[field]} from ${show(field, from, lookup, e.taskId)} to ${show(field, to, lookup, e.taskId)}`;
  }
}

/** Plain-text comment body for an entry (mention tokens resolved to names). */
export function entryCommentText(e: ActivityEntry, members: Member[]): string | null {
  if (e.type !== 'comment') return null;
  const body = e.to ?? e.from;
  return typeof body === 'string' ? decodeMentions(body, members) : null;
}

/** Title for an entry's task: the live task, else the title recorded when it was created/deleted. */
export function entryTaskTitles(log: ActivityEntry[], tasks: Task[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const e of log) {
    if (e.type === 'delete' && typeof e.from === 'string') titles.set(e.taskId, e.from);
    else if (e.type === 'create' && typeof e.to === 'string' && !titles.has(e.taskId)) titles.set(e.taskId, e.to);
    else if (e.type === 'update' && e.field === 'title' && typeof e.to === 'string') titles.set(e.taskId, e.to);
  }
  for (const t of tasks) titles.set(t.id, t.title);
  return titles;
}

export const ACTIVITY_PAGE_SIZE = 50;

export function parseActivityQuery(params: { get(key: string): string | null }): ActivityQuery {
  const type = params.get('type') as ActivityType | null;
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return {
    actor: params.get('actor') || null,
    type: type && (ACTIVITY_TYPES as readonly string[]).includes(type) ? type : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function activityQueryToSearch(query: ActivityQuery): string {
  const p = new URLSearchParams();
  if (query.actor) p.set('actor', query.actor);
  if (query.type) p.set('type', query.type);
  if (query.page > 1) p.set('page', String(query.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}
