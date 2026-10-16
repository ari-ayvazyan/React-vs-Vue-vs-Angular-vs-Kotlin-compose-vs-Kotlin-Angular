import { SavedView } from './models';
import { DEFAULT_QUERY, TaskQuery, parseQuery, serializeQuery } from './filters';

export const VIEW_NAME_MAX = 60;

/** The params a view stores: everything the list URL holds except the page. */
export function viewParams(q: TaskQuery): Record<string, string> {
  return serializeQuery({ ...q, page: 1 });
}

export function sameParams(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** The saved view whose settings equal the given query (page ignored), if any. */
export function findView(views: readonly SavedView[], q: TaskQuery): SavedView | undefined {
  const p = viewParams(q);
  return views.find((v) => sameParams(normalizeParams(v.params), p));
}

/** Re-serialises stored params through the parser, dropping unknown or invalid values. */
export function normalizeParams(params: Record<string, string>): Record<string, string> {
  return viewParams(parseQuery(params));
}

/** Filters that apply on the board: columns are the status, and the board has its own order. */
export const BOARD_FILTER_KEYS = ['q', 'priority', 'project', 'assignee', 'tag', 'due'] as const;

export function boardParams(params: Record<string, string>): Record<string, string> {
  const norm = normalizeParams(params);
  const out: Record<string, string> = {};
  for (const k of BOARD_FILTER_KEYS) if (norm[k] !== undefined) out[k] = norm[k];
  return out;
}

/** Board query: the list query minus status, sort and paging. */
export function boardQuery(params: Record<string, string | string[] | undefined>): TaskQuery {
  const q = parseQuery(params);
  return {
    ...DEFAULT_QUERY,
    q: q.q,
    priority: q.priority,
    project: q.project,
    assignee: q.assignee,
    tag: q.tag,
    due: q.due,
  };
}

export function validateViewName(
  name: string,
  views: readonly SavedView[],
  exceptId: string | null = null,
): string {
  const n = name.trim();
  if (!n) return 'Name is required.';
  if (n.length > VIEW_NAME_MAX) return `Name must be at most ${VIEW_NAME_MAX} characters.`;
  const lower = n.toLocaleLowerCase();
  if (views.some((v) => v.id !== exceptId && v.name.toLocaleLowerCase() === lower))
    return 'A view with this name already exists.';
  return '';
}
