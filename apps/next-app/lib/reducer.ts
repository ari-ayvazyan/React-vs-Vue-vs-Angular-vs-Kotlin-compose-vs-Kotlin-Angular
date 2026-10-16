import { findCycle, openBlockers, taskMap } from './dependencies';
import { spawnRecurrences } from './recurrence';
import type { ActivityEntry, AppState, Comment, Member, Project, SavedView, Settings, StatusCategory, Task } from './types';
import {
  descendantIds,
  effectiveWorkflow,
  findStatus,
  projectMap,
  reconcileTasks,
  statusForCategory,
  validateWorkflow,
  wouldCreateCycle,
  workflowResolver,
} from './workflow';

/** The undoable part of the app state. */
export interface Data {
  tasks: Task[];
  projects: Project[];
  members: Member[];
  /** Recorded by TaskStore around every dispatched action (see lib/activity.ts). */
  activity: ActivityEntry[];
  views: SavedView[];
}

export type DataAction =
  | { type: 'task/create'; task: Task }
  /** `patch.statusId` must be a status of the task's (new) project's workflow; unknown ids map by category. */
  | { type: 'task/update'; id: string; patch: Partial<Omit<Task, 'id' | 'category' | 'order' | 'completedAt'>>; at: string }
  | { type: 'task/bulkUpdate'; ids: string[]; patch: Partial<Pick<Task, 'projectId' | 'assigneeId'>>; at: string }
  /** Moves tasks to the first status of `category` in their own workflow ("mark done", "reopen"). */
  | { type: 'task/setCategory'; ids: string[]; category: StatusCategory; at: string }
  | { type: 'task/delete'; ids: string[] }
  /** Board DnD: `index` is the position among all tasks of the target status's category. */
  | { type: 'task/move'; id: string; statusId: string; index: number; at: string }
  | { type: 'task/addTime'; id: string; minutes: number }
  | { type: 'task/addBlocker'; id: string; blockerId: string }
  | { type: 'task/removeBlocker'; id: string; blockerId: string }
  | { type: 'task/addComment'; id: string; comment: Comment }
  | { type: 'project/create'; project: Project }
  | { type: 'project/update'; id: string; patch: Partial<Pick<Project, 'name' | 'color' | 'parentId' | 'workflow'>>; at: string }
  /** `mode`: what happens to the deleted projects' tasks; `children`: lift sub-projects one level up, or delete them too. */
  | { type: 'project/delete'; id: string; mode: 'unassign' | 'delete'; children: 'lift' | 'delete'; at: string }
  /** Removes a status from a customised workflow, moving its tasks (also in inheriting sub-projects) to `targetId`. */
  | { type: 'workflow/deleteStatus'; projectId: string; statusId: string; targetId: string; at: string }
  | { type: 'member/create'; member: Member }
  | { type: 'member/update'; id: string; patch: Partial<Pick<Member, 'name' | 'color'>> }
  | { type: 'member/delete'; id: string }
  | { type: 'view/create'; view: SavedView }
  | { type: 'view/update'; id: string; patch: Partial<Pick<SavedView, 'name' | 'search'>> }
  | { type: 'view/delete'; id: string }
  | { type: 'data/replace'; data: Data };

export type SettingsAction = { type: 'settings/update'; patch: Partial<Settings> };

/** Moves a task to `statusId` at position `index` within that status's category column (board DnD). */
export function moveTask(tasks: Task[], id: string, statusId: string, index: number, at: string, projects: Project[] = []): Task[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return tasks;
  const status = findStatus(effectiveWorkflow(projectMap(projects), task.projectId), statusId);
  if (!status) return tasks;
  const category = status.category;
  const column = tasks.filter((t) => t.category === category && t.id !== id).sort((a, b) => a.order - b.order);
  const i = Math.max(0, Math.min(index, column.length));
  const moved: Task = {
    ...task,
    statusId,
    category,
    completedAt: category === task.category ? task.completedAt : category === 'done' ? at : null,
  };
  column.splice(i, 0, moved);
  const updates = new Map<string, Task>();
  column.forEach((t, order) => {
    if (t === moved || t.order !== order) updates.set(t.id, { ...t, order });
  });
  // No-op move: same status, same place.
  if (statusId === task.statusId && updates.size === 1 && updates.get(id)!.order === task.order) return tasks;
  return tasks.map((t) => updates.get(t.id) ?? t);
}

/**
 * The completion rule, enforced for every action (UI checks first to explain why): a task whose
 * blockers were still open before the action never ends up in the done category. Offending
 * tasks are put back into their previous category (same status when it still exists).
 */
function enforceBlockers(before: Task[], after: Task[], projects: Project[]): Task[] {
  if (before === after) return after;
  const prev = taskMap(before);
  const resolve = workflowResolver(projects);
  let changed = false;
  const out = after.map((t) => {
    const p = prev.get(t.id);
    if (!p || p.category === 'done' || t.category !== 'done' || !openBlockers(p, prev).length) return t;
    changed = true;
    return {
      ...t,
      statusId: statusForCategory(resolve(t.projectId), p.category, p.statusId),
      category: p.category,
      completedAt: p.completedAt,
      order: p.order,
    };
  });
  return changed ? out : after;
}

/** Removes deleted ids from every remaining task's blockers. */
function withoutBlockers(tasks: Task[], removed: Set<string>): Task[] {
  if (!removed.size) return tasks;
  return tasks.map((t) => (t.blockedBy.some((id) => removed.has(id)) ? { ...t, blockedBy: t.blockedBy.filter((id) => !removed.has(id)) } : t));
}

/**
 * Common tail of every task/project mutation: reconcile statuses with the workflows, enforce
 * blockers, and (for actions that can complete tasks) create next occurrences of recurring tasks.
 */
function settle(state: Data, tasks: Task[], projects: Project[], at: string, completing?: Iterable<string>): Data {
  let next = reconcileTasks(tasks, projects, at);
  next = enforceBlockers(state.tasks, next, projects);
  // Completing a recurring task creates its next occurrence in the same (single-undo) step.
  if (completing) next = spawnRecurrences(state.tasks, next, completing, at, projects);
  if (next === state.tasks && projects === state.projects) return state;
  return { ...state, tasks: next, projects };
}

/** True when moving `task` to `statusId` (in `projectId`'s workflow) would complete it while its blockers are open. */
function completesTask(state: Data, task: Task, projectId: string | null, statusId: string): boolean {
  const status = findStatus(effectiveWorkflow(projectMap(state.projects), projectId), statusId);
  return status?.category === 'done' && openBlockers(task, taskMap(state.tasks)).length > 0;
}

function validProject(projects: Project[], p: Project): boolean {
  if (p.parentId !== null && (!projects.some((x) => x.id === p.parentId) || wouldCreateCycle(projects, p.id, p.parentId))) return false;
  return p.workflow === null || validateWorkflow(p.workflow) === null;
}

export function dataReducer(state: Data, action: DataAction): Data {
  switch (action.type) {
    case 'task/create':
      return settle(state, [...state.tasks, action.task], state.projects, action.task.createdAt);
    case 'task/update': {
      const task = state.tasks.find((t) => t.id === action.id);
      if (!task) return state;
      const patch = { ...action.patch };
      // Completing a blocked task is refused up front (other fields of the patch still apply).
      if (patch.statusId !== undefined && task.category !== 'done' && completesTask(state, task, patch.projectId === undefined ? task.projectId : patch.projectId, patch.statusId))
        delete patch.statusId;
      if (!Object.keys(patch).length) return state;
      const tasks = state.tasks.map((t) => (t === task ? { ...t, ...patch } : t));
      return settle(state, tasks, state.projects, action.at, [action.id]);
    }
    case 'task/bulkUpdate': {
      const ids = new Set(action.ids);
      if (!ids.size || !Object.keys(action.patch).length) return state;
      return settle(state, state.tasks.map((t) => (ids.has(t.id) ? { ...t, ...action.patch } : t)), state.projects, action.at);
    }
    case 'task/setCategory': {
      const ids = new Set(action.ids);
      const resolve = workflowResolver(state.projects);
      let changed = false;
      const byId = taskMap(state.tasks);
      const tasks = state.tasks.map((t) => {
        if (!ids.has(t.id) || t.category === action.category) return t;
        // Blocked tasks are skipped (judged on the state before the action).
        if (action.category === 'done' && openBlockers(t, byId).length) return t;
        changed = true;
        return { ...t, statusId: statusForCategory(resolve(t.projectId), action.category) };
      });
      return changed ? settle(state, tasks, state.projects, action.at, action.ids) : state;
    }
    case 'task/delete': {
      const ids = new Set(action.ids);
      const tasks = state.tasks.filter((t) => !ids.has(t.id));
      return tasks.length === state.tasks.length ? state : { ...state, tasks: withoutBlockers(tasks, ids) };
    }
    case 'task/move': {
      const byId = taskMap(state.tasks);
      const task = byId.get(action.id);
      if (!task) return state;
      const target = findStatus(effectiveWorkflow(projectMap(state.projects), task.projectId), action.statusId);
      // Refuse the whole move (no column renumbering) when it would complete a blocked task.
      if (!target || (target.category === 'done' && task.category !== 'done' && openBlockers(task, byId).length)) return state;
      const tasks = moveTask(state.tasks, action.id, action.statusId, action.index, action.at, state.projects);
      return tasks === state.tasks ? state : settle(state, tasks, state.projects, action.at, [action.id]);
    }
    case 'task/addTime':
      if (action.minutes <= 0) return state;
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, timeSpentMinutes: t.timeSpentMinutes + action.minutes } : t)),
      };
    case 'task/addBlocker': {
      const byId = taskMap(state.tasks);
      const task = byId.get(action.id);
      if (!task || !byId.has(action.blockerId) || task.blockedBy.includes(action.blockerId)) return state;
      if (findCycle(byId, action.id, action.blockerId)) return state;
      return { ...state, tasks: state.tasks.map((t) => (t === task ? { ...t, blockedBy: [...t.blockedBy, action.blockerId] } : t)) };
    }
    case 'task/removeBlocker': {
      let changed = false;
      const tasks = state.tasks.map((t) => {
        if (t.id !== action.id || !t.blockedBy.includes(action.blockerId)) return t;
        changed = true;
        return { ...t, blockedBy: t.blockedBy.filter((id) => id !== action.blockerId) };
      });
      return changed ? { ...state, tasks } : state;
    }
    case 'task/addComment': {
      if (!action.comment.body.trim()) return state;
      let changed = false;
      const tasks = state.tasks.map((t) => {
        if (t.id !== action.id) return t;
        changed = true;
        return { ...t, comments: [...t.comments, action.comment] };
      });
      return changed ? { ...state, tasks } : state;
    }
    case 'project/create': {
      const projects = [...state.projects, action.project];
      return validProject(projects, action.project) ? { ...state, projects } : state;
    }
    case 'project/update': {
      const old = state.projects.find((p) => p.id === action.id);
      if (!old) return state;
      const updated = { ...old, ...action.patch };
      const projects = state.projects.map((p) => (p === old ? updated : p));
      if (!validProject(projects, updated)) return state;
      // Parent or workflow changes can change which statuses tasks (also in sub-projects) may use.
      return settle(state, state.tasks, projects, action.at);
    }
    case 'project/delete': {
      const target = state.projects.find((p) => p.id === action.id);
      if (!target) return state;
      const removed = action.children === 'delete' ? descendantIds(state.projects, action.id) : new Set([action.id]);
      const projects = state.projects
        .filter((p) => !removed.has(p.id))
        .map((p) => {
          if (p.parentId !== action.id) return p;
          // Lift a direct child one level up. If it inherited the deleted project's own workflow,
          // keep that workflow (copy it) so its tasks keep their statuses.
          return { ...p, parentId: target.parentId, workflow: p.workflow ?? (target.workflow ? target.workflow.map((s) => ({ ...s })) : null) };
        });
      const gone = new Set(state.tasks.filter((t) => t.projectId !== null && removed.has(t.projectId)).map((t) => t.id));
      const tasks =
        action.mode === 'delete'
          ? withoutBlockers(
              state.tasks.filter((t) => !gone.has(t.id)),
              gone,
            )
          : state.tasks.map((t) => (gone.has(t.id) ? { ...t, projectId: null } : t));
      return settle(state, tasks, projects, action.at);
    }
    case 'workflow/deleteStatus': {
      const owner = state.projects.find((p) => p.id === action.projectId);
      const wf = owner?.workflow;
      if (!owner || !wf || action.statusId === action.targetId || !findStatus(wf, action.statusId) || !findStatus(wf, action.targetId)) return state;
      const workflow = wf.filter((s) => s.id !== action.statusId);
      if (validateWorkflow(workflow)) return state;
      // Tasks of this project and of sub-projects inheriting its workflow.
      const byId = projectMap(state.projects);
      const resolve = workflowResolver(state.projects);
      const uses = (projectId: string | null) => projectId !== null && resolve(projectId) === effectiveWorkflow(byId, owner.id);
      const tasks = state.tasks.map((t) => (t.statusId === action.statusId && uses(t.projectId) ? { ...t, statusId: action.targetId } : t));
      const projects = state.projects.map((p) => (p === owner ? { ...p, workflow } : p));
      return settle(state, tasks, projects, action.at);
    }
    case 'member/create':
      return { ...state, members: [...state.members, action.member] };
    case 'member/update':
      return { ...state, members: state.members.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)) };
    case 'member/delete': {
      if (!state.members.some((m) => m.id === action.id)) return state;
      return {
        ...state,
        members: state.members.filter((m) => m.id !== action.id),
        tasks: state.tasks.map((t) => (t.assigneeId === action.id ? { ...t, assigneeId: null } : t)),
      };
    }
    case 'view/create':
      return { ...state, views: [...state.views, action.view] };
    case 'view/update': {
      const v = state.views.find((x) => x.id === action.id);
      if (!v || Object.entries(action.patch).every(([k, val]) => v[k as keyof SavedView] === val)) return state;
      return { ...state, views: state.views.map((x) => (x === v ? { ...x, ...action.patch } : x)) };
    }
    case 'view/delete':
      return state.views.some((v) => v.id === action.id) ? { ...state, views: state.views.filter((v) => v.id !== action.id) } : state;
    case 'data/replace':
      return action.data;
  }
}

export function settingsReducer(state: AppState, action: SettingsAction): AppState {
  return { ...state, settings: { ...state.settings, ...action.patch } };
}
