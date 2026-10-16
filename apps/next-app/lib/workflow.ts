import type { Project, StatusCategory, Task, WorkflowStatus } from './types';

/**
 * Workflows and the project tree.
 *
 * - Each project has an ordered list of statuses, or `workflow: null` meaning "inherit from the
 *   parent" (a root project inherits DEFAULT_WORKFLOW). Tasks without a project use the default.
 * - A task stores `statusId` (a status of its project's effective workflow) and `category`, which
 *   is derived from that status and kept in sync by `reconcileTasks` after every change. All
 *   status-dependent logic (filters, KPIs, completion, recurrence, dependencies…) reads `category`.
 */

export const STATUS_NAME_MAX = 30;

export const DEFAULT_WORKFLOW: readonly WorkflowStatus[] = [
  { id: 'todo', name: 'To do', color: '#94a3b8', category: 'todo' },
  { id: 'in_progress', name: 'In progress', color: '#3b82f6', category: 'in_progress' },
  { id: 'done', name: 'Done', color: '#22c55e', category: 'done' },
];

export type ProjectLookup = Map<string, Project>;

export function projectMap(projects: Project[]): ProjectLookup {
  return new Map(projects.map((p) => [p.id, p]));
}

/** The project whose workflow applies to `projectId` (itself or the nearest customised ancestor); null = default. */
export function workflowOwner(byId: ProjectLookup, projectId: string | null): Project | null {
  const seen = new Set<string>();
  let cur = projectId ? byId.get(projectId) : undefined;
  while (cur && !seen.has(cur.id)) {
    if (cur.workflow) return cur;
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}

export function effectiveWorkflow(byId: ProjectLookup, projectId: string | null): readonly WorkflowStatus[] {
  return workflowOwner(byId, projectId)?.workflow ?? DEFAULT_WORKFLOW;
}

/** Caches effective workflows per project id for one pass over many tasks. */
export function workflowResolver(projects: Project[]): (projectId: string | null) => readonly WorkflowStatus[] {
  const byId = projectMap(projects);
  const cache = new Map<string | null, readonly WorkflowStatus[]>();
  return (projectId) => {
    let wf = cache.get(projectId);
    if (!wf) {
      wf = effectiveWorkflow(byId, projectId);
      cache.set(projectId, wf);
    }
    return wf;
  };
}

export function findStatus(workflow: readonly WorkflowStatus[], statusId: string): WorkflowStatus | undefined {
  return workflow.find((s) => s.id === statusId);
}

/** Keeps `current` if it already has `category`; otherwise the first status of that category (or the first status at all). */
export function statusForCategory(workflow: readonly WorkflowStatus[], category: StatusCategory, current?: string): string {
  if (current) {
    const s = findStatus(workflow, current);
    if (s && s.category === category) return s.id;
  }
  return (workflow.find((s) => s.category === category) ?? workflow[0]).id;
}

function maxOrderByCategory(tasks: Task[]): Record<StatusCategory, number> {
  const m: Record<StatusCategory, number> = { todo: -1, in_progress: -1, done: -1 };
  for (const t of tasks) if (t.order > m[t.category]) m[t.category] = t.order;
  return m;
}

/**
 * Makes every task consistent with the workflows: an unknown status maps to the first status of
 * the same category; `category` follows the status; a change of category sets/clears
 * `completedAt` (at `at`) and appends the task to the end of its new category column.
 * Returns `tasks` unchanged (same array) when nothing needed fixing.
 */
export function reconcileTasks(tasks: Task[], projects: Project[], at: string): Task[] {
  const resolve = workflowResolver(projects);
  let max: Record<StatusCategory, number> | null = null;
  let changed = false;
  const out = tasks.map((t) => {
    const wf = resolve(t.projectId);
    let status = findStatus(wf, t.statusId);
    if (!status) status = findStatus(wf, statusForCategory(wf, t.category))!;
    if (status.id === t.statusId && status.category === t.category) return t;
    changed = true;
    const next: Task = { ...t, statusId: status.id, category: status.category };
    if (status.category !== t.category) {
      max ??= maxOrderByCategory(tasks);
      next.order = ++max[status.category];
      next.completedAt = status.category === 'done' ? (t.completedAt ?? at) : null;
    }
    return next;
  });
  return changed ? out : tasks;
}

/** Problems with a workflow, or null when valid. */
export function validateWorkflow(workflow: readonly WorkflowStatus[]): string | null {
  if (!workflow.length) return 'A workflow needs at least one status.';
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const s of workflow) {
    const name = s.name.trim();
    if (!name) return 'Status names cannot be empty.';
    if (name.length > STATUS_NAME_MAX) return `Status names must be at most ${STATUS_NAME_MAX} characters.`;
    if (names.has(name.toLowerCase())) return `There is already a status called “${name}”.`;
    if (ids.has(s.id)) return 'Status ids must be unique.';
    if (!/^#[0-9a-fA-F]{6}$/.test(s.color)) return 'Status colours must be hex colours like #3b82f6.';
    names.add(name.toLowerCase());
    ids.add(s.id);
  }
  for (const c of ['todo', 'in_progress', 'done'] as const) {
    if (!workflow.some((s) => s.category === c)) return `A workflow needs at least one “${CATEGORY_NAME[c]}” status.`;
  }
  return null;
}

const CATEGORY_NAME: Record<StatusCategory, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };

// ---------------------------------------------------------------------------
// Project tree

export function childrenMap(projects: Project[]): Map<string | null, Project[]> {
  const ids = new Set(projects.map((p) => p.id));
  const m = new Map<string | null, Project[]>();
  for (const p of projects) {
    const parent = p.parentId && ids.has(p.parentId) ? p.parentId : null;
    const list = m.get(parent);
    if (list) list.push(p);
    else m.set(parent, [p]);
  }
  return m;
}

/** `id` and all its descendants. */
export function descendantIds(projects: Project[], id: string): Set<string> {
  const children = childrenMap(projects);
  const out = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      if (out.has(c.id)) continue;
      out.add(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

/** True when making `parentId` the parent of `id` would create a cycle (including parent = self). */
export function wouldCreateCycle(projects: Project[], id: string, parentId: string | null): boolean {
  return parentId !== null && descendantIds(projects, id).has(parentId);
}

export interface TreeRow {
  project: Project;
  depth: number;
}

/** Depth-first order (siblings keep their array order). Projects in a broken cycle are appended at depth 0. */
export function projectTree(projects: Project[]): TreeRow[] {
  const children = childrenMap(projects);
  const out: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const p of children.get(parent) ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ project: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const p of projects) if (!seen.has(p.id)) out.push({ project: p, depth: 0 });
  return out;
}

/** "Website › Landing › Copy" */
export function projectPath(byId: ProjectLookup, id: string, sep = ' › '): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    names.unshift(cur.name);
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return names.join(sep);
}

/** Option label for selects: indented by depth with non-breaking spaces. */
export function treeLabel(row: TreeRow): string {
  return `${'   '.repeat(row.depth)}${row.depth ? '└ ' : ''}${row.project.name}`;
}
