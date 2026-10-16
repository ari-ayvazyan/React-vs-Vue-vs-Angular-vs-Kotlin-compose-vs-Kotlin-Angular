import type { Priority, Status, Task } from './types';
import { PRIORITIES, PRIORITY_RANK, STATUSES } from './types';
import { addDays, parseISODate, startOfWeek, toISODate } from './dates';
import type { ProjectScope } from './projects';

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';
export type SortKey = 'due' | 'priority' | 'created' | 'title';
export type SortDir = 'asc' | 'desc';

export interface TaskQuery {
  q: string;
  status: Status[];
  priority: Priority[];
  /** '' = any, 'none' = no project, otherwise project id */
  project: string;
  /** '' = anyone, 'none' = unassigned, otherwise member id */
  assignee: string;
  tag: string;
  due: DueFilter;
  sort: SortKey;
  dir: SortDir;
  page: number;
}

export const DEFAULT_QUERY: TaskQuery = {
  q: '',
  status: [],
  priority: [],
  project: '',
  assignee: '',
  tag: '',
  due: 'all',
  sort: 'created',
  dir: 'desc',
  page: 1,
};

export const DUE_OPTIONS: ReadonlyArray<{ value: DueFilter; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'none', label: 'No date' },
];

export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'created', label: 'Created' },
  { value: 'title', label: 'Title' },
];

export function isOverdue(task: Pick<Task, 'dueDate' | 'status'>, today: string): boolean {
  return task.status !== 'done' && task.dueDate !== null && task.dueDate < today;
}

/** Normalise search text: lower-case, collapse whitespace. */
export function tokenize(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every token must occur in title, description or tags (AND semantics). */
export function matchesSearch(task: Task, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = `${task.title}\n${task.description}\n${task.tags.join(' ')}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

export function matchesDue(task: Task, due: DueFilter, today: string): boolean {
  switch (due) {
    case 'all':
      return true;
    case 'none':
      return task.dueDate === null;
    case 'overdue':
      return isOverdue(task, today);
    case 'today':
      return task.dueDate === today;
    case 'week': {
      if (!task.dueDate) return false;
      const start = toISODate(startOfWeek(parseISODate(today)));
      const end = toISODate(addDays(parseISODate(start), 6));
      return task.dueDate >= start && task.dueDate <= end;
    }
  }
}

/** '' matches everything, 'none' matches null, anything else must equal `value`. */
function matchesRef(value: string | null, filter: string): boolean {
  if (!filter) return true;
  return filter === 'none' ? value === null : value === filter;
}

/**
 * Project filter shared by the task list, board and reports ('' = all, 'none' = no project). With a `scope`
 * (see lib/projects makeProjectScope) a project also matches the tasks of its sub-projects.
 */
export function matchesProject(task: Pick<Task, 'projectId'>, project: string, scope?: ProjectScope): boolean {
  if (!project || project === 'none' || !scope) return matchesRef(task.projectId, project);
  return task.projectId !== null && scope(project).has(task.projectId);
}

/** Assignee filter shared by the task list, board and calendar ('' = anyone, 'none' = unassigned). */
export function matchesAssignee(task: Pick<Task, 'assigneeId'>, assignee: string): boolean {
  return matchesRef(task.assigneeId, assignee);
}

export function filterTasks(tasks: readonly Task[], query: TaskQuery, today: string, scope?: ProjectScope): Task[] {
  const tokens = tokenize(query.q);
  const statuses = query.status.length ? new Set(query.status) : null;
  const priorities = query.priority.length ? new Set(query.priority) : null;
  return tasks.filter((t) => {
    if (statuses && !statuses.has(t.status)) return false;
    if (priorities && !priorities.has(t.priority)) return false;
    if (!matchesProject(t, query.project, scope)) return false;
    if (!matchesAssignee(t, query.assignee)) return false;
    if (query.tag && !t.tags.includes(query.tag)) return false;
    if (!matchesDue(t, query.due, today)) return false;
    return matchesSearch(t, tokens);
  });
}

export function compareTasks(a: Task, b: Task, sort: SortKey): number {
  switch (sort) {
    case 'due':
      // tasks without a due date always go last in ascending order
      if (a.dueDate === b.dueDate) return 0;
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    case 'priority':
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    case 'created':
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    case 'title':
      return a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' });
  }
}

/** Stable sort; ties broken by id so ordering is deterministic. */
export function sortTasks(tasks: readonly Task[], sort: SortKey, dir: SortDir): Task[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const c = compareTasks(a, b, sort);
    if (c !== 0) {
      // keep "no due date" last regardless of direction
      if (sort === 'due' && (a.dueDate === null || b.dueDate === null)) return c;
      return c * sign;
    }
    return a.id.localeCompare(b.id, 'en', { numeric: true });
  });
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): { items: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(1, page), pageCount);
  return { items: items.slice((p - 1) * pageSize, p * pageSize), page: p, pageCount };
}

type RawQuery = Record<string, string | null | undefined | (string | null)[]>;

function first(v: RawQuery[string]): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

function list<T extends string>(v: RawQuery[string], allowed: readonly T[]): T[] {
  const raw = Array.isArray(v) ? v.join(',') : (v ?? '');
  return raw.split(',').filter((x): x is T => (allowed as readonly string[]).includes(x));
}

/** Parse a route query object into a validated TaskQuery. */
export function parseTaskQuery(raw: RawQuery): TaskQuery {
  const due = first(raw.due) as DueFilter;
  const sort = first(raw.sort) as SortKey;
  const dir = first(raw.dir) as SortDir;
  const page = Number.parseInt(first(raw.page), 10);
  return {
    q: first(raw.q),
    status: list(raw.status, STATUSES),
    priority: list(raw.priority, PRIORITIES),
    project: first(raw.project),
    assignee: first(raw.assignee),
    tag: first(raw.tag),
    due: DUE_OPTIONS.some((o) => o.value === due) ? due : DEFAULT_QUERY.due,
    sort: SORT_OPTIONS.some((o) => o.value === sort) ? sort : DEFAULT_QUERY.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_QUERY.dir,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Serialise a TaskQuery to a minimal route query (defaults omitted). */
export function serializeTaskQuery(q: TaskQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (q.q) out.q = q.q;
  if (q.status.length) out.status = q.status.join(',');
  if (q.priority.length) out.priority = q.priority.join(',');
  if (q.project) out.project = q.project;
  if (q.assignee) out.assignee = q.assignee;
  if (q.tag) out.tag = q.tag;
  if (q.due !== DEFAULT_QUERY.due) out.due = q.due;
  if (q.sort !== DEFAULT_QUERY.sort) out.sort = q.sort;
  if (q.dir !== DEFAULT_QUERY.dir) out.dir = q.dir;
  if (q.page > 1) out.page = String(q.page);
  return out;
}
