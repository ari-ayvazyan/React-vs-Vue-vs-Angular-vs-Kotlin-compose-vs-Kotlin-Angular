import type { Project, StatusCategory, Task, WorkflowStatus } from './types';
import { STATUSES } from './types';

/** The workflow of projects that don't define one (and of tasks without a project). Ids equal the categories. */
export const DEFAULT_WORKFLOW: readonly WorkflowStatus[] = Object.freeze([
  Object.freeze({ id: 'todo', name: 'To do', color: '#64748b', category: 'todo' as const }),
  Object.freeze({ id: 'in_progress', name: 'In progress', color: '#2563eb', category: 'in_progress' as const }),
  Object.freeze({ id: 'done', name: 'Done', color: '#059669', category: 'done' as const }),
]);

export const CATEGORY_LABELS: Record<StatusCategory, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
export const STATUS_NAME_MAX = 30;
export const WORKFLOW_MAX_STATUSES = 12;

/**
 * Resolves effective workflows (own, else the nearest ancestor's, else the default) with per-project memoisation.
 * Create one per project list; it is cheap.
 */
export interface WorkflowResolver {
  /** effective workflow for a project id (null/unknown → default) */
  workflowOf(projectId: string | null): readonly WorkflowStatus[];
  /** project whose own workflow is used by `projectId` (null → the default workflow) */
  sourceOf(projectId: string | null): string | null;
  /** the status with this id in the project's workflow */
  statusOf(projectId: string | null, statusId: string): WorkflowStatus | undefined;
  /** first status of a category in the project's workflow (falls back to the first status) */
  firstOfCategory(projectId: string | null, category: StatusCategory): WorkflowStatus;
  /**
   * A valid status id for a project given a status id *or* a category name: the id itself when it exists,
   * otherwise the first status of that category (or of `fallback`).
   */
  resolve(projectId: string | null, idOrCategory: string, fallback?: StatusCategory): WorkflowStatus;
}

export function workflowResolver(projects: readonly Pick<Project, 'id' | 'parentId' | 'workflow'>[]): WorkflowResolver {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const sources = new Map<string, string | null>();
  const sourceOf = (projectId: string | null): string | null => {
    if (!projectId || !byId.has(projectId)) return null;
    const cached = sources.get(projectId);
    if (cached !== undefined) return cached;
    const seen = new Set<string>();
    let cur: string | null = projectId;
    let found: string | null = null;
    while (cur && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const p = byId.get(cur) as Project;
      if (p.workflow) {
        found = cur;
        break;
      }
      cur = p.parentId;
    }
    sources.set(projectId, found);
    return found;
  };
  const workflowOf = (projectId: string | null): readonly WorkflowStatus[] => {
    const src = sourceOf(projectId);
    return src ? ((byId.get(src) as Project).workflow as WorkflowStatus[]) : DEFAULT_WORKFLOW;
  };
  const statusOf = (projectId: string | null, statusId: string): WorkflowStatus | undefined => workflowOf(projectId).find((s) => s.id === statusId);
  const firstOfCategory = (projectId: string | null, category: StatusCategory): WorkflowStatus => {
    const wf = workflowOf(projectId);
    return wf.find((s) => s.category === category) ?? (wf[0] as WorkflowStatus);
  };
  const resolve = (projectId: string | null, idOrCategory: string, fallback: StatusCategory = 'todo'): WorkflowStatus => {
    const own = statusOf(projectId, idOrCategory);
    if (own) return own;
    const cat = (STATUSES as readonly string[]).includes(idOrCategory) ? (idOrCategory as StatusCategory) : fallback;
    return firstOfCategory(projectId, cat);
  };
  return { workflowOf, sourceOf, statusOf, firstOfCategory, resolve };
}

/** Error message for a workflow, or '' when valid. */
export function validateWorkflow(statuses: readonly WorkflowStatus[]): string {
  if (statuses.length === 0) return 'A workflow needs at least one status.';
  if (statuses.length > WORKFLOW_MAX_STATUSES) return `A workflow can have at most ${WORKFLOW_MAX_STATUSES} statuses.`;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const s of statuses) {
    if (!s.id) return 'Every status needs an id.';
    if (ids.has(s.id)) return `Duplicate status id “${s.id}”.`;
    ids.add(s.id);
    const n = s.name.trim();
    if (!n) return 'Status names are required.';
    if (n.length > STATUS_NAME_MAX) return `Status names can be at most ${STATUS_NAME_MAX} characters.`;
    if (names.has(n.toLowerCase())) return `There is already a status called “${n}”.`;
    names.add(n.toLowerCase());
    if (!/^#[0-9a-fA-F]{6}$/.test(s.color)) return `“${n}” needs a hex colour like #2563eb.`;
    if (!(STATUSES as readonly string[]).includes(s.category)) return `“${n}” has an unknown category.`;
  }
  if (!statuses.some((s) => s.category === 'todo')) return 'A workflow needs at least one “To do” status (new tasks start there).';
  if (!statuses.some((s) => s.category === 'done')) return 'A workflow needs at least one “Done” status.';
  return '';
}

/** Apply a workflow status to a task: category and completedAt follow the status. */
export function withWorkflowStatus(task: Task, status: WorkflowStatus, nowISO: string): Task {
  if (task.statusId === status.id && task.status === status.category) return task;
  const becomesDone = status.category === 'done';
  const completedAt = becomesDone ? (task.status === 'done' && task.completedAt ? task.completedAt : nowISO) : null;
  return { ...task, statusId: status.id, status: status.category, completedAt };
}

/**
 * Enforce the status invariants for every task: `statusId` exists in the effective workflow of the task's project
 * (otherwise the first status of the task's current category is used), `status` is that status's category and
 * `completedAt` is set exactly for done tasks. Unchanged tasks keep their identity; returns `tasks` itself when
 * nothing changed.
 */
export function normalizeTasks(tasks: Task[], projects: readonly Project[], nowISO: string): Task[] {
  const wf = workflowResolver(projects);
  let changed = false;
  const out = tasks.map((t) => {
    const status = wf.resolve(t.projectId, t.statusId, t.status);
    let next = withWorkflowStatus(t, status, nowISO);
    if (next.status === 'done' && !next.completedAt) next = { ...next, completedAt: nowISO };
    if (next.status !== 'done' && next.completedAt) next = { ...next, completedAt: null };
    if (next !== t) changed = true;
    return next;
  });
  return changed ? out : tasks;
}

/** Copy of a workflow (for "customize": ids are kept so tasks keep their statuses). */
export function copyWorkflow(statuses: readonly WorkflowStatus[]): WorkflowStatus[] {
  return statuses.map((s) => ({ ...s }));
}

/** Move a status one position up/down. */
export function moveStatus(statuses: readonly WorkflowStatus[], id: string, dir: -1 | 1): WorkflowStatus[] {
  const i = statuses.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= statuses.length) return [...statuses];
  const out = [...statuses];
  [out[i], out[j]] = [out[j] as WorkflowStatus, out[i] as WorkflowStatus];
  return out;
}

/** Projects whose effective workflow is `projectId`'s own workflow (the project and descendants that inherit it). */
export function projectsUsingWorkflowOf(projects: readonly Project[], projectId: string): Set<string> {
  const wf = workflowResolver(projects);
  return new Set(projects.filter((p) => wf.sourceOf(p.id) === projectId).map((p) => p.id));
}
