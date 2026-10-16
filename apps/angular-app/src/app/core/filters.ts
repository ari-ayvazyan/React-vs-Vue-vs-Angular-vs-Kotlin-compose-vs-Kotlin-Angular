import { PRIORITIES, PRIORITY_RANK, Priority, STATUSES, Status, Task } from './models';
import { addDays, startOfWeek, toDateKey } from './dates';

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';
export type SortField = 'due' | 'priority' | 'created' | 'title';
export type SortDir = 'asc' | 'desc';

export interface TaskQuery {
  q: string;
  status: Status[];
  priority: Priority[];
  project: string; // '' = any, 'none' = no project, else project id
  assignee: string; // '' = anyone, 'none' = unassigned, else member id
  tag: string;
  due: DueFilter;
  sort: SortField;
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

const DUE_VALUES: DueFilter[] = ['all', 'overdue', 'today', 'week', 'none'];
const SORT_VALUES: SortField[] = ['due', 'priority', 'created', 'title'];

export function isOverdue(task: Task, today: string): boolean {
  return task.status !== 'done' && task.dueDate !== null && task.dueDate < today;
}

/** Case-insensitive full-text match across title, description and tags. All words must match. */
export function matchesSearch(task: Task, q: string): boolean {
  const terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = `${task.title}\n${task.description}\n${task.tags.join(' ')}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
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
      const start = startOfWeek(new Date(`${today}T00:00:00`));
      return task.dueDate >= toDateKey(start) && task.dueDate <= toDateKey(addDays(start, 6));
    }
  }
}

/** Shared by the task list, board and calendar: '' = anyone, 'none' = unassigned, else member id. */
export function matchesAssignee(task: Task, assignee: string): boolean {
  if (!assignee) return true;
  return assignee === 'none' ? task.assigneeId === null : task.assigneeId === assignee;
}

/**
 * '' = any, 'none' = no project, else the project *and its sub-projects* (`subtree` maps a project
 * id to itself plus all descendants; without it only the project itself matches).
 */
export function matchesProject(
  task: Task,
  project: string,
  subtree?: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (!project) return true;
  if (project === 'none') return task.projectId === null;
  if (task.projectId === null) return false;
  const ids = subtree?.get(project);
  return ids ? ids.has(task.projectId) : task.projectId === project;
}

/** `status` filters by category (`todo` / `in_progress` / `done`), whatever the workflow. */
export function filterTasks(
  tasks: readonly Task[],
  q: TaskQuery,
  today: string,
  subtree?: ReadonlyMap<string, ReadonlySet<string>>,
): Task[] {
  return tasks.filter(
    (t) =>
      (!q.status.length || q.status.includes(t.status)) &&
      (!q.priority.length || q.priority.includes(t.priority)) &&
      matchesProject(t, q.project, subtree) &&
      matchesAssignee(t, q.assignee) &&
      (!q.tag || t.tags.includes(q.tag)) &&
      matchesDue(t, q.due, today) &&
      matchesSearch(t, q.q),
  );
}

export function compareTasks(a: Task, b: Task, field: SortField): number {
  switch (field) {
    case 'due':
      // tasks without due date always sort after dated ones (in asc)
      if (a.dueDate === b.dueDate) return 0;
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    case 'priority':
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    case 'created':
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    case 'title':
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  }
}

/** Stable sort; ties broken by id for determinism. */
export function sortTasks(tasks: readonly Task[], field: SortField, dir: SortDir): Task[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const c = compareTasks(a, b, field);
    if (c !== 0) {
      // keep null due dates at the end regardless of direction
      if (field === 'due' && (a.dueDate === null || b.dueDate === null)) return c;
      return c * m;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  return { items: items.slice((p - 1) * pageSize, p * pageSize), page: p, pages };
}

type ParamValue = string | string[] | undefined | null;
type Params = Record<string, ParamValue>;

const first = (v: ParamValue): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
const list = (v: ParamValue): string[] =>
  first(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function parseQuery(params: Params): TaskQuery {
  const status = list(params['status']).filter((s): s is Status =>
    (STATUSES as string[]).includes(s),
  );
  const priority = list(params['priority']).filter((p): p is Priority =>
    (PRIORITIES as string[]).includes(p),
  );
  const due = first(params['due']) as DueFilter;
  const sort = first(params['sort']) as SortField;
  const dir = first(params['dir']);
  const page = parseInt(first(params['page']), 10);
  return {
    q: first(params['q']),
    status,
    priority,
    project: first(params['project']),
    assignee: first(params['assignee']),
    tag: first(params['tag']).toLowerCase(),
    due: DUE_VALUES.includes(due) ? due : 'all',
    sort: SORT_VALUES.includes(sort) ? sort : DEFAULT_QUERY.sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_QUERY.dir,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Serialises only non-default values, so URLs stay short. */
export function serializeQuery(q: TaskQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (q.q) out['q'] = q.q;
  if (q.status.length) out['status'] = q.status.join(',');
  if (q.priority.length) out['priority'] = q.priority.join(',');
  if (q.project) out['project'] = q.project;
  if (q.assignee) out['assignee'] = q.assignee;
  if (q.tag) out['tag'] = q.tag;
  if (q.due !== 'all') out['due'] = q.due;
  if (q.sort !== DEFAULT_QUERY.sort) out['sort'] = q.sort;
  if (q.dir !== DEFAULT_QUERY.dir) out['dir'] = q.dir;
  if (q.page > 1) out['page'] = String(q.page);
  return out;
}
