import type { ActivityEntry, AppNotification, AppState, Member, Priority, Project, Recurrence, SavedView, Settings, Subtask, Task, TaskComment, ThemeSetting, WorkflowStatus } from './types';
import { DEFAULT_SETTINGS, PRIORITIES, RECURRENCES, SCHEMA_VERSION, STATUSES } from './types';
import { validateWorkflow, workflowResolver } from './workflows';
import type { WorkflowResolver } from './workflows';
import { hasParentCycle } from './projects';
import { isValidISODate } from './dates';
import { ACTIVITY_TYPES, LOGGED_FIELDS } from './activity';
import { hasDependencyCycle } from './dependencies';
import { COMMENT_MAX } from './mentions';
import { VIEW_NAME_MAX, normalizeViewQuery } from './views';

export const LIMITS = { title: 120, description: 2000, tags: 8 } as const;

export interface TaskDraft {
  title: string;
  description: string;
  /** workflow status id */
  statusId: string;
  priority: Priority;
  projectId: string | null;
  tags: string[];
  dueDate: string | null;
  /** raw input value; '' means none */
  estimate: string;
  assigneeId: string | null;
  recurrence: Recurrence;
}

export interface TaskFormValue {
  title: string;
  description: string;
  /** workflow status id (the store derives the category) */
  statusId: string;
  priority: Priority;
  projectId: string | null;
  tags: string[];
  dueDate: string | null;
  estimateMinutes: number | null;
  assigneeId: string | null;
  recurrence: Recurrence;
}

export type TaskErrors = Partial<Record<'title' | 'description' | 'tags' | 'dueDate' | 'estimate', string>>;

/** Lower-case, trim, dedupe tags. */
export function normalizeTags(input: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of input) {
    const t = raw.trim().toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function parseTagInput(s: string): string[] {
  return normalizeTags(s.split(','));
}

export function validateTaskDraft(d: TaskDraft): TaskErrors {
  const e: TaskErrors = {};
  const title = d.title.trim();
  if (!title) e.title = 'Title is required.';
  else if (title.length > LIMITS.title) e.title = `Title must be at most ${LIMITS.title} characters (currently ${title.length}).`;
  if (d.description.length > LIMITS.description) e.description = `Description must be at most ${LIMITS.description} characters (currently ${d.description.length}).`;
  const tags = normalizeTags(d.tags);
  if (tags.length > LIMITS.tags) e.tags = `At most ${LIMITS.tags} tags allowed (currently ${tags.length}).`;
  if (d.dueDate && !isValidISODate(d.dueDate)) e.dueDate = 'Enter a valid date.';
  const est = d.estimate.trim();
  if (est !== '' && !/^\d+$/.test(est)) e.estimate = 'Estimate must be a positive whole number of minutes.';
  else if (est !== '' && Number(est) <= 0) e.estimate = 'Estimate must be greater than 0.';
  return e;
}

export function hasErrors(e: object): boolean {
  return Object.keys(e).length > 0;
}

// ---------- import validation ----------

export type ImportResult = { ok: true; state: AppState } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isIsoTs = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));

function checkProject(p: unknown, i: number, errors: string[]): p is Project {
  const at = `projects[${i}]`;
  if (!isObj(p)) return void errors.push(`${at} must be an object.`), false;
  const before = errors.length;
  if (!isStr(p.id) || !p.id) errors.push(`${at}.id must be a non-empty string.`);
  if (!isStr(p.name) || !p.name.trim()) errors.push(`${at}.name must be a non-empty string.`);
  if (!isStr(p.color) || !/^#[0-9a-fA-F]{6}$/.test(p.color)) errors.push(`${at}.color must be a hex colour like #6366f1.`);
  if (!isIsoTs(p.createdAt)) errors.push(`${at}.createdAt must be an ISO date string.`);
  // schema v2 fields; absent in v1 data (→ top level, inherited workflow)
  if (p.parentId !== undefined && p.parentId !== null && !isStr(p.parentId)) errors.push(`${at}.parentId must be null or a project id.`);
  if (p.workflow !== undefined && p.workflow !== null) {
    const ok = Array.isArray(p.workflow) && p.workflow.every((s) => isObj(s) && isStr(s.id) && isStr(s.name) && isStr(s.color) && isStr(s.category));
    const problem = ok ? validateWorkflow(p.workflow as WorkflowStatus[]) : 'statuses must be { id, name, color, category }';
    if (problem) errors.push(`${at}.workflow is invalid: ${problem}`);
  }
  return errors.length === before;
}

function checkMember(m: unknown, i: number, errors: string[]): m is Member {
  const at = `members[${i}]`;
  if (!isObj(m)) return void errors.push(`${at} must be an object.`), false;
  const before = errors.length;
  if (!isStr(m.id) || !m.id) errors.push(`${at}.id must be a non-empty string.`);
  if (!isStr(m.name) || !m.name.trim()) errors.push(`${at}.name must be a non-empty string.`);
  if (!isStr(m.color) || !/^#[0-9a-fA-F]{6}$/.test(m.color)) errors.push(`${at}.color must be a hex colour like #0ea5e9.`);
  return errors.length === before;
}

function checkSubtask(s: unknown, at: string, errors: string[]): s is Subtask {
  if (!isObj(s) || !isStr(s.id) || !isStr(s.title) || typeof s.done !== 'boolean') {
    errors.push(`${at} must be { id: string, title: string, done: boolean }.`);
    return false;
  }
  return true;
}

function checkComment(c: unknown, at: string, errors: string[]): c is TaskComment {
  if (!isObj(c) || !isStr(c.id) || !c.id || !isStr(c.authorId) || !c.authorId || !isStr(c.body) || !c.body.trim() || c.body.length > COMMENT_MAX || !isIsoTs(c.createdAt)) {
    errors.push(`${at} must be { id, authorId, body (1–${COMMENT_MAX} characters), createdAt (ISO) }.`);
    return false;
  }
  return true;
}

interface RefSets {
  projectIds: Set<string>;
  memberIds: Set<string>;
  taskIds: Set<unknown>;
}

/**
 * Validates one task. `assigneeId`, `recurrence`, `blockedBy` and `comments` were added after v1 shipped,
 * so they may be absent (older exports / persisted state) and get defaults.
 */
function checkTask(t: unknown, i: number, refs: RefSets, errors: string[]): t is Task {
  const { projectIds, memberIds, taskIds } = refs;
  const at = `tasks[${i}]`;
  if (!isObj(t)) return void errors.push(`${at} must be an object.`), false;
  const before = errors.length;
  if (!isStr(t.id) || !t.id) errors.push(`${at}.id must be a non-empty string.`);
  if (!isStr(t.title) || !t.title.trim() || t.title.length > LIMITS.title) errors.push(`${at}.title must be 1–${LIMITS.title} characters.`);
  if (!isStr(t.description) || t.description.length > LIMITS.description) errors.push(`${at}.description must be a string of at most ${LIMITS.description} characters.`);
  // v2 tasks carry statusId (checked against the workflow later); v1 tasks only a status category
  if (t.statusId !== undefined && (!isStr(t.statusId) || !t.statusId)) errors.push(`${at}.statusId must be a non-empty string.`);
  if (t.statusId === undefined && !(STATUSES as readonly unknown[]).includes(t.status)) errors.push(`${at}.status must be one of ${STATUSES.join(', ')}.`);
  if (!(PRIORITIES as readonly unknown[]).includes(t.priority)) errors.push(`${at}.priority must be one of ${PRIORITIES.join(', ')}.`);
  if (t.projectId !== null && !(isStr(t.projectId) && projectIds.has(t.projectId))) errors.push(`${at}.projectId must be null or reference an existing project.`);
  if (!Array.isArray(t.tags) || !t.tags.every(isStr) || t.tags.length > LIMITS.tags) errors.push(`${at}.tags must be an array of at most ${LIMITS.tags} strings.`);
  if (t.dueDate !== null && !(isStr(t.dueDate) && isValidISODate(t.dueDate))) errors.push(`${at}.dueDate must be null or YYYY-MM-DD.`);
  if (t.estimateMinutes !== null && !(Number.isInteger(t.estimateMinutes) && (t.estimateMinutes as number) > 0)) errors.push(`${at}.estimateMinutes must be null or a positive integer.`);
  if (typeof t.timeSpentMinutes !== 'number' || !(t.timeSpentMinutes >= 0)) errors.push(`${at}.timeSpentMinutes must be a non-negative number.`);
  if (!Array.isArray(t.subtasks)) errors.push(`${at}.subtasks must be an array.`);
  else t.subtasks.forEach((s, k) => checkSubtask(s, `${at}.subtasks[${k}]`, errors));
  if (!isIsoTs(t.createdAt)) errors.push(`${at}.createdAt must be an ISO date string.`);
  if (t.completedAt !== null && !isIsoTs(t.completedAt)) errors.push(`${at}.completedAt must be null or an ISO date string.`);
  if (typeof t.order !== 'number' || !Number.isFinite(t.order)) errors.push(`${at}.order must be a number.`);
  if (t.assigneeId !== undefined && t.assigneeId !== null && !(isStr(t.assigneeId) && memberIds.has(t.assigneeId))) errors.push(`${at}.assigneeId must be null or reference an existing member.`);
  if (t.recurrence !== undefined && !(RECURRENCES as readonly unknown[]).includes(t.recurrence)) errors.push(`${at}.recurrence must be one of ${RECURRENCES.join(', ')}.`);
  if (t.blockedBy !== undefined && !(Array.isArray(t.blockedBy) && t.blockedBy.every((id) => isStr(id) && id !== t.id && taskIds.has(id)) && new Set(t.blockedBy).size === t.blockedBy.length))
    errors.push(`${at}.blockedBy must be a list of other existing task ids without duplicates.`);
  if (t.comments !== undefined) {
    if (!Array.isArray(t.comments)) errors.push(`${at}.comments must be an array.`);
    else t.comments.forEach((c, k) => checkComment(c, `${at}.comments[${k}]`, errors));
  }
  return errors.length === before;
}

function checkActivity(e: unknown, i: number, errors: string[]): e is ActivityEntry {
  const at = `activity[${i}]`;
  const okValue = (v: unknown): boolean => v === undefined || v === null || isStr(v) || typeof v === 'number' || (Array.isArray(v) && v.every(isStr));
  if (
    !isObj(e) ||
    !isStr(e.id) ||
    !isStr(e.taskId) ||
    !(e.actorId === null || isStr(e.actorId)) ||
    !(ACTIVITY_TYPES as readonly unknown[]).includes(e.type) ||
    !(e.field === undefined || (LOGGED_FIELDS as readonly unknown[]).includes(e.field)) ||
    !okValue(e.from) ||
    !okValue(e.to) ||
    !isIsoTs(e.at)
  ) {
    errors.push(`${at} must be { id, taskId, actorId (string or null), type (${ACTIVITY_TYPES.join(', ')}), field?, from?, to?, at (ISO) }.`);
    return false;
  }
  return true;
}

function checkView(v: unknown, i: number, errors: string[]): v is SavedView {
  const at = `views[${i}]`;
  if (
    !isObj(v) ||
    !isStr(v.id) ||
    !v.id ||
    !isStr(v.name) ||
    !v.name.trim() ||
    v.name.length > VIEW_NAME_MAX ||
    !isObj(v.query) ||
    !Object.values(v.query).every(isStr) ||
    !isIsoTs(v.createdAt)
  ) {
    errors.push(`${at} must be { id, name (1–${VIEW_NAME_MAX} characters), query (object of strings), createdAt (ISO) }.`);
    return false;
  }
  return true;
}

const NOTIFICATION_TYPES = ['assigned', 'mentioned', 'due', 'unblocked'];

function checkNotification(n: unknown, i: number, errors: string[]): n is AppNotification {
  const okOpt = (v: unknown, pred: (x: unknown) => boolean): boolean => v === undefined || pred(v);
  if (
    !isObj(n) ||
    !isStr(n.id) ||
    !isStr(n.recipientId) ||
    !NOTIFICATION_TYPES.includes(n.type as string) ||
    !isStr(n.taskId) ||
    !(n.actorId === null || isStr(n.actorId)) ||
    !okOpt(n.activityId, isStr) ||
    !okOpt(n.day, (v) => isStr(v) && isValidISODate(v)) ||
    !okOpt(n.dueDate, (v) => isStr(v) && isValidISODate(v)) ||
    !okOpt(n.blockerId, isStr) ||
    !okOpt(n.remaining, (v) => Number.isInteger(v) && (v as number) >= 0) ||
    !isIsoTs(n.at) ||
    typeof n.read !== 'boolean'
  ) {
    errors.push(`notifications[${i}] must be { id, recipientId, type (${NOTIFICATION_TYPES.join(', ')}), taskId, actorId, at (ISO), read (boolean), … }.`);
    return false;
  }
  return true;
}

/** v2: statusId must be a status of the task's project workflow. v1: the category maps to the workflow. */
function checkTaskStatus(t: Task, i: number, wf: WorkflowResolver, errors: string[]): void {
  if (t.statusId !== undefined && !wf.statusOf(t.projectId, t.statusId))
    errors.push(`tasks[${i}].statusId “${t.statusId}” is not a status of its project's workflow.`);
}

function taskStatusFields(t: Task, wf: WorkflowResolver): Pick<Task, 'statusId' | 'status'> {
  const s = t.statusId !== undefined ? wf.resolve(t.projectId, t.statusId) : wf.firstOfCategory(t.projectId, t.status);
  return { statusId: s.id, status: s.category };
}

function checkSettings(s: unknown, errors: string[]): Settings {
  if (s === undefined) return { ...DEFAULT_SETTINGS };
  if (!isObj(s)) {
    errors.push('settings must be an object.');
    return { ...DEFAULT_SETTINGS };
  }
  const theme = s.theme as ThemeSetting;
  if (!['light', 'dark', 'system'].includes(theme)) errors.push('settings.theme must be light, dark or system.');
  if (!Number.isInteger(s.pomodoroMinutes) || (s.pomodoroMinutes as number) < 1 || (s.pomodoroMinutes as number) > 180) errors.push('settings.pomodoroMinutes must be an integer between 1 and 180.');
  if (!Number.isInteger(s.pageSize) || (s.pageSize as number) < 5 || (s.pageSize as number) > 200) errors.push('settings.pageSize must be an integer between 5 and 200.');
  // currentUserId was added later; absent → the default.
  if (s.currentUserId !== undefined && s.currentUserId !== null && !isStr(s.currentUserId)) errors.push('settings.currentUserId must be a string or null.');
  const currentUserId = s.currentUserId === undefined ? DEFAULT_SETTINGS.currentUserId : (s.currentUserId as string | null);
  return { theme, pomodoroMinutes: s.pomodoroMinutes as number, pageSize: s.pageSize as number, currentUserId };
}

const MAX_REPORTED = 8;

/** Validate untrusted JSON (string or parsed) against the AppState schema. */
export function validateImport(input: unknown): ImportResult {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (err) {
      return { ok: false, errors: [`File is not valid JSON: ${(err as Error).message}`] };
    }
  }
  if (!isObj(data)) return { ok: false, errors: ['Top level must be an object with "tasks", "projects", "members", "activity" and "settings".'] };
  const errors: string[] = [];
  // v1 exports have no schemaVersion; refuse files from a newer version instead of mangling them
  if (data.schemaVersion !== undefined && !(Number.isInteger(data.schemaVersion) && (data.schemaVersion as number) >= 1))
    return { ok: false, errors: ['"schemaVersion" must be a positive integer.'] };
  if (typeof data.schemaVersion === 'number' && data.schemaVersion > SCHEMA_VERSION)
    return { ok: false, errors: [`This file was exported by a newer version of TaskPilot (schema ${data.schemaVersion}); this version reads up to ${SCHEMA_VERSION}.`] };
  if (!Array.isArray(data.tasks)) errors.push('"tasks" must be an array.');
  if (!Array.isArray(data.projects)) errors.push('"projects" must be an array.');
  // "members" was added later: optional for backwards compatibility.
  if (data.members !== undefined && !Array.isArray(data.members)) errors.push('"members" must be an array when present.');
  if (data.activity !== undefined && !Array.isArray(data.activity)) errors.push('"activity" must be an array when present.');
  if (data.views !== undefined && !Array.isArray(data.views)) errors.push('"views" must be an array when present.');
  if (data.notifications !== undefined && !Array.isArray(data.notifications)) errors.push('"notifications" must be an array when present.');
  if (errors.length) return { ok: false, errors };
  const projects = data.projects as unknown[];
  const members = (data.members ?? []) as unknown[];
  const tasks = data.tasks as unknown[];
  const activity = (data.activity ?? []) as unknown[];
  const views = (data.views ?? []) as unknown[];
  const notifications = (data.notifications ?? []) as unknown[];
  projects.forEach((p, i) => checkProject(p, i, errors));
  const projectIds = new Set(projects.filter(isObj).map((p) => p.id).filter(isStr));
  if (projectIds.size !== projects.length && errors.length === 0) errors.push('Project ids must be unique.');
  projects.forEach((p, i) => {
    if (isObj(p) && isStr(p.parentId) && !projectIds.has(p.parentId)) errors.push(`projects[${i}].parentId must reference an existing project.`);
  });
  if (errors.length === 0 && hasParentCycle((projects as Project[]).map((p) => ({ id: p.id, parentId: p.parentId ?? null }))))
    errors.push('Project parents must not form a cycle.');
  const normalizedProjects: Project[] = errors.length
    ? []
    : (projects as Project[]).map((p) => ({ id: p.id, name: p.name, color: p.color, createdAt: p.createdAt, parentId: p.parentId ?? null, workflow: p.workflow ?? null }));
  const wf = workflowResolver(normalizedProjects);
  members.forEach((m, i) => checkMember(m, i, errors));
  const memberIds = new Set(members.filter(isObj).map((m) => m.id).filter(isStr));
  if (memberIds.size !== members.length && errors.length === 0) errors.push('Member ids must be unique.');
  const taskIds = new Set(tasks.filter(isObj).map((t) => t.id));
  tasks.forEach((t, i) => checkTask(t, i, { projectIds, memberIds, taskIds }, errors));
  if (errors.length === 0) (tasks as Task[]).forEach((t, i) => checkTaskStatus(t, i, wf, errors));
  if (taskIds.size !== tasks.length && errors.length === 0) errors.push('Task ids must be unique.');
  if (errors.length === 0 && hasDependencyCycle((tasks as Task[]).map((t) => ({ id: t.id, blockedBy: t.blockedBy ?? [] }))))
    errors.push('Task dependencies (blockedBy) must not form a cycle.');
  activity.forEach((e, i) => checkActivity(e, i, errors));
  views.forEach((v, i) => checkView(v, i, errors));
  notifications.forEach((n, i) => checkNotification(n, i, errors));
  if (new Set(views.filter(isObj).map((v) => v.id)).size !== views.length && errors.length === 0) errors.push('View ids must be unique.');
  const settings = checkSettings(data.settings, errors);
  if (errors.length) {
    const extra = errors.length - MAX_REPORTED;
    return { ok: false, errors: extra > 0 ? [...errors.slice(0, MAX_REPORTED), `…and ${extra} more problem(s).`] : errors };
  }
  return {
    ok: true,
    state: {
      projects: normalizedProjects,
      members: (members as Member[]).map((m) => ({ id: m.id, name: m.name, color: m.color })),
      tasks: (tasks as Task[]).map((t) => ({
        ...t,
        ...taskStatusFields(t, wf),
        tags: normalizeTags(t.tags),
        assigneeId: t.assigneeId ?? null,
        recurrence: t.recurrence ?? 'none',
        blockedBy: t.blockedBy ?? [],
        comments: t.comments ?? [],
      })),
      activity: activity as ActivityEntry[],
      notifications: notifications as AppNotification[],
      views: (views as SavedView[]).map((v) => ({ id: v.id, name: v.name, query: normalizeViewQuery(v.query), createdAt: v.createdAt })),
      settings,
    },
  };
}
