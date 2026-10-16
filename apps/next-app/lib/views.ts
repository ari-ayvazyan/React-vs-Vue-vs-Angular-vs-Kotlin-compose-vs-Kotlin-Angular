import { DEFAULT_QUERY, parseQuery, queryToSearch, type TaskQuery } from './filters';
import type { SavedView } from './types';

export const VIEW_NAME_MAX = 40;

/** The part of a task query a view stores: everything except the page. */
export function viewSearch(query: TaskQuery): string {
  return queryToSearch({ ...query, page: 1 });
}

/** Normalises any query string (unknown params dropped, defaults omitted, page removed). */
export function normalizeSearch(search: string): string {
  return viewSearch(parseQuery(new URLSearchParams(search)));
}

export function viewQuery(view: SavedView): TaskQuery {
  return parseQuery(new URLSearchParams(view.search));
}

/** The first saved view whose stored query equals `query` (ignoring the page). */
export function matchingView(views: SavedView[], query: TaskQuery): SavedView | undefined {
  const s = viewSearch(query);
  return views.find((v) => v.search === s);
}

export function validateViewName(name: string, views: SavedView[], exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Name is required.';
  if (n.length > VIEW_NAME_MAX) return `Name must be at most ${VIEW_NAME_MAX} characters.`;
  if (views.some((v) => v.id !== exceptId && v.name.toLowerCase() === n.toLowerCase())) return 'A view with this name already exists.';
  return null;
}

/**
 * Board filters from a task query: the board shows every status as a column and has its own
 * ordering, so status, sort and page do not apply; search, priority, project, assignee, tag and
 * due do.
 */
export function boardQuery(query: TaskQuery): TaskQuery {
  return { ...query, status: [], sort: DEFAULT_QUERY.sort, dir: DEFAULT_QUERY.dir, page: 1 };
}

/** Query string for opening a view (or any query) on the board. */
export function boardSearch(query: TaskQuery): string {
  return queryToSearch(boardQuery(query));
}

/** Short human summary, e.g. "To do, In progress · High · Alex Kim · “bug”". Names resolved by the caller. */
export function describeQuery(
  query: TaskQuery,
  names: { project: (id: string) => string; member: (id: string) => string; status: (s: string) => string; priority: (p: string) => string; due: (d: string) => string; sort: (k: string) => string },
): string {
  const parts: string[] = [];
  if (query.q) parts.push(`“${query.q}”`);
  if (query.status.length) parts.push(query.status.map(names.status).join(', '));
  if (query.priority.length) parts.push(query.priority.map(names.priority).join(', '));
  if (query.project) parts.push(names.project(query.project));
  if (query.assignee) parts.push(names.member(query.assignee));
  if (query.tag) parts.push(`#${query.tag}`);
  if (query.due !== 'all') parts.push(names.due(query.due));
  if (query.sort !== DEFAULT_QUERY.sort || query.dir !== DEFAULT_QUERY.dir) parts.push(`sorted by ${names.sort(query.sort).toLowerCase()} ${query.dir === 'asc' ? '↑' : '↓'}`);
  return parts.length ? parts.join(' · ') : 'All tasks';
}
