import { addDays, startOfWeek } from './dates';
import { matchesAssignee } from './members';
import { descendantIds } from './workflow';
import { PRIORITIES, PRIORITY_RANK, STATUSES, type Priority, type Project, type Status, type Task } from './types';

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';
export type SortKey = 'due' | 'priority' | 'created' | 'title';
export type SortDir = 'asc' | 'desc';

export const DUE_FILTERS: readonly DueFilter[] = ['all', 'overdue', 'today', 'week', 'none'];
export const DUE_LABEL: Record<DueFilter, string> = {
  all: 'Any time',
  overdue: 'Overdue',
  today: 'Due today',
  week: 'This week',
  none: 'No date',
};
export const SORT_KEYS: readonly SortKey[] = ['due', 'priority', 'created', 'title'];
export const SORT_LABEL: Record<SortKey, string> = {
  due: 'Due date',
  priority: 'Priority',
  created: 'Created',
  title: 'Title',
};

/** Special project filter value for tasks without a project. */
export const NO_PROJECT = 'none';

export interface TaskQuery {
  q: string;
  status: Status[];
  priority: Priority[];
  project: string | null;
  /** member id, NO_ASSIGNEE ('none'), or null for everyone */
  assignee: string | null;
  tag: string | null;
  due: DueFilter;
  sort: SortKey;
  dir: SortDir;
  page: number;
}

export const DEFAULT_QUERY: TaskQuery = {
  q: '',
  status: [],
  priority: [],
  project: null,
  assignee: null,
  tag: null,
  due: 'all',
  sort: 'created',
  dir: 'desc',
  page: 1,
};

interface ParamsLike {
  get(key: string): string | null;
}

function parseList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const out: T[] = [];
  for (const part of raw.split(',')) {
    if ((allowed as readonly string[]).includes(part) && !out.includes(part as T)) out.push(part as T);
  }
  return out;
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function parseQuery(params: ParamsLike): TaskQuery {
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return {
    q: params.get('q') ?? '',
    status: parseList(params.get('status'), STATUSES),
    priority: parseList(params.get('priority'), PRIORITIES),
    project: params.get('project') || null,
    assignee: params.get('assignee') || null,
    tag: params.get('tag') || null,
    due: oneOf(params.get('due'), DUE_FILTERS, 'all'),
    sort: oneOf(params.get('sort'), SORT_KEYS, DEFAULT_QUERY.sort),
    dir: oneOf(params.get('dir'), ['asc', 'desc'] as const, DEFAULT_QUERY.dir),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Serialise a query, omitting defaults so URLs stay short. */
export function queryToSearch(query: TaskQuery): string {
  const p = new URLSearchParams();
  if (query.q) p.set('q', query.q);
  if (query.status.length) p.set('status', query.status.join(','));
  if (query.priority.length) p.set('priority', query.priority.join(','));
  if (query.project) p.set('project', query.project);
  if (query.assignee) p.set('assignee', query.assignee);
  if (query.tag) p.set('tag', query.tag);
  if (query.due !== 'all') p.set('due', query.due);
  if (query.sort !== DEFAULT_QUERY.sort) p.set('sort', query.sort);
  if (query.dir !== DEFAULT_QUERY.dir) p.set('dir', query.dir);
  if (query.page > 1) p.set('page', String(query.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Split a search string into lowercase terms. */
export function searchTerms(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every term must appear in title, description or a tag. */
export function matchesSearch(task: Task, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = `${task.title}\n${task.description}\n${task.tags.join(' ')}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function isOverdue(task: Task, today: string): boolean {
  return task.category !== 'done' && task.dueDate !== null && task.dueDate < today;
}

export function matchesDue(task: Task, due: DueFilter, today: string): boolean {
  switch (due) {
    case 'all':
      return true;
    case 'overdue':
      return isOverdue(task, today);
    case 'today':
      return task.dueDate === today;
    case 'week': {
      if (!task.dueDate) return false;
      const start = startOfWeek(today);
      return task.dueDate >= start && task.dueDate <= addDays(start, 6);
    }
    case 'none':
      return task.dueDate === null;
  }
}

/**
 * Applies a task query. `status` filters by category. A project filter includes the project's
 * sub-projects when `projects` is given (always pass it in the app; tests may omit it).
 */
export function filterTasks(tasks: Task[], query: TaskQuery, today: string, projects?: Project[]): Task[] {
  const terms = searchTerms(query.q);
  const scope = query.project && query.project !== NO_PROJECT ? (projects ? descendantIds(projects, query.project) : new Set([query.project])) : null;
  return tasks.filter(
    (t) =>
      (!query.status.length || query.status.includes(t.category)) &&
      (!query.priority.length || query.priority.includes(t.priority)) &&
      (!query.project || (scope ? t.projectId !== null && scope.has(t.projectId) : t.projectId === null)) &&
      matchesAssignee(t, query.assignee) &&
      (!query.tag || t.tags.includes(query.tag)) &&
      matchesDue(t, query.due, today) &&
      matchesSearch(t, terms),
  );
}

function compare(a: Task, b: Task, key: SortKey): number {
  switch (key) {
    case 'due':
      return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
    case 'priority':
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    case 'created':
      return a.createdAt.localeCompare(b.createdAt);
    case 'title':
      return a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' });
  }
}

/** Stable sort; tasks without a due date always sort last when sorting by due date. */
export function sortTasks(tasks: Task[], key: SortKey, dir: SortDir): Task[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...tasks].sort((a, b) => {
    if (key === 'due' && (a.dueDate === null) !== (b.dueDate === null)) return a.dueDate === null ? 1 : -1;
    const c = compare(a, b, key) * sign;
    return c !== 0 ? c : a.id.localeCompare(b.id, 'en', { numeric: true });
  });
}

export interface Page<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pageCount);
  return { items: items.slice((p - 1) * size, p * size), page: p, pageCount, total: items.length };
}
