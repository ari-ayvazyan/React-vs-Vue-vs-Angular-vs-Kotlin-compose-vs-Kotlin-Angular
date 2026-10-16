import type { ActivityEntry, ActivityType, ActivityValue, LoggedField, Member, Priority, Project, Recurrence, Status, Task } from './types';
import { PRIORITY_LABELS, RECURRENCE_LABELS, STATUS_LABELS } from './types';
import { formatDate, formatMinutes } from './dates';

/** Oldest entries are dropped beyond this many, so the log cannot exhaust localStorage. */
export const ACTIVITY_LIMIT = 5000;
/** Long text values (descriptions, comment bodies) are truncated to this many characters in the log. */
export const ACTIVITY_TEXT_LIMIT = 500;

export const ACTIVITY_TYPES: readonly ActivityType[] = ['created', 'deleted', 'status', 'assignee', 'dependencies', 'comment', 'updated'];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  created: 'Created',
  deleted: 'Deleted',
  status: 'Status',
  assignee: 'Assignee',
  dependencies: 'Dependencies',
  comment: 'Comments',
  updated: 'Other edits',
};

export const LOGGED_FIELDS: readonly LoggedField[] = [
  'title',
  'description',
  'status',
  'priority',
  'projectId',
  'tags',
  'dueDate',
  'estimateMinutes',
  'assigneeId',
  'recurrence',
  'blockedBy',
  'subtasks',
  'comments',
];

export const FIELD_LABELS: Record<LoggedField, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  projectId: 'project',
  tags: 'tags',
  dueDate: 'due date',
  estimateMinutes: 'estimate',
  assigneeId: 'assignee',
  recurrence: 'repeat',
  blockedBy: 'blockers',
  subtasks: 'subtasks',
  comments: 'comments',
};

const TYPE_OF_FIELD: Partial<Record<LoggedField, ActivityType>> = {
  status: 'status',
  assigneeId: 'assignee',
  blockedBy: 'dependencies',
  comments: 'comment',
};

export interface ActivityContext {
  actorId: string | null;
  at: string;
  makeId: (prefix: string) => string;
}

const clip = (s: string): string => (s.length > ACTIVITY_TEXT_LIMIT ? `${s.slice(0, ACTIVITY_TEXT_LIMIT - 1)}…` : s);

/** Loggable snapshot of a field (arrays become string arrays, long text is clipped). */
function fieldValue(t: Task, f: Exclude<LoggedField, 'comments'>): ActivityValue {
  switch (f) {
    case 'description':
      return clip(t.description);
    case 'status':
      // the workflow status (its category follows from it)
      return t.statusId;
    case 'tags':
      return [...t.tags];
    case 'blockedBy':
      return [...t.blockedBy];
    case 'subtasks':
      return t.subtasks.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title}`);
    default:
      return t[f];
  }
}

const same = (a: ActivityValue, b: ActivityValue): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

/**
 * Activity entries describing the difference between two task lists: creations, deletions and one entry per
 * changed field (comments: one entry per added/removed comment). `order`, `completedAt` (derived from status)
 * and `timeSpentMinutes` (Pomodoro tracking, not undoable) are not logged. Unchanged task objects are skipped
 * by identity, so this is cheap for the immutable updates the store does.
 */
export function diffTasks(prev: readonly Task[], next: readonly Task[], ctx: ActivityContext): ActivityEntry[] {
  const before = new Map(prev.map((t) => [t.id, t]));
  const out: ActivityEntry[] = [];
  const entry = (taskId: string, type: ActivityType, extra: Partial<ActivityEntry> = {}): void => {
    out.push({ id: ctx.makeId('a'), taskId, actorId: ctx.actorId, type, ...extra, at: ctx.at });
  };
  const seen = new Set<string>();
  for (const t of next) {
    seen.add(t.id);
    const p = before.get(t.id);
    if (!p) {
      entry(t.id, 'created', { to: t.title });
      continue;
    }
    if (p === t) continue;
    for (const f of LOGGED_FIELDS) {
      if (f === 'comments') {
        if (p.comments === t.comments) continue;
        const oldIds = new Set(p.comments.map((c) => c.id));
        const newIds = new Set(t.comments.map((c) => c.id));
        for (const c of t.comments) if (!oldIds.has(c.id)) entry(t.id, 'comment', { field: 'comments', to: clip(c.body) });
        for (const c of p.comments) if (!newIds.has(c.id)) entry(t.id, 'comment', { field: 'comments', from: clip(c.body) });
        continue;
      }
      const from = fieldValue(p, f);
      const to = fieldValue(t, f);
      if (!same(from, to)) entry(t.id, TYPE_OF_FIELD[f] ?? 'updated', { field: f, from, to });
    }
  }
  for (const p of prev) if (!seen.has(p.id)) entry(p.id, 'deleted', { from: p.title });
  return out;
}

/** Append entries, keeping at most `limit` (newest) entries. Returns `log` itself when there is nothing to add. */
export function appendActivity(log: ActivityEntry[], entries: readonly ActivityEntry[], limit = ACTIVITY_LIMIT): ActivityEntry[] {
  if (entries.length === 0) return log;
  const next = [...log, ...entries];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

// ---------- presentation ----------

export interface ActivityLookups {
  members: ReadonlyMap<string, Member>;
  projects: ReadonlyMap<string, Project>;
  /** title of a task id, also for deleted tasks when known */
  taskTitle: (id: string) => string | null;
  /** renders a stored comment body as plain text */
  commentText: (body: string) => string;
  /** name of a workflow status as seen by a task (falls back to the category label for old/unknown ids) */
  statusName?: (taskId: string, statusId: string) => string;
}

export interface ActivityDescription {
  /** e.g. "changed the status" – rendered after the actor's name when the task is implied (task timeline) */
  action: string;
  /** same sentence, ending in a preposition, to be followed by the task title (global log): "changed the status of" */
  actionOnTask: string;
  from?: string;
  to?: string;
}

const asList = (v: ActivityValue | undefined): string[] => (Array.isArray(v) ? v : []);

/** Display text for a logged field value. */
export function formatActivityValue(field: LoggedField, v: ActivityValue | undefined, l: ActivityLookups, taskId = ''): string {
  if (v === undefined) return '';
  switch (field) {
    case 'status':
      return l.statusName?.(taskId, String(v)) ?? STATUS_LABELS[v as Status] ?? String(v);
    case 'priority':
      return PRIORITY_LABELS[v as Priority] ?? String(v);
    case 'recurrence':
      return RECURRENCE_LABELS[v as Recurrence] ?? String(v);
    case 'projectId':
      return v === null ? 'No project' : (l.projects.get(String(v))?.name ?? 'Deleted project');
    case 'assigneeId':
      return v === null ? 'Unassigned' : (l.members.get(String(v))?.name ?? 'Former member');
    case 'dueDate':
      return v === null ? 'No date' : formatDate(String(v), { year: 'numeric', month: 'short', day: 'numeric' });
    case 'estimateMinutes':
      return v === null ? 'None' : formatMinutes(Number(v));
    case 'tags':
      return asList(v).length ? asList(v).join(', ') : 'No tags';
    case 'subtasks': {
      const list = asList(v);
      return list.length ? `${list.filter((s) => s.startsWith('[x]')).length}/${list.length} done` : 'None';
    }
    case 'blockedBy':
      return asList(v).map((id) => `“${l.taskTitle(id) ?? 'deleted task'}”`).join(', ') || 'None';
    case 'description':
      return String(v) || '(empty)';
    case 'comments':
      return l.commentText(String(v));
    default:
      return v === null ? '—' : String(v);
  }
}

export function describeActivity(e: ActivityEntry, l: ActivityLookups): ActivityDescription {
  switch (e.type) {
    case 'created':
      return { action: 'created the task', actionOnTask: 'created' };
    case 'deleted':
      return { action: 'deleted the task', actionOnTask: 'deleted' };
    case 'comment':
      return e.from !== undefined
        ? { action: 'deleted a comment', actionOnTask: 'deleted a comment on', from: l.commentText(String(e.from)) }
        : { action: 'commented', actionOnTask: 'commented on', to: l.commentText(String(e.to ?? '')) };
    case 'dependencies': {
      const from = asList(e.from);
      const to = asList(e.to);
      const added = to.filter((id) => !from.includes(id));
      const removed = from.filter((id) => !to.includes(id));
      const names = (ids: string[]): string => ids.map((id) => `“${l.taskTitle(id) ?? 'deleted task'}”`).join(', ');
      if (added.length && !removed.length) {
        const action = `added blocker${added.length > 1 ? 's' : ''} ${names(added)}`;
        return { action, actionOnTask: `${action} to` };
      }
      if (removed.length && !added.length) {
        const action = `removed blocker${removed.length > 1 ? 's' : ''} ${names(removed)}`;
        return { action, actionOnTask: `${action} from` };
      }
      return {
        action: 'changed the blockers',
        actionOnTask: 'changed the blockers of',
        from: formatActivityValue('blockedBy', e.from, l),
        to: formatActivityValue('blockedBy', e.to, l),
      };
    }
    default: {
      const field = e.field ?? 'title';
      const action = `changed the ${FIELD_LABELS[field]}`;
      return { action, actionOnTask: `${action} of`, from: formatActivityValue(field, e.from, l, e.taskId), to: formatActivityValue(field, e.to, l, e.taskId) };
    }
  }
}

/** Title for every task id the log knows about (current tasks win over logged titles). */
export function knownTaskTitles(tasks: readonly Task[], log: readonly ActivityEntry[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const e of log) {
    if (e.type === 'created' && typeof e.to === 'string') titles.set(e.taskId, e.to);
    else if (e.type === 'deleted' && typeof e.from === 'string') titles.set(e.taskId, e.from);
    else if (e.field === 'title' && typeof e.to === 'string') titles.set(e.taskId, e.to);
  }
  for (const t of tasks) titles.set(t.id, t.title);
  return titles;
}

export interface ActivityFilter {
  actor: string; // '' = anyone, 'none' = unknown actor, otherwise member id
  type: ActivityType | '';
}

/** Newest first, filtered. */
export function filterActivity(log: readonly ActivityEntry[], f: ActivityFilter): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i] as ActivityEntry;
    if (f.type && e.type !== f.type) continue;
    if (f.actor && (f.actor === 'none' ? e.actorId !== null : e.actorId !== f.actor)) continue;
    out.push(e);
  }
  return out;
}
