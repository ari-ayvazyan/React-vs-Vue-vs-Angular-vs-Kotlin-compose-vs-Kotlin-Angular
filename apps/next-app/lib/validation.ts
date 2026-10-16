import { isValidDateKey } from './dates';
import { graphCycle } from './dependencies';
import { COMMENT_MAX } from './mentions';
import { normalizeSearch } from './views';
import {
  DEFAULT_SETTINGS,
  PRIORITIES,
  ACTIVITY_TYPES,
  RECURRENCES,
  STATUSES,
  TRACKED_FIELDS,
  type ActivityEntry,
  type ActivityValue,
  type AppState,
  type Comment,
  type Notification,
  type SavedView,
  type Member,
  type Priority,
  type Project,
  type Recurrence,
  type Settings,
  type Subtask,
  type Task,
  type WorkflowStatus,
  SCHEMA_VERSION,
} from './types';
import { findStatus, validateWorkflow, workflowResolver, wouldCreateCycle } from './workflow';

export const LIMITS = { title: 120, description: 2000, tags: 8 } as const;

/** Raw form values for creating / editing a task. */
export interface TaskDraft {
  title: string;
  description: string;
  /** workflow status id (of the selected project's workflow) */
  status: string;
  priority: Priority;
  projectId: string;
  tags: string;
  dueDate: string;
  estimate: string;
  /** member id, '' = unassigned */
  assigneeId: string;
  recurrence: Recurrence;
}

export type DraftErrors = Partial<Record<keyof TaskDraft, string>>;

export function parseTags(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function draftFromTask(task: Task | null, defaults?: Partial<TaskDraft>): TaskDraft {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    status: task?.statusId ?? 'todo',
    priority: task?.priority ?? 'medium',
    projectId: task?.projectId ?? '',
    tags: task?.tags.join(', ') ?? '',
    dueDate: task?.dueDate ?? '',
    estimate: task?.estimateMinutes != null ? String(task.estimateMinutes) : '',
    assigneeId: task?.assigneeId ?? '',
    recurrence: task?.recurrence ?? 'none',
    ...defaults,
  };
}

export function validateDraft(d: TaskDraft): DraftErrors {
  const e: DraftErrors = {};
  const title = d.title.trim();
  if (!title) e.title = 'Title is required.';
  else if (title.length > LIMITS.title) e.title = `Title must be at most ${LIMITS.title} characters (currently ${title.length}).`;
  if (d.description.length > LIMITS.description)
    e.description = `Description must be at most ${LIMITS.description} characters (currently ${d.description.length}).`;
  const tags = parseTags(d.tags);
  if (tags.length > LIMITS.tags) e.tags = `At most ${LIMITS.tags} tags allowed (currently ${tags.length}).`;
  const est = d.estimate.trim();
  if (est && (!/^\d+$/.test(est) || Number(est) <= 0)) e.estimate = 'Estimate must be a positive whole number of minutes.';
  if (d.dueDate && !isValidDateKey(d.dueDate)) e.dueDate = 'Enter a valid date.';
  return e;
}

/** Fields of a task derived from a valid draft. */
export function draftToFields(d: TaskDraft): Pick<
  Task,
  'title' | 'description' | 'statusId' | 'priority' | 'projectId' | 'tags' | 'dueDate' | 'estimateMinutes' | 'assigneeId' | 'recurrence'
> {
  const est = d.estimate.trim();
  return {
    title: d.title.trim(),
    description: d.description,
    statusId: d.status,
    priority: d.priority,
    projectId: d.projectId || null,
    tags: parseTags(d.tags),
    dueDate: d.dueDate || null,
    estimateMinutes: est ? Number(est) : null,
    assigneeId: d.assigneeId || null,
    recurrence: d.recurrence,
  };
}

// ---------------------------------------------------------------------------
// Import validation

export type ImportResult = { ok: true; state: AppState } | { ok: false; error: string };

class ImportError extends Error {}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(o: Record<string, unknown>, k: string, path: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new ImportError(`${path}.${k} must be a string.`);
  return v;
}

function nullableStr(o: Record<string, unknown>, k: string, path: string): string | null {
  const v = o[k];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new ImportError(`${path}.${k} must be a string or null.`);
  return v;
}

function isoDate(o: Record<string, unknown>, k: string, path: string, nullable: boolean): string | null {
  const v = nullable ? nullableStr(o, k, path) : str(o, k, path);
  if (v !== null && Number.isNaN(Date.parse(v))) throw new ImportError(`${path}.${k} must be an ISO date-time.`);
  return v;
}

function validateProject(v: unknown, path: string): Project {
  if (!isObj(v)) throw new ImportError(`${path} must be an object.`);
  const color = str(v, 'color', path);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new ImportError(`${path}.color must be a hex colour like #6366f1.`);
  const name = str(v, 'name', path).trim();
  if (!name) throw new ImportError(`${path}.name must not be empty.`);
  // v1 exports have neither field: top-level project with the default workflow.
  const parentId = nullableStr(v, 'parentId', path);
  let workflow: WorkflowStatus[] | null = null;
  if (v.workflow !== undefined && v.workflow !== null) {
    if (!Array.isArray(v.workflow)) throw new ImportError(`${path}.workflow must be an array or null.`);
    workflow = v.workflow.map((s, i) => validateWorkflowStatus(s, `${path}.workflow[${i}]`));
    const err = validateWorkflow(workflow);
    if (err) throw new ImportError(`${path}.workflow: ${err}`);
  }
  return { id: str(v, 'id', path), name, color, createdAt: isoDate(v, 'createdAt', path, false)!, parentId, workflow };
}

function validateWorkflowStatus(v: unknown, path: string): WorkflowStatus {
  if (!isObj(v)) throw new ImportError(`${path} must be an object.`);
  const category = v.category as WorkflowStatus['category'];
  if (!STATUSES.includes(category)) throw new ImportError(`${path}.category must be one of ${STATUSES.join(', ')}.`);
  return { id: str(v, 'id', path), name: str(v, 'name', path).trim(), color: str(v, 'color', path), category };
}

function validateMember(v: unknown, path: string): Member {
  if (!isObj(v)) throw new ImportError(`${path} must be an object.`);
  const color = str(v, 'color', path);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new ImportError(`${path}.color must be a hex colour like #0ea5e9.`);
  const name = str(v, 'name', path).trim();
  if (!name) throw new ImportError(`${path}.name must not be empty.`);
  return { id: str(v, 'id', path), name, color };
}

function validateComment(v: unknown, path: string): Comment {
  if (!isObj(v)) throw new ImportError(`${path} must be an object.`);
  const body = str(v, 'body', path);
  if (!body.trim() || body.length > COMMENT_MAX) throw new ImportError(`${path}.body must be 1–${COMMENT_MAX} characters.`);
  // The author may have been deleted since; the comment is kept and shown as "removed member".
  return { id: str(v, 'id', path), authorId: str(v, 'authorId', path), body, createdAt: isoDate(v, 'createdAt', path, false)! };
}

function activityValue(v: unknown, path: string): ActivityValue | undefined {
  if (v === undefined || v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) return v as ActivityValue | undefined;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  throw new ImportError(`${path} must be a string, number, string array or null.`);
}

function validateActivity(v: unknown, path: string): ActivityEntry {
  if (!isObj(v)) throw new ImportError(`${path} must be an object.`);
  const type = v.type as ActivityEntry['type'];
  if (!ACTIVITY_TYPES.includes(type)) throw new ImportError(`${path}.type must be one of ${ACTIVITY_TYPES.join(', ')}.`);
  const field = v.field as ActivityEntry['field'];
  if (field !== undefined && !TRACKED_FIELDS.includes(field)) throw new ImportError(`${path}.field is not a tracked task field.`);
  if (type === 'update' && field === undefined) throw new ImportError(`${path}.field is required for updates.`);
  const entry: ActivityEntry = {
    id: str(v, 'id', path),
    taskId: str(v, 'taskId', path),
    actorId: nullableStr(v, 'actorId', path),
    type,
    at: isoDate(v, 'at', path, false)!,
  };
  if (field !== undefined) entry.field = field;
  const from = activityValue(v.from, `${path}.from`);
  const to = activityValue(v.to, `${path}.to`);
  if (from !== undefined) entry.from = from;
  if (to !== undefined) entry.to = to;
  return entry;
}

function validateView(v: unknown, path: string): SavedView {
  if (!isObj(v)) throw new ImportError(`${path} must be an object.`);
  const name = str(v, 'name', path).trim();
  if (!name) throw new ImportError(`${path}.name must not be empty.`);
  // The stored query is normalised on load, so unknown or stale parameters are simply dropped.
  return { id: str(v, 'id', path), name, search: normalizeSearch(str(v, 'search', path)), createdAt: isoDate(v, 'createdAt', path, false)! };
}

const NOTIFICATION_TYPES = ['assigned', 'mentioned', 'due', 'overdue', 'unblocked'] as const;

function validateNotification(v: unknown, path: string): Notification {
  if (!isObj(v)) throw new ImportError(`${path} must be an object.`);
  const type = v.type as Notification['type'];
  if (!NOTIFICATION_TYPES.includes(type)) throw new ImportError(`${path}.type must be one of ${NOTIFICATION_TYPES.join(', ')}.`);
  if (typeof v.read !== 'boolean') throw new ImportError(`${path}.read must be a boolean.`);
  const n: Notification = {
    id: str(v, 'id', path),
    userId: str(v, 'userId', path),
    type,
    taskId: str(v, 'taskId', path),
    taskTitle: str(v, 'taskTitle', path),
    actorId: nullableStr(v, 'actorId', path),
    at: isoDate(v, 'at', path, false)!,
    read: v.read,
    key: str(v, 'key', path),
  };
  const detail = nullableStr(v, 'detail', path);
  if (detail !== null) n.detail = detail;
  return n;
}

function validateSubtask(v: unknown, path: string): Subtask {
  if (!isObj(v)) throw new ImportError(`${path} must be an object.`);
  if (typeof v.done !== 'boolean') throw new ImportError(`${path}.done must be a boolean.`);
  return { id: str(v, 'id', path), title: str(v, 'title', path), done: v.done };
}

function validateTask(
  v: unknown,
  path: string,
  projectIds: Set<string>,
  memberIds: Set<string>,
  workflowOf: (projectId: string | null) => readonly WorkflowStatus[],
): Task {
  if (!isObj(v)) throw new ImportError(`${path} must be an object.`);
  const title = str(v, 'title', path);
  if (!title.trim() || title.length > LIMITS.title) throw new ImportError(`${path}.title must be 1–${LIMITS.title} characters.`);
  const description = str(v, 'description', path);
  if (description.length > LIMITS.description) throw new ImportError(`${path}.description exceeds ${LIMITS.description} characters.`);
  const priority = v.priority as Priority;
  if (!PRIORITIES.includes(priority)) throw new ImportError(`${path}.priority must be one of ${PRIORITIES.join(', ')}.`);
  const projectId = nullableStr(v, 'projectId', path);
  if (projectId !== null && !projectIds.has(projectId)) throw new ImportError(`${path}.projectId references unknown project "${projectId}".`);
  // v2 stores `statusId`; v1 stored `status` (a category, equal to the default workflow's ids).
  // `category` is never trusted from the file: it is derived from the workflow.
  const statusId = typeof v.statusId === 'string' ? v.statusId : typeof v.status === 'string' ? v.status : null;
  if (statusId === null) throw new ImportError(`${path}.statusId must be a string.`);
  const wf = workflowOf(projectId);
  const status = findStatus(wf, statusId);
  if (!status) throw new ImportError(`${path} has status "${statusId}", which is not in its project's workflow (${wf.map((s) => s.id).join(', ')}).`);
  if (!Array.isArray(v.tags) || !v.tags.every((t) => typeof t === 'string'))
    throw new ImportError(`${path}.tags must be an array of strings.`);
  const tags = v.tags as string[];
  if (tags.length > LIMITS.tags) throw new ImportError(`${path}.tags has more than ${LIMITS.tags} entries.`);
  if (tags.some((t) => t !== t.toLowerCase()) || new Set(tags).size !== tags.length)
    throw new ImportError(`${path}.tags must be lowercase and unique.`);
  const dueDate = nullableStr(v, 'dueDate', path);
  if (dueDate !== null && !isValidDateKey(dueDate)) throw new ImportError(`${path}.dueDate must be YYYY-MM-DD or null.`);
  const est = v.estimateMinutes;
  if (est !== null && est !== undefined && !(typeof est === 'number' && Number.isInteger(est) && est > 0))
    throw new ImportError(`${path}.estimateMinutes must be a positive integer or null.`);
  const spent = v.timeSpentMinutes;
  if (typeof spent !== 'number' || !Number.isFinite(spent) || spent < 0)
    throw new ImportError(`${path}.timeSpentMinutes must be a non-negative number.`);
  if (!Array.isArray(v.subtasks)) throw new ImportError(`${path}.subtasks must be an array.`);
  const order = v.order;
  if (typeof order !== 'number' || !Number.isFinite(order)) throw new ImportError(`${path}.order must be a number.`);
  // Fields added after v1 shipped: absent in older saves/exports, so they default.
  const assigneeId = nullableStr(v, 'assigneeId', path);
  if (assigneeId !== null && !memberIds.has(assigneeId)) throw new ImportError(`${path}.assigneeId references unknown member "${assigneeId}".`);
  const recurrence = (v.recurrence ?? 'none') as Recurrence;
  if (!RECURRENCES.includes(recurrence)) throw new ImportError(`${path}.recurrence must be one of ${RECURRENCES.join(', ')}.`);
  const blockedBy = v.blockedBy ?? [];
  if (!Array.isArray(blockedBy) || !blockedBy.every((id) => typeof id === 'string'))
    throw new ImportError(`${path}.blockedBy must be an array of task ids.`);
  const comments = v.comments ?? [];
  if (!Array.isArray(comments)) throw new ImportError(`${path}.comments must be an array.`);
  return {
    id: str(v, 'id', path),
    title,
    description,
    statusId: status.id,
    category: status.category,
    priority,
    projectId,
    tags,
    dueDate,
    estimateMinutes: (est as number | null | undefined) ?? null,
    timeSpentMinutes: spent,
    subtasks: v.subtasks.map((s, i) => validateSubtask(s, `${path}.subtasks[${i}]`)),
    createdAt: isoDate(v, 'createdAt', path, false)!,
    completedAt: isoDate(v, 'completedAt', path, true),
    order,
    assigneeId,
    recurrence,
    blockedBy: [...new Set(blockedBy as string[])],
    comments: comments.map((c, i) => validateComment(c, `${path}.comments[${i}]`)),
  };
}

function validateSettings(v: unknown): Settings {
  if (v === undefined) return { ...DEFAULT_SETTINGS };
  if (!isObj(v)) throw new ImportError('settings must be an object.');
  const theme = v.theme ?? DEFAULT_SETTINGS.theme;
  if (theme !== 'light' && theme !== 'dark' && theme !== 'system') throw new ImportError('settings.theme must be light, dark or system.');
  const pomodoroMinutes = v.pomodoroMinutes ?? DEFAULT_SETTINGS.pomodoroMinutes;
  if (typeof pomodoroMinutes !== 'number' || !Number.isInteger(pomodoroMinutes) || pomodoroMinutes < 1 || pomodoroMinutes > 180)
    throw new ImportError('settings.pomodoroMinutes must be an integer between 1 and 180.');
  const pageSize = v.pageSize ?? DEFAULT_SETTINGS.pageSize;
  if (typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize < 5 || pageSize > 200)
    throw new ImportError('settings.pageSize must be an integer between 5 and 200.');
  const currentUserId = v.currentUserId === undefined ? DEFAULT_SETTINGS.currentUserId : v.currentUserId;
  if (currentUserId !== null && typeof currentUserId !== 'string') throw new ImportError('settings.currentUserId must be a member id or null.');
  return { theme, pomodoroMinutes, pageSize, currentUserId };
}

/** Validates untrusted JSON (already parsed) against the AppState schema. */
export function validateImport(data: unknown): ImportResult {
  try {
    if (!isObj(data)) throw new ImportError('The file must contain a JSON object with "tasks" and "projects".');
    // Files without "schema" are v1 exports (accepted and migrated); newer schemas are refused.
    if (data.schema !== undefined && (typeof data.schema !== 'number' || data.schema > SCHEMA_VERSION))
      throw new ImportError(`This file was exported by a newer version of TaskPilot (schema ${String(data.schema)}); this version reads schema ${SCHEMA_VERSION} and older.`);
    if (!Array.isArray(data.projects)) throw new ImportError('"projects" must be an array.');
    if (!Array.isArray(data.tasks)) throw new ImportError('"tasks" must be an array.');
    const projects = data.projects.map((p, i) => validateProject(p, `projects[${i}]`));
    const projectIds = new Set(projects.map((p) => p.id));
    if (projectIds.size !== projects.length) throw new ImportError('Project ids must be unique.');
    projects.forEach((p, i) => {
      if (p.parentId === null) return;
      if (!projectIds.has(p.parentId)) throw new ImportError(`projects[${i}].parentId references unknown project "${p.parentId}".`);
      if (wouldCreateCycle(projects, p.id, p.parentId)) throw new ImportError(`projects[${i}] is its own ancestor (the parent links form a cycle).`);
    });
    const workflowOf = workflowResolver(projects);
    // "members" was added later: older saves/exports have none.
    if (data.members !== undefined && !Array.isArray(data.members)) throw new ImportError('"members" must be an array.');
    const rawMembers: unknown[] = Array.isArray(data.members) ? data.members : [];
    const members = rawMembers.map((m, i) => validateMember(m, `members[${i}]`));
    const memberIds = new Set(members.map((m) => m.id));
    if (memberIds.size !== members.length) throw new ImportError('Member ids must be unique.');
    const tasks = data.tasks.map((t, i) => validateTask(t, `tasks[${i}]`, projectIds, memberIds, workflowOf));
    const taskIds = new Set(tasks.map((t) => t.id));
    if (taskIds.size !== tasks.length) throw new ImportError('Task ids must be unique.');
    tasks.forEach((t, i) => {
      const bad = t.blockedBy.find((id) => id === t.id || !taskIds.has(id));
      if (bad !== undefined) throw new ImportError(`tasks[${i}].blockedBy references ${bad === t.id ? 'the task itself' : `unknown task "${bad}"`}.`);
    });
    const cycle = graphCycle(tasks);
    if (cycle) throw new ImportError(`Task dependencies contain a cycle: ${cycle.join(' → ')}.`);
    // "activity" was added later as well.
    if (data.activity !== undefined && !Array.isArray(data.activity)) throw new ImportError('"activity" must be an array.');
    const rawActivity: unknown[] = Array.isArray(data.activity) ? data.activity : [];
    const activity = rawActivity.map((e, i) => validateActivity(e, `activity[${i}]`));
    // "views" was added in a later version too.
    if (data.views !== undefined && !Array.isArray(data.views)) throw new ImportError('"views" must be an array.');
    const rawViews: unknown[] = Array.isArray(data.views) ? data.views : [];
    const views = rawViews.map((v, i) => validateView(v, `views[${i}]`));
    if (new Set(views.map((v) => v.id)).size !== views.length) throw new ImportError('View ids must be unique.');
    // "notifications" was added later as well.
    if (data.notifications !== undefined && !Array.isArray(data.notifications)) throw new ImportError('"notifications" must be an array.');
    const rawNotifications: unknown[] = Array.isArray(data.notifications) ? data.notifications : [];
    const notifications = rawNotifications.map((n, i) => validateNotification(n, `notifications[${i}]`));
    return { ok: true, state: { tasks, projects, members, activity, views, notifications, settings: validateSettings(data.settings) } };
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, error: e.message };
    throw e;
  }
}

export function parseImport(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  return validateImport(data);
}
