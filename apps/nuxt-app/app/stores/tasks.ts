import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type { ActivityEntry, AppNotification, AppState, Member, PersistedState, Project, SavedView, Settings, Status, Task, TaskComment, WorkflowStatus } from '~/lib/types';
import { DEFAULT_SETTINGS, LEGACY_STORAGE_KEYS, SCHEMA_VERSION, STORAGE_KEY } from '~/lib/types';
import { generateDemoData } from '~/lib/demo';
import { createHistory, record, redo as historyRedo, undo as historyUndo } from '~/lib/history';
import type { History } from '~/lib/history';
import { nextOrder, placeInColumn, uid } from '~/lib/taskOps';
import { normalizeTasks, projectsUsingWorkflowOf, validateWorkflow, withWorkflowStatus, workflowResolver } from '~/lib/workflows';
import { deleteProjectPlan, makeProjectScope, projectOptions as projectOptionsOf, validateParent } from '~/lib/projects';
import type { ProjectTaskMode, SubprojectMode } from '~/lib/projects';
import { validateImport } from '~/lib/validation';
import { formatDate, toISODate } from '~/lib/dates';
import { spawnRecurrences } from '~/lib/recurrence';
import { unassignMember } from '~/lib/members';
import { appendActivity, diffTasks } from '~/lib/activity';
import { blockedMessage, blockedTaskIds, partitionCompletable, removeDependencyRefs, validateDependency } from '~/lib/dependencies';
import { COMMENT_MAX, encodeMentions } from '~/lib/mentions';
import { normalizeViewQuery } from '~/lib/views';
import { appendNotifications, dueReminders, notificationsFor, notificationsForChange, pruneNotifications } from '~/lib/notifications';
import { useUiStore } from './ui';

interface Snapshot {
  tasks: Task[];
  projects: Project[];
  members: Member[];
  /** part of the snapshot so undo/redo removes/re-adds the entries of the change it reverts */
  activity: ActivityEntry[];
  views: SavedView[];
}

export type NewTaskInput = Omit<
  Task,
  'id' | 'createdAt' | 'completedAt' | 'order' | 'timeSpentMinutes' | 'subtasks' | 'assigneeId' | 'recurrence' | 'blockedBy' | 'comments' | 'status'
> &
  Partial<Pick<Task, 'subtasks' | 'timeSpentMinutes' | 'assigneeId' | 'recurrence' | 'blockedBy' | 'comments'>>;

/**
 * Central app store. Tasks/projects are kept immutable (shallowRef + replaced arrays/objects),
 * which makes undo/redo snapshots cheap and keeps reactivity overhead low for large datasets.
 *
 * Every recorded change goes through `commit()`, which also diffs the task list and appends activity
 * entries – so the log covers every path (forms, board, bulk actions, project/member deletion, …)
 * without each action having to remember it.
 */
export const useTaskStore = defineStore('tasks', () => {
  const tasks = shallowRef<Task[]>([]);
  const projects = shallowRef<Project[]>([]);
  const members = shallowRef<Member[]>([]);
  const activity = shallowRef<ActivityEntry[]>([]);
  const views = shallowRef<SavedView[]>([]);
  /** Not part of the undo snapshot: event notifications reference activity entries instead (see lib/notifications). */
  const notifications = shallowRef<AppNotification[]>([]);
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
  /** false until client-side data has been loaded from localStorage (after hydration). */
  const ready = ref(false);
  const today = ref(toISODate(new Date()));
  const history = shallowRef<History<Snapshot>>(createHistory<Snapshot>(50));

  const taskById = computed(() => new Map(tasks.value.map((t) => [t.id, t])));
  const projectById = computed(() => new Map(projects.value.map((p) => [p.id, p])));
  const memberById = computed(() => new Map(members.value.map((m) => [m.id, m])));
  /** The member acting as "me" (comment author, activity actor); null if unset or deleted. */
  const currentUser = computed(() => (settings.value.currentUserId ? (memberById.value.get(settings.value.currentUserId) ?? null) : null));
  /** Effective workflows per project (own → nearest ancestor's → default). */
  const workflows = computed(() => workflowResolver(projects.value));
  /** Project filter scope: a project and its sub-projects. */
  const projectScope = computed(() => makeProjectScope(projects.value));
  /** Projects in tree order with indented labels, for selects. */
  const projectOptions = computed(() => projectOptionsOf(projects.value));
  /** Ids of tasks that have at least one open blocker. */
  const blockedIds = computed(() => blockedTaskIds(tasks.value));
  const allTags = computed(() => {
    const s = new Set<string>();
    for (const t of tasks.value) for (const tag of t.tags) s.add(tag);
    return [...s].sort();
  });
  const canUndo = computed(() => history.value.past.length > 0);
  const canRedo = computed(() => history.value.future.length > 0);

  const snapshot = (): Snapshot => ({ tasks: tasks.value, projects: projects.value, members: members.value, activity: activity.value, views: views.value });

  function restore(s: Snapshot): void {
    tasks.value = s.tasks;
    projects.value = s.projects;
    members.value = s.members;
    activity.value = s.activity;
    views.value = s.views;
  }

  /**
   * Apply a recorded (undoable) mutation. Task changes are logged to the activity log unless `log` is false
   * (used for wholesale replacement such as import/reset, which bring their own log).
   */
  function commit(next: Partial<Snapshot>, opts: { log?: boolean } = {}): void {
    history.value = record(history.value, snapshot());
    // Workflow/parent edits and project moves can invalidate task statuses: re-establish the invariants
    // (lib/workflows normalizeTasks) in the same commit, so they are logged and undone together.
    let nextTasks = next.tasks;
    if (next.tasks || next.projects) {
      const normalized = normalizeTasks(next.tasks ?? tasks.value, next.projects ?? projects.value, new Date().toISOString());
      if (normalized !== tasks.value) nextTasks = normalized;
    }
    if (nextTasks && opts.log !== false) {
      const entries = diffTasks(tasks.value, nextTasks, { actorId: currentUser.value?.id ?? null, at: new Date().toISOString(), makeId: uid });
      activity.value = appendActivity(next.activity ?? activity.value, entries);
      notifications.value = appendNotifications(notifications.value, notificationsForChange(entries, tasks.value, nextTasks, uid));
    } else if (next.activity) activity.value = next.activity;
    if (nextTasks) tasks.value = nextTasks;
    if (next.projects) projects.value = next.projects;
    if (next.members) members.value = next.members;
    if (next.views) views.value = next.views;
  }

  /**
   * Commit a task-list change that may complete tasks. Recurring tasks that became done get their next
   * occurrence appended *in the same commit*, so one undo reverts the completion and the copy together.
   */
  function commitTasks(next: Task[], nextProjects?: Project[]): void {
    const nowISO = new Date().toISOString();
    const projectList = nextProjects ?? projects.value;
    const normalized = normalizeTasks(next, projectList, nowISO);
    const wf = nextProjects ? workflowResolver(nextProjects) : workflows.value;
    const withCopies = spawnRecurrences(tasks.value, normalized, {
      nowISO,
      today: toISODate(new Date()),
      makeId: uid,
      todoStatusId: (t) => wf.firstOfCategory(t.projectId, 'todo').id,
    });
    commit(nextProjects ? { tasks: withCopies, projects: nextProjects } : { tasks: withCopies });
    const spawned = withCopies.slice(normalized.length);
    if (spawned.length) notifySpawned(spawned);
  }

  function notifySpawned(spawned: Task[]): void {
    const first = spawned[0] as Task;
    const message =
      spawned.length === 1
        ? `Next “${first.title}” scheduled for ${formatDate(first.dueDate)}`
        : `Scheduled the next occurrence of ${spawned.length} recurring tasks`;
    useUiStore().toast(message, { kind: 'success', actionLabel: 'Undo', action: () => undo() });
  }

  /**
   * Completion guard shared by every path that can move tasks to done. Returns the ids that may be completed
   * and shows one error toast naming the blockers of the others.
   */
  function completable(ids: readonly string[]): string[] {
    const { allowed, blocked } = partitionCompletable(tasks.value, ids);
    if (blocked.length) useUiStore().toast(blockedMessage(blocked), { kind: 'error', duration: 7000 });
    return allowed;
  }

  function undo(): boolean {
    const r = historyUndo(history.value, snapshot());
    if (!r) return false;
    history.value = r.history;
    restore(r.state);
    return true;
  }

  function redo(): boolean {
    const r = historyRedo(history.value, snapshot());
    if (!r) return false;
    history.value = r.history;
    restore(r.state);
    return true;
  }

  // ---------- lifecycle ----------

  function replaceAll(input: AppState, opts: { keepSettings?: boolean; undoable?: boolean } = {}): void {
    const state = { ...input, tasks: normalizeTasks(input.tasks, input.projects, new Date().toISOString()) };
    if (opts.undoable) commit({ tasks: state.tasks, projects: state.projects, members: state.members, activity: state.activity, views: state.views }, { log: false });
    else {
      restore(state);
      history.value = createHistory<Snapshot>(50);
    }
    if (opts.undoable) {
      // keep the current notifications too: undoing the import brings their activity entries back
      const known = new Set(notifications.value.map((n) => n.id));
      notifications.value = [...notifications.value, ...state.notifications.filter((n) => !known.has(n.id))];
    } else notifications.value = pruneNotifications(state.notifications, new Set(state.activity.map((e) => e.id)));
    if (!opts.keepSettings) settings.value = { ...state.settings };
  }

  /**
   * Load persisted state (client only). Seeds 300 demo tasks when storage is empty or unreadable.
   * With `seedCount`, persisted settings are kept but data is replaced by generateDemoData(seedCount).
   */
  /**
   * Load persisted state (client only). Reads schema v2 (\`taskpilot:v2\`), or migrates v1 data (\`taskpilot:v1\`):
   * validateImport upgrades the shape, the result is written as v2 and the v1 key is removed.
   * Seeds 300 demo tasks when storage is empty or unreadable. With \`seedCount\`, persisted settings are kept but
   * data is replaced by generateDemoData(seedCount).
   */
  function load(seedCount?: number): void {
    today.value = toISODate(new Date());
    let loaded = false;
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      let legacyKey: string | null = null;
      if (!raw) {
        legacyKey = LEGACY_STORAGE_KEYS.find((k) => localStorage.getItem(k) !== null) ?? null;
        if (legacyKey) raw = localStorage.getItem(legacyKey);
      }
      if (raw) {
        const res = validateImport(raw);
        if (res.ok) {
          replaceAll(res.state);
          loaded = true;
          if (legacyKey && persist()) localStorage.removeItem(legacyKey);
        } else {
          console.warn('[taskpilot] stored data invalid, reseeding:', res.errors[0]);
        }
      }
    } catch {
      /* storage unavailable */
    }
    if (seedCount !== undefined) replaceAll(generateDemoData(seedCount), { keepSettings: loaded });
    else if (!loaded) replaceAll(generateDemoData(300));
    ready.value = true;
  }

  /** Write the current state to localStorage (schema v2). Returns false when storage is unavailable or full. */
  function persist(): boolean {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
      return true;
    } catch (err) {
      console.warn('[taskpilot] could not persist state', err);
      return false;
    }
  }

  function seed(count: number): void {
    replaceAll(generateDemoData(count), { keepSettings: true });
  }

  function serialize(): PersistedState {
    return {
      schemaVersion: SCHEMA_VERSION,
      tasks: tasks.value,
      projects: projects.value,
      members: members.value,
      activity: activity.value,
      views: views.value,
      notifications: notifications.value,
      settings: settings.value,
    };
  }

  // ---------- tasks ----------

  function createTask(input: NewTaskInput): Task {
    const now = new Date().toISOString();
    const status = workflows.value.resolve(input.projectId, input.statusId);
    const task: Task = {
      subtasks: [],
      timeSpentMinutes: 0,
      assigneeId: null,
      recurrence: 'none',
      blockedBy: [],
      comments: [],
      ...input,
      statusId: status.id,
      status: status.category,
      id: uid('t'),
      createdAt: now,
      completedAt: status.category === 'done' ? now : null,
      order: nextOrder(tasks.value),
    };
    commit({ tasks: [...tasks.value, task] });
    return task;
  }

  /** True when giving `id` this status would complete it (category becomes done). */
  const completes = (id: string, status: WorkflowStatus | undefined): boolean => status?.category === 'done' && taskById.value.get(id)?.status !== 'done';

  /**
   * Patch a task. A status can be given as \`statusId\` (a workflow status) or \`status\` (a category → the first
   * status of that category). Returns false (and shows an error toast) when it would complete a task with open
   * blockers.
   */
  function updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): boolean {
    const current = taskById.value.get(id);
    if (!current) return false;
    const projectId = patch.projectId !== undefined ? patch.projectId : current.projectId;
    const wanted = patch.statusId ?? patch.status;
    const status = wanted !== undefined ? workflows.value.resolve(projectId, wanted) : undefined;
    if (completes(id, status) && completable([id]).length === 0) return false;
    const now = new Date().toISOString();
    commitTasks(
      tasks.value.map((t) => {
        if (t.id !== id) return t;
        const { status: _s, statusId: _i, completedAt: _c, ...rest } = patch;
        let next: Task = { ...t, ...rest };
        if (status && (status.id !== t.statusId || status.category !== t.status)) {
          next = withWorkflowStatus(next, status, now);
          if (status.id !== t.statusId) next = { ...next, order: nextOrder(tasks.value) };
        }
        return next;
      }),
    );
    return true;
  }

  /**
   * Move tasks to a status category (first status of that category in each task's workflow; tasks already in the
   * category keep their status). Blocked tasks are skipped when completing. Returns how many changed.
   */
  function setStatus(ids: readonly string[], category: Status): number {
    const targets = category === 'done' ? completable(ids) : ids;
    const set = new Set(targets.filter((id) => taskById.value.get(id)?.status !== category));
    if (set.size === 0) return 0;
    const now = new Date().toISOString();
    let order = nextOrder(tasks.value);
    const wf = workflows.value;
    commitTasks(tasks.value.map((t) => (set.has(t.id) ? { ...withWorkflowStatus(t, wf.firstOfCategory(t.projectId, category), now), order: order++ } : t)));
    return set.size;
  }

  function toggleDone(id: string): boolean {
    const t = taskById.value.get(id);
    return t ? setStatus([id], t.status === 'done' ? 'todo' : 'done') > 0 : false;
  }

  function deleteTasks(ids: readonly string[]): number {
    const set = new Set(ids);
    const before = tasks.value.length;
    commit({ tasks: removeDependencyRefs(tasks.value.filter((t) => !set.has(t.id)), set) });
    return before - tasks.value.length;
  }

  function moveToProject(ids: readonly string[], projectId: string | null): void {
    const set = new Set(ids);
    // statuses missing from the new project's workflow are mapped by category (normalizeTasks in commit)
    commitTasks(tasks.value.map((t) => (set.has(t.id) && t.projectId !== projectId ? { ...t, projectId } : t)));
  }

  /**
   * Board move: give task \`id\` the workflow status \`statusId\` (resolved in the task's own workflow) and put it
   * at \`index\` of the destination column, whose current ids (display order, without the task) are \`destIds\`.
   * Returns false when refused (completing a task with open blockers).
   */
  function moveTask(id: string, statusId: string, destIds: readonly string[], index: number): boolean {
    const task = taskById.value.get(id);
    if (!task) return false;
    const status = workflows.value.resolve(task.projectId, statusId, task.status);
    if (completes(id, status) && completable([id]).length === 0) return false;
    const now = new Date().toISOString();
    commitTasks(placeInColumn(tasks.value, id, destIds, index, (t) => withWorkflowStatus(t, status, now)));
    return true;
  }

  /** Pomodoro time tracking — intentionally not part of undo history (and therefore not logged). */
  function addTimeSpent(id: string, minutes: number): void {
    if (minutes <= 0) return;
    tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, timeSpentMinutes: t.timeSpentMinutes + minutes } : t));
  }

  // ---------- dependencies ----------

  /** Make `blockerId` a blocker of `taskId`. Returns an error message ('' on success). */
  function addDependency(taskId: string, blockerId: string): string {
    const error = validateDependency(tasks.value, taskId, blockerId);
    if (error) return error;
    const task = taskById.value.get(taskId) as Task;
    updateTask(taskId, { blockedBy: [...task.blockedBy, blockerId] });
    return '';
  }

  function removeDependency(taskId: string, blockerId: string): void {
    const task = taskById.value.get(taskId);
    if (task?.blockedBy.includes(blockerId)) updateTask(taskId, { blockedBy: task.blockedBy.filter((id) => id !== blockerId) });
  }

  // ---------- comments ----------

  /** Add a comment by the current user. `text` uses `@Name` mentions. Returns an error message ('' on success). */
  function addComment(taskId: string, text: string): string {
    const task = taskById.value.get(taskId);
    if (!task) return 'This task no longer exists.';
    const author = currentUser.value;
    if (!author) return 'Choose who you are under Settings → Team members before commenting.';
    const body = encodeMentions(text.trim(), members.value);
    if (!body) return 'Write something first.';
    if (body.length > COMMENT_MAX) return `Comments can be at most ${COMMENT_MAX} characters.`;
    const comment: TaskComment = { id: uid('c'), authorId: author.id, body, createdAt: new Date().toISOString() };
    updateTask(taskId, { comments: [...task.comments, comment] });
    return '';
  }

  function deleteComment(taskId: string, commentId: string): void {
    const task = taskById.value.get(taskId);
    if (task?.comments.some((c) => c.id === commentId)) updateTask(taskId, { comments: task.comments.filter((c) => c.id !== commentId) });
  }

  // ---------- projects ----------

  function createProject(name: string, color: string, parentId: string | null = null): Project {
    const p: Project = { id: uid('p'), name: name.trim(), color, createdAt: new Date().toISOString(), parentId, workflow: null };
    commit({ projects: [...projects.value, p] });
    return p;
  }

  /** Rename/recolor/re-parent. Returns an error message ('' on success); a parent may not create a cycle. */
  function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'color' | 'parentId'>>): string {
    if (patch.parentId !== undefined) {
      const error = validateParent(projects.value, id, patch.parentId);
      if (error) return error;
    }
    commit({ projects: projects.value.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
    return '';
  }

  /** Delete a project; its sub-projects move up one level or are deleted, their tasks are unassigned or deleted. */
  function deleteProject(id: string, taskMode: ProjectTaskMode, subprojects: SubprojectMode = 'lift'): void {
    const plan = deleteProjectPlan(projects.value, tasks.value, id, subprojects, taskMode);
    commit({ projects: plan.projects, tasks: removeDependencyRefs(plan.tasks, plan.deletedTaskIds) });
  }

  // ---------- workflows ----------

  /**
   * Replace a project's own workflow (null = inherit again). Validated; \`remap\` moves tasks off statuses that
   * are removed (status id → status id). Tasks whose status no longer exists are mapped by category, and
   * category changes update completion – all in one undoable step. Returns an error message ('' on success).
   */
  function setWorkflow(projectId: string, workflow: WorkflowStatus[] | null, remap: Record<string, string> = {}): string {
    if (workflow) {
      const error = validateWorkflow(workflow);
      if (error) return error;
    }
    const nextProjects = projects.value.map((p) => (p.id === projectId ? { ...p, workflow } : p));
    const affected = new Set([...projectsUsingWorkflowOf(projects.value, projectId), ...projectsUsingWorkflowOf(nextProjects, projectId), projectId]);
    const now = new Date().toISOString();
    const nextWf = workflowResolver(nextProjects);
    const remapped = tasks.value.map((t) => {
      const to = t.projectId && affected.has(t.projectId) ? remap[t.statusId] : undefined;
      return to ? withWorkflowStatus(t, nextWf.resolve(t.projectId, to, t.status), now) : t;
    });
    const normalized = normalizeTasks(remapped, nextProjects, now);
    const completing = normalized.filter((t, i) => t.status === 'done' && tasks.value[i]?.status !== 'done').map((t) => t.id);
    if (completing.length) {
      const { blocked } = partitionCompletable(tasks.value, completing);
      if (blocked.length) return `${blockedMessage(blocked)} Choose a status that isn't “Done” for them.`;
    }
    commitTasks(normalized, nextProjects);
    return '';
  }

  // ---------- members ----------

  function createMember(name: string, color: string): Member {
    const m: Member = { id: uid('m'), name: name.trim(), color };
    commit({ members: [...members.value, m] });
    return m;
  }

  function updateMember(id: string, patch: Partial<Pick<Member, 'name' | 'color'>>): void {
    const next = patch.name === undefined ? patch : { ...patch, name: patch.name.trim() };
    commit({ members: members.value.map((m) => (m.id === id ? { ...m, ...next } : m)) });
  }

  /** Removes the member and unassigns their tasks (one undo step). */
  function deleteMember(id: string): void {
    commit({ members: members.value.filter((m) => m.id !== id), tasks: unassignMember(tasks.value, id) });
  }

  // ---------- saved views ----------

  function createView(name: string, query: Record<string, string>): SavedView {
    const v: SavedView = { id: uid('v'), name: name.trim(), query: normalizeViewQuery(query), createdAt: new Date().toISOString() };
    commit({ views: [...views.value, v] });
    return v;
  }

  function renameView(id: string, name: string): void {
    commit({ views: views.value.map((v) => (v.id === id ? { ...v, name: name.trim() } : v)) });
  }

  function deleteView(id: string): void {
    commit({ views: views.value.filter((v) => v.id !== id) });
  }

  // ---------- settings ----------

  function updateSettings(patch: Partial<Settings>): void {
    settings.value = { ...settings.value, ...patch };
  }

  // ---------- notifications ----------

  const activityIds = computed(() => new Set(activity.value.map((e) => e.id)));
  /** The current user's notifications, newest first (undone events hidden). */
  const myNotifications = computed(() => (currentUser.value ? notificationsFor(notifications.value, currentUser.value.id, activityIds.value) : []));
  const unreadCount = computed(() => myNotifications.value.reduce((n, x) => n + (x.read ? 0 : 1), 0));

  /** Create today's due/overdue reminders for the current user (idempotent: once per task per day). */
  function checkDueReminders(): void {
    const user = currentUser.value;
    if (!user) return;
    const added = dueReminders(tasks.value, user.id, today.value, notifications.value, new Date().toISOString(), uid);
    notifications.value = appendNotifications(notifications.value, added);
  }

  function markNotificationRead(id: string, read = true): void {
    notifications.value = notifications.value.map((n) => (n.id === id && n.read !== read ? { ...n, read } : n));
  }

  function markAllNotificationsRead(): void {
    const mine = new Set(myNotifications.value.filter((n) => !n.read).map((n) => n.id));
    if (mine.size) notifications.value = notifications.value.map((n) => (mine.has(n.id) ? { ...n, read: true } : n));
  }

  function refreshToday(): void {
    const t = toISODate(new Date());
    if (t !== today.value) today.value = t;
  }

  return {
    tasks,
    projects,
    workflows,
    projectScope,
    projectOptions,
    members,
    activity,
    views,
    notifications,
    myNotifications,
    unreadCount,
    checkDueReminders,
    markNotificationRead,
    markAllNotificationsRead,
    settings,
    ready,
    today,
    history,
    taskById,
    projectById,
    memberById,
    currentUser,
    blockedIds,
    allTags,
    canUndo,
    canRedo,
    undo,
    redo,
    load,
    seed,
    replaceAll,
    serialize,
    createTask,
    updateTask,
    setStatus,
    toggleDone,
    deleteTasks,
    moveToProject,
    moveTask,
    persist,
    addTimeSpent,
    addDependency,
    removeDependency,
    addComment,
    deleteComment,
    createProject,
    updateProject,
    deleteProject,
    setWorkflow,
    createView,
    renameView,
    deleteView,
    createMember,
    updateMember,
    deleteMember,
    updateSettings,
    refreshToday,
  };
});
