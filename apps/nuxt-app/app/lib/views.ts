import type { Member, Project, SavedView } from './types';
import { PRIORITY_LABELS, STATUS_LABELS } from './types';
import { DUE_OPTIONS, SORT_OPTIONS, parseTaskQuery, serializeTaskQuery } from './filters';
import type { TaskQuery } from './filters';

export const VIEW_NAME_MAX = 60;

/** The part of a task-list query a view stores: everything except the page. */
export function viewQueryOf(q: TaskQuery): Record<string, string> {
  return serializeTaskQuery({ ...q, page: 1 });
}

/** Re-validates a stored query (unknown values are dropped, so old views keep working). */
export function normalizeViewQuery(raw: Record<string, string>): Record<string, string> {
  return viewQueryOf(parseTaskQuery(raw));
}

/** Two serialized queries describe the same view (ignores key order and the page). */
export function sameViewQuery(a: Record<string, string>, b: Record<string, string>): boolean {
  const x = normalizeViewQuery(a);
  const y = normalizeViewQuery(b);
  const kx = Object.keys(x);
  return kx.length === Object.keys(y).length && kx.every((k) => x[k] === y[k]);
}

/** The view whose query equals the current list query, if any. */
export function findMatchingView(views: readonly SavedView[], q: TaskQuery): SavedView | undefined {
  const current = viewQueryOf(q);
  return views.find((v) => sameViewQuery(v.query, current));
}

/**
 * Board query for a view. The board has its own columns (status) and order (manual), so status, sort and
 * direction are dropped; search, priority, project, assignee, tag and due filters apply.
 */
export function boardQueryOf(query: Record<string, string>): Record<string, string> {
  const { status: _s, sort: _o, dir: _d, page: _p, ...rest } = normalizeViewQuery(query);
  return rest;
}

/** Filters a view would *not* apply on the board (so the UI can say so). */
export function ignoredOnBoard(query: Record<string, string>): string[] {
  const q = normalizeViewQuery(query);
  const out: string[] = [];
  if (q.status) out.push('status');
  if (q.sort || q.dir) out.push('sort order');
  return out;
}

export interface ViewLookups {
  projects: ReadonlyMap<string, Project>;
  members: ReadonlyMap<string, Member>;
}

/** Short human summary of a query, e.g. "Status: To do · Assignee: Sam Rivera · Sort: Due date ↑". */
export function describeQuery(raw: Record<string, string>, l: ViewLookups): string {
  const q = parseTaskQuery(raw);
  const parts: string[] = [];
  if (q.q) parts.push(`“${q.q}”`);
  if (q.status.length) parts.push(`Status: ${q.status.map((s) => STATUS_LABELS[s]).join(', ')}`);
  if (q.priority.length) parts.push(`Priority: ${q.priority.map((p) => PRIORITY_LABELS[p]).join(', ')}`);
  if (q.project) parts.push(`Project: ${q.project === 'none' ? 'No project' : (l.projects.get(q.project)?.name ?? 'deleted project')}`);
  if (q.assignee) parts.push(`Assignee: ${q.assignee === 'none' ? 'Unassigned' : (l.members.get(q.assignee)?.name ?? 'former member')}`);
  if (q.tag) parts.push(`Tag: ${q.tag}`);
  if (q.due !== 'all') parts.push(`Due: ${DUE_OPTIONS.find((o) => o.value === q.due)?.label ?? q.due}`);
  parts.push(`Sort: ${SORT_OPTIONS.find((o) => o.value === q.sort)?.label ?? q.sort} ${q.dir === 'asc' ? '↑' : '↓'}`);
  return parts.join(' · ');
}

/** Suggested name for a new view based on its filters. */
export function suggestViewName(raw: Record<string, string>, l: ViewLookups): string {
  const q = parseTaskQuery(raw);
  const bits: string[] = [];
  if (q.assignee) bits.push(q.assignee === 'none' ? 'Unassigned' : (l.members.get(q.assignee)?.name.split(/\s+/)[0] ?? 'Member'));
  if (q.project) bits.push(q.project === 'none' ? 'No project' : (l.projects.get(q.project)?.name ?? 'Project'));
  if (q.priority.length) bits.push(q.priority.map((p) => PRIORITY_LABELS[p]).join('/'));
  if (q.status.length) bits.push(q.status.map((s) => STATUS_LABELS[s]).join('/'));
  if (q.tag) bits.push(`#${q.tag}`);
  if (q.due !== 'all') bits.push(DUE_OPTIONS.find((o) => o.value === q.due)?.label ?? '');
  if (q.q) bits.push(`“${q.q}”`);
  return (bits.filter(Boolean).join(' · ') || 'All tasks').slice(0, VIEW_NAME_MAX);
}

/** Returns an error message, or '' when the name is acceptable (unique, case-insensitive). */
export function validateViewName(name: string, views: readonly SavedView[], exceptId?: string): string {
  const n = name.trim();
  if (!n) return 'Name is required.';
  if (n.length > VIEW_NAME_MAX) return `Name must be at most ${VIEW_NAME_MAX} characters.`;
  if (views.some((v) => v.id !== exceptId && v.name.trim().toLowerCase() === n.toLowerCase())) return 'A view with this name already exists.';
  return '';
}
