import { Project } from './models';

export interface TreeNode {
  project: Project;
  depth: number;
}

/** Children per parent id ('' for top level), in the projects' stored order. */
export function childrenMap(projects: readonly Project[]): Map<string, Project[]> {
  const ids = new Set(projects.map((p) => p.id));
  const map = new Map<string, Project[]>();
  for (const p of projects) {
    // a dangling parent is treated as top level
    const key = p.parentId && ids.has(p.parentId) ? p.parentId : '';
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return map;
}

/** Depth-first tree order (parents before their children). Projects stuck in a cycle are skipped. */
export function treeOrder(projects: readonly Project[]): TreeNode[] {
  const children = childrenMap(projects);
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  const walk = (parentKey: string, depth: number) => {
    for (const project of children.get(parentKey) ?? []) {
      if (seen.has(project.id)) continue;
      seen.add(project.id);
      out.push({ project, depth });
      walk(project.id, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

/** For every project: the ids of itself and all its descendants. */
export function subtreeMap(projects: readonly Project[]): Map<string, ReadonlySet<string>> {
  const children = childrenMap(projects);
  const memo = new Map<string, Set<string>>();
  const collect = (id: string, stack: Set<string>): Set<string> => {
    const cached = memo.get(id);
    if (cached) return cached;
    const set = new Set([id]);
    stack.add(id);
    for (const c of children.get(id) ?? []) {
      if (stack.has(c.id)) continue; // defensive: ignore cycles
      for (const x of collect(c.id, stack)) set.add(x);
    }
    stack.delete(id);
    memo.set(id, set);
    return set;
  };
  for (const p of projects) collect(p.id, new Set());
  return memo;
}

/** Would making `parentId` the parent of `projectId` create a cycle (or self-parenting)? */
export function wouldCreateCycle(
  projects: readonly Project[],
  projectId: string,
  parentId: string | null,
): boolean {
  if (parentId === null) return false;
  if (parentId === projectId) return true;
  return subtreeMap(projects).get(projectId)?.has(parentId) ?? false;
}

/** Ancestors from the root down to (excluding) the project itself. */
export function ancestors(projects: readonly Project[], projectId: string): Project[] {
  const map = new Map(projects.map((p) => [p.id, p]));
  const out: Project[] = [];
  const seen = new Set<string>([projectId]);
  let cur = map.get(projectId)?.parentId ?? null;
  while (cur && !seen.has(cur) && map.has(cur)) {
    seen.add(cur);
    out.unshift(map.get(cur)!);
    cur = map.get(cur)!.parentId;
  }
  return out;
}

/** "Parent / Child" style label. */
export function projectPath(projects: readonly Project[], projectId: string): string {
  const p = projects.find((x) => x.id === projectId);
  if (!p) return '';
  return [...ancestors(projects, projectId), p].map((x) => x.name).join(' / ');
}

/** Options for a <select>: tree order with an indentation prefix per level. */
export function projectOptions(
  projects: readonly Project[],
): { id: string; label: string; depth: number }[] {
  return treeOrder(projects).map(({ project, depth }) => ({
    id: project.id,
    depth,
    label: `${'   '.repeat(depth)}${depth ? '└ ' : ''}${project.name}`,
  }));
}
