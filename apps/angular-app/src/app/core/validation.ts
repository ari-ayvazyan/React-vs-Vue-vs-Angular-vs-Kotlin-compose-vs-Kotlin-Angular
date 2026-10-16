import {
  AppState,
  ACTIVITY_TYPES,
  ActivityEntry,
  ActivityType,
  COMMENT_MAX,
  Comment,
  DEFAULT_SETTINGS,
  AppNotification,
  Member,
  NOTIFICATION_TYPES,
  PRIORITIES,
  SavedView,
  Priority,
  Project,
  RECURRENCES,
  SCHEMA_VERSION,
  WorkflowStatus,
  Recurrence,
  STATUSES,
  Settings,
  Status,
  Subtask,
  Task,
} from './models';
import { isValidDateKey } from './dates';
import { hasDependencyCycle } from './dependencies';
import { validateWorkflow, workflowResolver } from './workflows';
import { wouldCreateCycle } from './project-tree';

export const LIMITS = { title: 120, description: 2000, tags: 8 } as const;

export interface TaskDraft {
  title: string;
  description: string;
  /** Workflow status id ('' = first status of `status`'s category). */
  statusId: string;
  /** Category of the status. */
  status: Status;
  priority: Priority;
  projectId: string | null;
  assigneeId: string | null;
  recurrence: Recurrence;
  tags: string[];
  dueDate: string | null;
  estimate: string; // raw input; '' = none
}

export type TaskDraftErrors = Partial<
  Record<'title' | 'description' | 'tags' | 'estimate' | 'dueDate' | 'status', string>
>;

/** Parses a comma/space separated tag string into lowercase, unique tags. */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,\s]+/)) {
    const t = raw.trim().toLowerCase().replace(/^#/, '');
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function validateTaskDraft(d: TaskDraft): TaskDraftErrors {
  const e: TaskDraftErrors = {};
  const title = d.title.trim();
  if (!title) e.title = 'Title is required.';
  else if (title.length > LIMITS.title)
    e.title = `Title must be at most ${LIMITS.title} characters (${title.length}).`;
  if (d.description.length > LIMITS.description)
    e.description = `Description must be at most ${LIMITS.description} characters (${d.description.length}).`;
  if (d.tags.length > LIMITS.tags)
    e.tags = `At most ${LIMITS.tags} tags allowed (${d.tags.length}).`;
  const est = d.estimate.trim();
  if (est && !/^\d+$/.test(est))
    e.estimate = 'Estimate must be a positive whole number of minutes.';
  else if (est && Number(est) <= 0)
    e.estimate = 'Estimate must be a positive whole number of minutes.';
  if (d.dueDate && !isValidDateKey(d.dueDate)) e.dueDate = 'Invalid date.';
  return e;
}

export function parseEstimate(raw: string): number | null {
  const s = raw.trim();
  return s ? Number(s) : null;
}

// ---------- import validation ----------

export type ImportResult = { ok: true; state: AppState } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isIso = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));

class ImportError extends Error {}

function req(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new ImportError(msg);
}

function validateProject(p: unknown, i: number): Project {
  const at = `projects[${i}]`;
  req(isObj(p), `${at} must be an object.`);
  req(isStr(p['id']) && p['id'].length > 0, `${at}.id must be a non-empty string.`);
  req(isStr(p['name']) && p['name'].trim().length > 0, `${at}.name must be a non-empty string.`);
  req(
    isStr(p['color']) && /^#[0-9a-fA-F]{6}$/.test(p['color']),
    `${at}.color must be a hex colour like #6366f1.`,
  );
  req(isIso(p['createdAt']), `${at}.createdAt must be an ISO date string.`);
  // v2 fields; v1 data has neither (top level, default workflow)
  const parentId = p['parentId'] ?? null;
  req(parentId === null || isStr(parentId), `${at}.parentId must be null or a project id.`);
  const rawWf = p['workflow'] ?? null;
  let workflow: WorkflowStatus[] | null = null;
  if (rawWf !== null) {
    req(Array.isArray(rawWf), `${at}.workflow must be null or an array of statuses.`);
    workflow = rawWf.map((w, k) => validateWorkflowStatus(w, `${at}.workflow[${k}]`));
    const err = validateWorkflow(workflow);
    req(!err, `${at}.workflow: ${err}`);
  }
  return {
    id: p['id'],
    name: p['name'],
    color: p['color'],
    createdAt: p['createdAt'],
    parentId,
    workflow,
  };
}

function validateWorkflowStatus(w: unknown, at: string): WorkflowStatus {
  req(isObj(w), `${at} must be an object.`);
  req(isStr(w['id']) && w['id'].length > 0, `${at}.id must be a non-empty string.`);
  req(isStr(w['name']), `${at}.name must be a string.`);
  req(isStr(w['color']), `${at}.color must be a string.`);
  req(
    isStr(w['category']) && (STATUSES as string[]).includes(w['category']),
    `${at}.category must be one of ${STATUSES.join(', ')}.`,
  );
  return { id: w['id'], name: w['name'], color: w['color'], category: w['category'] as Status };
}

function validateMember(m: unknown, i: number): Member {
  const at = `members[${i}]`;
  req(isObj(m), `${at} must be an object.`);
  req(isStr(m['id']) && m['id'].length > 0, `${at}.id must be a non-empty string.`);
  req(isStr(m['name']) && m['name'].trim().length > 0, `${at}.name must be a non-empty string.`);
  req(
    isStr(m['color']) && /^#[0-9a-fA-F]{6}$/.test(m['color']),
    `${at}.color must be a hex colour like #0ea5e9.`,
  );
  return { id: m['id'], name: m['name'], color: m['color'] };
}

function validateSubtask(s: unknown, at: string): Subtask {
  req(isObj(s), `${at} must be an object.`);
  req(isStr(s['id']), `${at}.id must be a string.`);
  req(isStr(s['title']), `${at}.title must be a string.`);
  req(typeof s['done'] === 'boolean', `${at}.done must be a boolean.`);
  return { id: s['id'], title: s['title'], done: s['done'] };
}

function validateComment(c: unknown, at: string): Comment {
  req(isObj(c), `${at} must be an object.`);
  req(isStr(c['id']) && c['id'].length > 0, `${at}.id must be a non-empty string.`);
  req(isStr(c['authorId']) && c['authorId'].length > 0, `${at}.authorId must be a member id.`);
  req(
    isStr(c['body']) && c['body'].trim().length > 0 && c['body'].length <= COMMENT_MAX,
    `${at}.body must be 1–${COMMENT_MAX} characters.`,
  );
  req(isIso(c['createdAt']), `${at}.createdAt must be an ISO date string.`);
  return { id: c['id'], authorId: c['authorId'], body: c['body'], createdAt: c['createdAt'] };
}

const optStr = (v: unknown): v is string | null | undefined =>
  v === undefined || v === null || isStr(v);

function validateActivity(e: unknown, i: number): ActivityEntry {
  const at = `activity[${i}]`;
  req(isObj(e), `${at} must be an object.`);
  req(isStr(e['id']) && isStr(e['taskId']), `${at}.id and .taskId must be strings.`);
  req(isStr(e['taskTitle']), `${at}.taskTitle must be a string.`);
  req(e['actorId'] === null || isStr(e['actorId']), `${at}.actorId must be null or a string.`);
  req(
    isStr(e['type']) && (ACTIVITY_TYPES as string[]).includes(e['type']),
    `${at}.type must be one of ${ACTIVITY_TYPES.join(', ')}.`,
  );
  req(
    optStr(e['field']) && optStr(e['from']) && optStr(e['to']),
    `${at}.field/from/to must be strings or null.`,
  );
  req(isIso(e['at']), `${at}.at must be an ISO date string.`);
  const out: ActivityEntry = {
    id: e['id'],
    taskId: e['taskId'],
    taskTitle: e['taskTitle'],
    actorId: e['actorId'],
    type: e['type'] as ActivityType,
    at: e['at'],
  };
  if (isStr(e['field'])) out.field = e['field'];
  if (e['from'] !== undefined) out.from = e['from'] as string | null;
  if (e['to'] !== undefined) out.to = e['to'] as string | null;
  return out;
}

function validateView(v: unknown, i: number): SavedView {
  const at = `views[${i}]`;
  req(isObj(v), `${at} must be an object.`);
  req(isStr(v['id']) && v['id'].length > 0, `${at}.id must be a non-empty string.`);
  req(isStr(v['name']) && v['name'].trim().length > 0, `${at}.name must be a non-empty string.`);
  const params = v['params'];
  req(
    isObj(params) && Object.values(params).every(isStr),
    `${at}.params must be an object of strings.`,
  );
  req(isIso(v['createdAt']), `${at}.createdAt must be an ISO date string.`);
  return {
    id: v['id'],
    name: v['name'],
    params: { ...(params as Record<string, string>) },
    createdAt: v['createdAt'],
  };
}

function validateNotification(n: unknown, i: number): AppNotification {
  const at = `notifications[${i}]`;
  req(isObj(n), `${at} must be an object.`);
  req(
    isStr(n['id']) && isStr(n['recipientId']) && isStr(n['taskId']) && isStr(n['taskTitle']),
    `${at}.id, .recipientId, .taskId and .taskTitle must be strings.`,
  );
  req(
    isStr(n['type']) && (NOTIFICATION_TYPES as string[]).includes(n['type']),
    `${at}.type must be one of ${NOTIFICATION_TYPES.join(', ')}.`,
  );
  req(n['actorId'] === null || isStr(n['actorId']), `${at}.actorId must be null or a string.`);
  req(optStr(n['detail']) && optStr(n['key']), `${at}.detail/key must be strings.`);
  req(isIso(n['at']), `${at}.at must be an ISO date string.`);
  req(typeof n['read'] === 'boolean', `${at}.read must be a boolean.`);
  const out: AppNotification = {
    id: n['id'],
    type: n['type'] as AppNotification['type'],
    recipientId: n['recipientId'],
    taskId: n['taskId'],
    taskTitle: n['taskTitle'],
    actorId: n['actorId'],
    at: n['at'],
    read: n['read'],
  };
  if (isStr(n['detail'])) out.detail = n['detail'];
  if (isStr(n['key'])) out.key = n['key'];
  return out;
}

function validateTask(
  t: unknown,
  i: number,
  projectIds: Set<string>,
  memberIds: Set<string>,
): Task {
  const at = `tasks[${i}]`;
  req(isObj(t), `${at} must be an object.`);
  req(isStr(t['id']) && t['id'].length > 0, `${at}.id must be a non-empty string.`);
  req(
    isStr(t['title']) && t['title'].trim().length > 0 && t['title'].length <= LIMITS.title,
    `${at}.title must be 1–${LIMITS.title} characters.`,
  );
  req(
    isStr(t['description']) && t['description'].length <= LIMITS.description,
    `${at}.description must be a string of at most ${LIMITS.description} characters.`,
  );
  req(
    isStr(t['status']) && (STATUSES as string[]).includes(t['status']),
    `${at}.status must be one of ${STATUSES.join(', ')}.`,
  );
  req(
    isStr(t['priority']) && (PRIORITIES as string[]).includes(t['priority']),
    `${at}.priority must be one of ${PRIORITIES.join(', ')}.`,
  );
  const pid = t['projectId'];
  req(
    pid === null || (isStr(pid) && projectIds.has(pid)),
    `${at}.projectId must be null or reference an existing project.`,
  );
  // Fields added after v1 shipped: missing means "default" so older data keeps loading.
  const assigneeId = t['assigneeId'] ?? null;
  req(
    assigneeId === null || (isStr(assigneeId) && memberIds.has(assigneeId)),
    `${at}.assigneeId must be null or reference an existing member.`,
  );
  const recurrence = t['recurrence'] ?? 'none';
  req(
    isStr(recurrence) && (RECURRENCES as string[]).includes(recurrence),
    `${at}.recurrence must be one of ${RECURRENCES.join(', ')}.`,
  );
  const tags = t['tags'];
  req(Array.isArray(tags) && tags.every(isStr), `${at}.tags must be an array of strings.`);
  req(tags.length <= LIMITS.tags, `${at}.tags may contain at most ${LIMITS.tags} tags.`);
  req(
    tags.every((x) => x === x.toLowerCase()) && new Set(tags).size === tags.length,
    `${at}.tags must be lowercase and unique.`,
  );
  const due = t['dueDate'];
  req(due === null || isValidDateKey(due), `${at}.dueDate must be null or YYYY-MM-DD.`);
  const est = t['estimateMinutes'];
  req(
    est === null || (typeof est === 'number' && Number.isInteger(est) && est > 0),
    `${at}.estimateMinutes must be null or a positive integer.`,
  );
  const spent = t['timeSpentMinutes'];
  req(
    typeof spent === 'number' && Number.isFinite(spent) && spent >= 0,
    `${at}.timeSpentMinutes must be a non-negative number.`,
  );
  const subs = t['subtasks'];
  req(Array.isArray(subs), `${at}.subtasks must be an array.`);
  const blockedBy = t['blockedBy'] ?? [];
  req(
    Array.isArray(blockedBy) &&
      blockedBy.every(isStr) &&
      new Set(blockedBy).size === blockedBy.length,
    `${at}.blockedBy must be an array of unique task ids.`,
  );
  req(!blockedBy.includes(t['id']), `${at}.blockedBy must not contain the task itself.`);
  const comments = t['comments'] ?? [];
  req(Array.isArray(comments), `${at}.comments must be an array.`);
  req(isIso(t['createdAt']), `${at}.createdAt must be an ISO date string.`);
  const comp = t['completedAt'];
  req(comp === null || isIso(comp), `${at}.completedAt must be null or an ISO date string.`);
  req(
    typeof t['order'] === 'number' && Number.isFinite(t['order']),
    `${at}.order must be a number.`,
  );
  return {
    id: t['id'],
    title: t['title'],
    description: t['description'],
    // v1 tasks have no statusId: the default workflow's ids equal the category names
    statusId: isStr(t['statusId']) && t['statusId'] ? t['statusId'] : (t['status'] as string),
    status: t['status'] as Status,
    priority: t['priority'] as Priority,
    projectId: pid,
    assigneeId,
    recurrence: recurrence as Recurrence,
    tags: [...tags],
    dueDate: due,
    estimateMinutes: est,
    timeSpentMinutes: spent,
    subtasks: subs.map((s, k) => validateSubtask(s, `${at}.subtasks[${k}]`)),
    blockedBy: [...blockedBy],
    comments: comments.map((c, k) => validateComment(c, `${at}.comments[${k}]`)),
    createdAt: t['createdAt'],
    completedAt: comp,
    order: t['order'],
  };
}

function validateSettings(s: unknown): Settings {
  if (s === undefined) return { ...DEFAULT_SETTINGS };
  req(isObj(s), 'settings must be an object.');
  const theme = s['theme'];
  req(
    theme === 'light' || theme === 'dark' || theme === 'system',
    'settings.theme must be light, dark or system.',
  );
  const pm = s['pomodoroMinutes'];
  req(
    typeof pm === 'number' && Number.isInteger(pm) && pm >= 1 && pm <= 180,
    'settings.pomodoroMinutes must be an integer 1–180.',
  );
  const ps = s['pageSize'];
  req(
    typeof ps === 'number' && Number.isInteger(ps) && ps >= 5 && ps <= 200,
    'settings.pageSize must be an integer 5–200.',
  );
  const cu = s['currentUserId'];
  req(
    cu === undefined || cu === null || (isStr(cu) && cu.length > 0),
    'settings.currentUserId must be null or a member id.',
  );
  return {
    theme,
    pomodoroMinutes: pm,
    pageSize: ps,
    currentUserId: cu === undefined ? DEFAULT_SETTINGS.currentUserId : cu,
  };
}

/** Validates an unknown (parsed JSON) value against the AppState schema. */
export function validateAppState(data: unknown): ImportResult {
  try {
    req(isObj(data), 'Root must be a JSON object with "tasks", "projects" and "settings".');
    const version = data['version'] ?? 1;
    req(
      version === 1 || version === SCHEMA_VERSION,
      `Unsupported schema version ${String(version)} (this app reads versions 1 and ${SCHEMA_VERSION}).`,
    );
    req(Array.isArray(data['projects']), '"projects" must be an array.');
    req(Array.isArray(data['tasks']), '"tasks" must be an array.');
    const projects = data['projects'].map(validateProject);
    const projectIds = new Set(projects.map((p) => p.id));
    req(projectIds.size === projects.length, 'Project ids must be unique.');
    projects.forEach((p, i) =>
      req(
        p.parentId === null || projectIds.has(p.parentId),
        `projects[${i}].parentId must reference an existing project.`,
      ),
    );
    req(
      projects.every((p) => !wouldCreateCycle(projects, p.id, p.parentId)),
      'Project parents must not form a cycle.',
    );
    const workflowOf = workflowResolver(projects);
    const rawMembers = data['members'] ?? [];
    req(Array.isArray(rawMembers), '"members" must be an array.');
    const members = rawMembers.map(validateMember);
    const memberIds = new Set(members.map((m) => m.id));
    req(memberIds.size === members.length, 'Member ids must be unique.');
    const tasks = data['tasks'].map((t, i) => validateTask(t, i, projectIds, memberIds));
    tasks.forEach((t, i) => {
      const s = workflowOf(t.projectId).find((x) => x.id === t.statusId);
      req(
        !!s,
        `tasks[${i}].statusId “${t.statusId}” is not a status of the task's project workflow.`,
      );
      req(
        s.category === t.status,
        `tasks[${i}].status must be the category of its statusId (${s.category}).`,
      );
    });
    const taskIds = new Set(tasks.map((t) => t.id));
    req(taskIds.size === tasks.length, 'Task ids must be unique.');
    tasks.forEach((t, i) =>
      req(
        t.blockedBy.every((id) => taskIds.has(id)),
        `tasks[${i}].blockedBy must reference existing tasks.`,
      ),
    );
    req(!hasDependencyCycle(tasks), 'Task dependencies (blockedBy) must not form a cycle.');
    const rawActivity = data['activity'] ?? [];
    req(Array.isArray(rawActivity), '"activity" must be an array.');
    const activity = rawActivity.map(validateActivity);
    const rawViews = data['views'] ?? [];
    req(Array.isArray(rawViews), '"views" must be an array.');
    const views = rawViews.map(validateView);
    req(new Set(views.map((v) => v.id)).size === views.length, 'View ids must be unique.');
    const rawNotifications = data['notifications'] ?? [];
    req(Array.isArray(rawNotifications), '"notifications" must be an array.');
    const notifications = rawNotifications.map(validateNotification);
    const settings = validateSettings(data['settings']);
    return {
      ok: true,
      state: {
        version: SCHEMA_VERSION,
        tasks,
        projects,
        members,
        activity,
        views,
        notifications,
        settings,
      },
    };
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
    return { ok: false, error: 'File is not valid JSON.' };
  }
  return validateAppState(data);
}
