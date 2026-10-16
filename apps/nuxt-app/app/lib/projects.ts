import type { Project, Task } from './types';

/** Child project ids per parent id ('' = top level), in project order. */
export function childrenMap(projects: readonly Pick<Project, 'id' | 'parentId'>[]): Map<string, string[]> {
  const ids = new Set(projects.map((p) => p.id));
  const map = new Map<string, string[]>();
  for (const p of projects) {
    const key = p.parentId && ids.has(p.parentId) ? p.parentId : '';
    const list = map.get(key);
    if (list) list.push(p.id);
    else map.set(key, [p.id]);
  }
  return map;
}

/** The project and all its descendants. */
export function descendantIds(projects: readonly Pick<Project, 'id' | 'parentId'>[], id: string): Set<string> {
  const children = childrenMap(projects);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(children.get(cur) ?? []));
  }
  return out;
}

/** Ancestor ids, nearest first. Stops on a cycle (which validation prevents anyway). */
export function ancestorIds(byId: ReadonlyMap<string, Pick<Project, 'id' | 'parentId'>>, id: string): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  let cur = byId.get(id)?.parentId ?? null;
  while (cur && byId.has(cur) && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return out;
}

export interface ProjectNode {
  project: Project;
  depth: number;
  /** "Parent / Child" */
  path: string;
}

/** Depth-first tree order (children follow their parent, siblings keep project order). */
export function projectTree(projects: readonly Project[]): ProjectNode[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const children = childrenMap(projects);
  const out: ProjectNode[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number, prefix: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const project = byId.get(id) as Project;
    const path = prefix ? `${prefix} / ${project.name}` : project.name;
    out.push({ project, depth, path });
    for (const c of children.get(id) ?? []) walk(c, depth + 1, path);
  };
  for (const id of children.get('') ?? []) walk(id, 0, '');
  // anything unreachable (only possible with a cycle in unvalidated data) is listed at the top level
  for (const p of projects) if (!seen.has(p.id)) walk(p.id, 0, '');
  return out;
}

/** Options for project selects: tree order, indented with non-breaking spaces. */
export function projectOptions(projects: readonly Project[]): { id: string; label: string; depth: number }[] {
  return projectTree(projects).map((n) => ({ id: n.project.id, label: `${'   '.repeat(n.depth)}${n.depth ? '↳ ' : ''}${n.project.name}`, depth: n.depth }));
}

/** Error message for making `parentId` the parent of `id`, or '' when allowed. */
export function validateParent(projects: readonly Pick<Project, 'id' | 'parentId'>[], id: string, parentId: string | null): string {
  if (parentId === null) return '';
  if (!projects.some((p) => p.id === parentId)) return 'The parent project does not exist.';
  if (parentId === id) return 'A project cannot be its own parent.';
  if (descendantIds(projects, id).has(parentId)) return 'A project cannot be moved under one of its own sub-projects.';
  return '';
}

/** True when the parent links contain a cycle. */
export function hasParentCycle(projects: readonly Pick<Project, 'id' | 'parentId'>[]): boolean {
  const byId = new Map(projects.map((p) => [p.id, p]));
  for (const p of projects) {
    const seen = new Set<string>();
    let cur: string | null = p.id;
    while (cur) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
  }
  return false;
}

/** Project filter scope: a project id → that project and its descendants. Memoised per project list. */
export type ProjectScope = (projectId: string) => ReadonlySet<string>;

export function makeProjectScope(projects: readonly Pick<Project, 'id' | 'parentId'>[]): ProjectScope {
  const cache = new Map<string, Set<string>>();
  return (id) => {
    let s = cache.get(id);
    if (!s) {
      s = descendantIds(projects, id);
      cache.set(id, s);
    }
    return s;
  };
}

export type SubprojectMode = 'lift' | 'delete';
export type ProjectTaskMode = 'unassign' | 'delete';

/**
 * Delete a project. Sub-projects either move up one level (to the deleted project's parent) or are deleted too.
 * Tasks of every deleted project are unassigned or deleted. Lifted sub-projects that inherited the deleted
 * project's own workflow get a copy of it, so their tasks keep their statuses.
 */
export function deleteProjectPlan(
  projects: readonly Project[],
  tasks: readonly Task[],
  id: string,
  subprojects: SubprojectMode,
  taskMode: ProjectTaskMode,
): { projects: Project[]; tasks: Task[]; deletedProjectIds: Set<string>; deletedTaskIds: Set<string> } {
  const target = projects.find((p) => p.id === id);
  if (!target) return { projects: [...projects], tasks: [...tasks], deletedProjectIds: new Set(), deletedTaskIds: new Set() };
  const removed = subprojects === 'delete' ? descendantIds(projects, id) : new Set([id]);
  const nextProjects = projects
    .filter((p) => !removed.has(p.id))
    .map((p) => {
      if (p.parentId !== id) return p;
      const inherited = p.workflow === null && target.workflow !== null ? target.workflow.map((s) => ({ ...s })) : p.workflow;
      return { ...p, parentId: target.parentId, workflow: inherited };
    });
  const deletedTaskIds = new Set<string>();
  const nextTasks: Task[] = [];
  for (const t of tasks) {
    if (t.projectId && removed.has(t.projectId)) {
      if (taskMode === 'delete') {
        deletedTaskIds.add(t.id);
        continue;
      }
      nextTasks.push({ ...t, projectId: null });
    } else nextTasks.push(t);
  }
  return { projects: nextProjects, tasks: nextTasks, deletedProjectIds: removed, deletedTaskIds };
}
