import { DEFAULT_WORKFLOW, Project, STATUSES, Status, Task, WorkflowStatus } from './models';

export const STATUS_NAME_MAX = 30;

export interface EffectiveWorkflow {
  statuses: readonly WorkflowStatus[];
  /** Project whose custom workflow applies, or null for the default workflow. */
  sourceId: string | null;
}

/** The workflow that applies to a project: its own, else the nearest ancestor's, else the default. */
export function effectiveWorkflow(
  projectId: string | null,
  projects: ReadonlyMap<string, Project>,
): EffectiveWorkflow {
  const seen = new Set<string>();
  let cur = projectId ? projects.get(projectId) : undefined;
  while (cur && !seen.has(cur.id)) {
    if (cur.workflow) return { statuses: cur.workflow, sourceId: cur.id };
    seen.add(cur.id);
    cur = cur.parentId ? projects.get(cur.parentId) : undefined;
  }
  return { statuses: DEFAULT_WORKFLOW, sourceId: null };
}

/** Memoised `projectId → statuses` lookup over one projects array ('' = no project). */
export function workflowResolver(
  projects: readonly Project[],
): (projectId: string | null) => readonly WorkflowStatus[] {
  const map = new Map(projects.map((p) => [p.id, p]));
  const memo = new Map<string, readonly WorkflowStatus[]>();
  return (projectId) => {
    const key = projectId && map.has(projectId) ? projectId : '';
    let wf = memo.get(key);
    if (!wf) {
      wf = effectiveWorkflow(key || null, map).statuses;
      memo.set(key, wf);
    }
    return wf;
  };
}

export function firstOfCategory(
  wf: readonly WorkflowStatus[],
  category: Status,
): WorkflowStatus | undefined {
  return wf.find((s) => s.category === category);
}

/** Error message for an invalid workflow, or '' if it is valid. */
export function validateWorkflow(wf: readonly WorkflowStatus[]): string {
  if (!wf.length) return 'A workflow needs at least one status.';
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const s of wf) {
    if (!s.id) return 'Every status needs an id.';
    if (ids.has(s.id)) return `Duplicate status id “${s.id}”.`;
    ids.add(s.id);
    const n = s.name.trim();
    if (!n) return 'Status names are required.';
    if (n.length > STATUS_NAME_MAX)
      return `Status names must be at most ${STATUS_NAME_MAX} characters.`;
    const lower = n.toLocaleLowerCase();
    if (names.has(lower)) return `There is already a status named “${n}”.`;
    names.add(lower);
    if (!/^#[0-9a-fA-F]{6}$/.test(s.color)) return 'Status colours must be hex like #6366f1.';
    if (!STATUSES.includes(s.category)) return 'Unknown status category.';
  }
  for (const c of STATUSES)
    if (!wf.some((s) => s.category === c))
      return `A workflow needs at least one status in each category (missing: ${c.replace('_', ' ')}).`;
  return '';
}

/**
 * Keeps every task consistent with its project's (effective) workflow:
 * - `statusId` must exist in the workflow. If it doesn't (project moved, status deleted, workflow
 *   reset), the first status of the task's current category is used.
 * - `status` (the category) always equals the category of `statusId`, and `completedAt` is set when
 *   the category becomes `done` and cleared when it stops being `done`.
 * - A write that changed only the category (e.g. "mark done" from the list) is mapped to the first
 *   status of that category, so category-based actions keep working with custom workflows.
 * Returns `after` itself when nothing needed fixing.
 */
export function reconcileTasks(
  before: readonly Task[] | null,
  after: Task[],
  workflowOf: (projectId: string | null) => readonly WorkflowStatus[],
  nowIso: string,
): Task[] {
  const prev = before ? new Map(before.map((t) => [t.id, t])) : null;
  let changed = false;
  const out = after.map((t) => {
    const wf = workflowOf(t.projectId);
    const old = prev?.get(t.id);
    let target = wf.find((s) => s.id === t.statusId);
    if (target && target.category !== t.status) {
      const categoryOnly =
        old !== undefined && old.statusId === t.statusId && old.status !== t.status;
      if (categoryOnly) target = firstOfCategory(wf, t.status) ?? target;
    } else if (!target) {
      target = firstOfCategory(wf, t.status) ?? wf[0];
    }
    if (!target) return t;
    const status = target.category;
    let completedAt = t.completedAt;
    if (status === 'done' && !completedAt) completedAt = nowIso;
    if (status !== 'done' && completedAt) completedAt = null;
    if (target.id === t.statusId && status === t.status && completedAt === t.completedAt) return t;
    changed = true;
    return { ...t, statusId: target.id, status, completedAt };
  });
  return changed ? out : after;
}

/** Name of a status id, looked up across the default and all custom workflows. */
export function statusNameMap(projects: readonly Project[]): Map<string, WorkflowStatus> {
  const map = new Map<string, WorkflowStatus>(DEFAULT_WORKFLOW.map((s) => [s.id, s]));
  for (const p of projects) for (const s of p.workflow ?? []) if (!map.has(s.id)) map.set(s.id, s);
  return map;
}
