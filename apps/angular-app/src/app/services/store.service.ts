import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  ActivityEntry,
  AppNotification,
  AppState,
  COMMENT_MAX,
  Comment,
  DEFAULT_SETTINGS,
  LEGACY_STORAGE_KEY,
  Member,
  Project,
  SCHEMA_VERSION,
  STORAGE_KEY,
  SavedView,
  Settings,
  Status,
  Task,
  WorkflowStatus,
  uid,
} from '../core/models';
import { generateDemoData } from '../core/demo-data';
import { UndoHistory } from '../core/history';
import { ColumnTarget, moveTaskTo, nextOrder, withStatus } from '../core/task-ops';
import {
  STATUS_NAME_MAX,
  effectiveWorkflow,
  firstOfCategory,
  reconcileTasks,
  validateWorkflow,
  workflowResolver,
} from '../core/workflows';
import { projectOptions, subtreeMap, wouldCreateCycle } from '../core/project-tree';
import { validateAppState } from '../core/validation';
import { formatShortDate, toDateKey } from '../core/dates';
import { spawnRecurrences } from '../core/recurrence';
import { appendActivity, diffActivity } from '../core/activity';
import { checkCompletion, dependencyCycle, isBlocked, pruneBlockers } from '../core/dependencies';
import { encodeMentions } from '../core/mentions';
import {
  appendNotifications,
  dueNotifications,
  notificationsFor,
  notificationsFromChange,
} from '../core/notifications';
import { ToastService } from './toast.service';

/**
 * The undoable part of the state (settings are deliberately excluded). The activity log is part
 * of it, so undoing a change also removes the entries that change produced.
 */
interface Snapshot {
  tasks: Task[];
  projects: Project[];
  members: Member[];
  activity: ActivityEntry[];
  views: SavedView[];
}

const EMPTY: AppState = {
  version: SCHEMA_VERSION,
  tasks: [],
  projects: [],
  members: [],
  activity: [],
  views: [],
  notifications: [],
  settings: { ...DEFAULT_SETTINGS },
};

const snapshotOf = (s: AppState): Snapshot => ({
  tasks: s.tasks,
  projects: s.projects,
  members: s.members,
  activity: s.activity,
  views: s.views,
});

type OptionalOnCreate =
  | 'subtasks'
  | 'timeSpentMinutes'
  | 'assigneeId'
  | 'recurrence'
  | 'blockedBy'
  | 'comments'
  | 'statusId';

/** '' when the change was applied, else a message for the user. */
export type EditResult = string;
export type SubProjectMode = 'lift' | 'delete';

export type BlockerResult = { ok: true } | { ok: false; error: string };
export type NewTask = Omit<Task, 'id' | 'createdAt' | 'completedAt' | 'order' | OptionalOnCreate> &
  Partial<Pick<Task, OptionalOnCreate>>;

/**
 * Single source of truth. State lives in signals; persisted to localStorage on the client only.
 * On the server (and during hydration) `ready()` is false so pages render a neutral skeleton,
 * which keeps server and first client render identical.
 */
@Injectable({ providedIn: 'root' })
export class StoreService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly toast = inject(ToastService);
  private readonly history = new UndoHistory<Snapshot>(50);
  private readonly state = signal<AppState>(EMPTY);
  private readonly historyVersion = signal(0);
  private saveHandle: ReturnType<typeof setTimeout> | null = null;

  readonly ready = signal(false);
  /** Bumps once per minute so date-relative views (overdue, today) stay current. */
  readonly now = signal(new Date());
  readonly today = computed(() => toDateKey(this.now()));

  readonly tasks = computed(() => this.state().tasks);
  readonly projects = computed(() => this.state().projects);
  readonly members = computed(() => this.state().members);
  /** `projectId → effective workflow statuses` for the current projects. */
  readonly workflowOf = computed(() => workflowResolver(this.projects()));
  /** For every project: itself and all descendants (filters include sub-projects). */
  readonly projectSubtree = computed(() => subtreeMap(this.projects()));
  /** Projects in tree order with indented labels, for <select>s. */
  readonly projectOptions = computed(() => projectOptions(this.projects()));
  readonly activity = computed(() => this.state().activity);
  readonly views = computed(() => this.state().views);
  /** The current user's notifications, newest first. */
  readonly myNotifications = computed(() =>
    notificationsFor(this.state().notifications, this.currentUser()?.id ?? null),
  );
  readonly unreadCount = computed(() => this.myNotifications().filter((n) => !n.read).length);
  readonly memberMap = computed(() => new Map(this.members().map((m) => [m.id, m])));
  /** The member selected as "Current user" in Settings, if it still exists. */
  readonly currentUser = computed(() => {
    const id = this.settings().currentUserId;
    return id ? (this.memberMap().get(id) ?? null) : null;
  });
  readonly settings = computed(() => this.state().settings);
  readonly projectMap = computed(() => new Map(this.projects().map((p) => [p.id, p])));
  readonly taskMap = computed(() => new Map(this.tasks().map((t) => [t.id, t])));
  /** Ids of open tasks that wait for at least one open blocker. */
  readonly blockedIds = computed(() => {
    const map = this.taskMap();
    return new Set(
      this.tasks()
        .filter((t) => isBlocked(t, map))
        .map((t) => t.id),
    );
  });
  readonly allTags = computed(() => {
    const s = new Set<string>();
    for (const t of this.tasks()) for (const tag of t.tags) s.add(tag);
    return [...s].sort();
  });
  readonly canUndo = computed(() => (this.historyVersion(), this.history.canUndo));
  readonly canRedo = computed(() => (this.historyVersion(), this.history.canRedo));

  /** Client-only: loads persisted state (or seeds). Called after hydration. */
  init(seed: number | null): void {
    if (!this.isBrowser || this.ready()) return;
    let loaded: AppState;
    if (seed !== null) {
      loaded = generateDemoData(seed);
      const prev = this.readStorage();
      if (prev) loaded.settings = prev.settings;
    } else {
      loaded = this.readStorage() ?? generateDemoData(300);
    }
    this.state.set(loaded);
    this.syncDueNotifications();
    this.persistNow();
    this.ready.set(true);
    setInterval(() => {
      this.now.set(new Date());
      this.syncDueNotifications();
    }, 60_000);
    // saves are debounced; don't lose the last change when the tab is closed or reloaded
    window.addEventListener('pagehide', () => {
      if (this.saveHandle) {
        clearTimeout(this.saveHandle);
        this.persistNow();
      }
    });
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        const s = this.readStorage();
        if (s) this.state.set(s);
      }
    });
  }

  /**
   * Loads `taskpilot:v2`; if there is none yet, migrates `taskpilot:v1` (validation upgrades the
   * schema). The v1 entry is left in place as a backup; the next save writes v2.
   */
  private readStorage(): AppState | null {
    for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const res = validateAppState(JSON.parse(raw));
        if (res.ok) return res.state;
      } catch {
        /* unreadable entry: try the next one */
      }
    }
    return null;
  }

  private persist(): void {
    if (!this.isBrowser) return;
    if (this.saveHandle) clearTimeout(this.saveHandle);
    this.saveHandle = setTimeout(() => this.persistNow(), 150);
  }

  private persistNow(): void {
    if (!this.isBrowser) return;
    this.saveHandle = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state()));
    } catch {
      /* storage full / disabled – app keeps working in memory */
    }
  }

  /**
   * Every task/project/member mutation goes through here so it is undoable as one step. On top of
   * the change itself, the same step:
   * - creates the next occurrence of recurring tasks that were just completed,
   * - drops dependencies on tasks that no longer exist,
   * - appends activity-log entries for every task change (so undo removes them again).
   */
  private mutate(fn: (s: Snapshot) => Snapshot): void {
    const cur = this.state();
    const before = snapshotOf(cur);
    let after = fn(before);
    if (
      after.tasks === before.tasks &&
      after.projects === before.projects &&
      after.members === before.members &&
      after.views === before.views
    )
      return;
    let spawned: Task[] = [];
    let notifications = cur.notifications;
    const nowIso = new Date().toISOString();
    const workflowOf =
      after.projects === before.projects ? this.workflowOf() : workflowResolver(after.projects);
    if (after.tasks !== before.tasks || after.projects !== before.projects) {
      // statuses follow the (possibly changed) workflows; category-only writes are mapped
      after = { ...after, tasks: reconcileTasks(before.tasks, after.tasks, workflowOf, nowIso) };
    }
    if (after.tasks !== before.tasks) {
      const res = spawnRecurrences(before.tasks, after.tasks, {
        today: this.today(),
        nowIso,
        newId: uid,
        todoStatusId: (t) => firstOfCategory(workflowOf(t.projectId), 'todo')?.id ?? 'todo',
      });
      spawned = res.spawned;
      const tasks = pruneBlockers(res.tasks);
      const entries = diffActivity(before.tasks, tasks, {
        actorId: this.currentUser()?.id ?? null,
        at: nowIso,
        newId: uid,
        statusName: (t) =>
          workflowOf(t.projectId).find((x) => x.id === t.statusId)?.name ?? t.statusId,
      });
      after = { ...after, tasks, activity: appendActivity(after.activity, entries) };
      notifications = appendNotifications(
        notifications,
        notificationsFromChange(before.tasks, tasks, {
          actorId: this.currentUser()?.id ?? null,
          at: nowIso,
          newId: uid,
          silentCreates: new Set(spawned.map((t) => t.id)),
        }),
      );
    }
    this.history.record(before);
    this.historyVersion.update((v) => v + 1);
    this.state.set({ ...cur, ...after, notifications });
    this.syncDueNotifications();
    this.persist();
    if (spawned.length) this.announceRecurrences(spawned);
  }

  /**
   * Adds "due within 24 hours" / "overdue" reminders that have not been sent today. Runs after
   * loading, every minute and after every change (a new due date or assignee can trigger one).
   * Notifications are a feed, not task state: they are not part of undo history.
   */
  private syncDueNotifications(): void {
    const s = this.state();
    const add = dueNotifications(s.tasks, s.notifications, new Date(), uid);
    if (add.length) {
      this.state.set({ ...s, notifications: appendNotifications(s.notifications, add) });
      this.persist();
    }
  }

  markNotificationRead(id: string): void {
    this.updateNotifications((n) => (n.id === id && !n.read ? { ...n, read: true } : n));
  }

  /** Marks all notifications of the current user as read. */
  markAllNotificationsRead(): void {
    const me = this.currentUser()?.id;
    if (me)
      this.updateNotifications((n) => (n.recipientId === me && !n.read ? { ...n, read: true } : n));
  }

  private updateNotifications(fn: (n: AppNotification) => AppNotification): void {
    const s = this.state();
    let changed = false;
    const notifications = s.notifications.map((n) => {
      const next = fn(n);
      if (next !== n) changed = true;
      return next;
    });
    if (!changed) return;
    this.state.set({ ...s, notifications });
    this.persist();
  }

  private announceRecurrences(spawned: Task[]): void {
    const msg =
      spawned.length === 1
        ? `Repeating task: next “${spawned[0].title}” due ${formatShortDate(spawned[0].dueDate!)}`
        : `Created the next occurrence of ${spawned.length} repeating tasks`;
    this.toast.show(msg, { kind: 'info' });
  }

  private mapTasks(ids: Iterable<string>, fn: (t: Task) => Task): void {
    const set = new Set(ids);
    this.mutate((s) => ({ ...s, tasks: s.tasks.map((t) => (set.has(t.id) ? fn(t) : t)) }));
  }

  undo(): boolean {
    const cur = this.state();
    const prev = this.history.undo(snapshotOf(cur));
    if (!prev) return false;
    this.state.set({ ...cur, ...prev });
    this.historyVersion.update((v) => v + 1);
    this.syncDueNotifications();
    this.persist();
    return true;
  }

  redo(): boolean {
    const cur = this.state();
    const next = this.history.redo(snapshotOf(cur));
    if (!next) return false;
    this.state.set({ ...cur, ...next });
    this.historyVersion.update((v) => v + 1);
    this.syncDueNotifications();
    this.persist();
    return true;
  }

  // ---------- tasks ----------

  getTask(id: string): Task | undefined {
    return this.taskMap().get(id);
  }

  createTask(input: NewTask): Task {
    const now = new Date().toISOString();
    const task: Task = {
      subtasks: [],
      timeSpentMinutes: 0,
      assigneeId: null,
      recurrence: 'none',
      blockedBy: [],
      comments: [],
      // '' = "first status of the category" (resolved by reconcile in mutate)
      statusId: '',
      ...input,
      id: uid('t'),
      createdAt: now,
      completedAt: input.status === 'done' ? now : null,
      order: 0,
    };
    this.mutate((s) => {
      task.order = nextOrder(s.tasks, task.status);
      return { ...s, tasks: [task, ...s.tasks] };
    });
    return task;
  }

  /**
   * Applies a patch. A status change to `done` on a task with open blockers is refused (with an
   * error toast); the other fields of the patch are still applied. Returns false in that case.
   */
  updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): boolean {
    const nowIso = new Date().toISOString();
    let allowed = true;
    const current = this.getTask(id);
    if (patch.statusId !== undefined && current) {
      // a workflow status decides the category (and with it done-ness, blockers, …)
      const wf = this.workflowOf()(
        patch.projectId !== undefined ? patch.projectId : current.projectId,
      );
      const s = wf.find((x) => x.id === patch.statusId);
      patch = s ? { ...patch, status: s.category } : { ...patch, statusId: undefined };
    }
    if (patch.status === 'done' && this.getTask(id)?.status !== 'done') {
      allowed = this.guardDone([id]).length === 1;
      // refuse the status change entirely (the workflow status too), keep the other fields
      if (!allowed) patch = { ...patch, status: undefined, statusId: undefined };
    }
    this.mutate((s) => ({
      ...s,
      tasks: s.tasks.map((t) => {
        if (t.id !== id) return t;
        const { statusId, ...rest } = patch;
        let next: Task = { ...t, ...rest, status: t.status, completedAt: t.completedAt };
        if (statusId !== undefined) next = { ...next, statusId };
        if (patch.status && patch.status !== t.status) {
          next = {
            ...withStatus(next, patch.status, nowIso),
            order: nextOrder(s.tasks, patch.status),
          };
        }
        return next;
      }),
    }));
    return allowed;
  }

  /**
   * Sets the status of several tasks. Tasks with open blockers are not moved to `done` (an error
   * toast names the blockers). Returns the ids that actually changed.
   */
  setStatus(ids: Iterable<string>, status: Status): string[] {
    const nowIso = new Date().toISOString();
    const candidates = [...ids].filter((id) => {
      const t = this.getTask(id);
      return !!t && t.status !== status;
    });
    const set = new Set(status === 'done' ? this.guardDone(candidates) : candidates);
    this.mutate((s) => {
      let order = nextOrder(s.tasks, status);
      return {
        ...s,
        tasks: s.tasks.map((t) =>
          set.has(t.id) && t.status !== status
            ? { ...withStatus(t, status, nowIso), order: order++ }
            : t,
        ),
      };
    });
    return [...set];
  }

  toggleDone(id: string): void {
    const t = this.getTask(id);
    if (t) this.setStatus([id], t.status === 'done' ? 'todo' : 'done');
  }

  deleteTasks(ids: Iterable<string>): number {
    const set = new Set(ids);
    let removed = 0;
    this.mutate((s) => {
      const tasks = s.tasks.filter((t) => !set.has(t.id));
      removed = s.tasks.length - tasks.length;
      return removed ? { ...s, tasks } : s;
    });
    return removed;
  }

  moveToProject(ids: Iterable<string>, projectId: string | null): void {
    this.mapTasks(ids, (t) => (t.projectId === projectId ? t : { ...t, projectId }));
  }

  /**
   * Moves a card into a board column (a category, or one workflow status) at `index`. Refused
   * (returns false, error toast) when moving a blocked task to a done-category column.
   */
  moveOnBoard(id: string, target: ColumnTarget, index: number): boolean {
    const t = this.getTask(id);
    if (target.category === 'done' && t && t.status !== 'done' && !this.guardDone([id]).length)
      return false;
    const nowIso = new Date().toISOString();
    this.mutate((s) => ({ ...s, tasks: moveTaskTo(s.tasks, id, target, index, nowIso) }));
    return true;
  }

  /** The workflow status a task is in (for display: name and colour). */
  statusOf(t: Task): WorkflowStatus | undefined {
    return this.workflowOf()(t.projectId).find((s) => s.id === t.statusId);
  }

  /** Returns the ids that may be completed; shows one error toast for the rest. */
  private guardDone(ids: string[]): string[] {
    const { allowed, rejected } = checkCompletion(ids, this.taskMap());
    if (rejected.length) {
      const names = (ts: Task[]) => ts.map((t) => `“${t.title}”`).join(', ');
      const msg =
        rejected.length === 1
          ? `Can't complete “${rejected[0].task.title}”: it is blocked by ${names(rejected[0].blockers)}.`
          : `${rejected.length} tasks were not completed because they are blocked: ${rejected
              .map((r) => `“${r.task.title}” (by ${names(r.blockers)})`)
              .join('; ')}.`;
      this.toast.show(msg, { kind: 'error', duration: 7000 });
    }
    return allowed;
  }

  // ---------- dependencies ----------

  /** Makes `taskId` blocked by `blockerId`. Refuses self-references, duplicates and cycles. */
  addBlocker(taskId: string, blockerId: string): BlockerResult {
    const map = this.taskMap();
    const task = map.get(taskId);
    const blocker = map.get(blockerId);
    if (!task || !blocker) return { ok: false, error: 'That task no longer exists.' };
    if (task.blockedBy.includes(blockerId))
      return { ok: false, error: `“${blocker.title}” is already a blocker.` };
    const cycle = dependencyCycle(taskId, blockerId, map);
    if (cycle) {
      if (cycle.length === 1) return { ok: false, error: 'A task cannot block itself.' };
      // cycle = [blocker, …, task], each waiting for the next one
      const chain = cycle.map((id) => `“${map.get(id)?.title ?? id}”`).join(' waits for ');
      return {
        ok: false,
        error: `That would create a cycle: ${chain} already, so “${task.title}” can't also wait for “${blocker.title}”.`,
      };
    }
    this.mapTasks([taskId], (t) => ({ ...t, blockedBy: [...t.blockedBy, blockerId] }));
    return { ok: true };
  }

  removeBlocker(taskId: string, blockerId: string): void {
    this.mapTasks([taskId], (t) =>
      t.blockedBy.includes(blockerId)
        ? { ...t, blockedBy: t.blockedBy.filter((id) => id !== blockerId) }
        : t,
    );
  }

  // ---------- comments ----------

  /**
   * Adds a comment by the current user. `text` is what the user typed; `@Full Name` mentions are
   * stored as tokens. Returns the comment, or null if there is no current user or no text.
   */
  addComment(taskId: string, text: string): Comment | null {
    const author = this.currentUser();
    const body = encodeMentions(text.trim(), this.members());
    if (!author || !body || body.length > COMMENT_MAX || !this.getTask(taskId)) return null;
    const comment: Comment = {
      id: uid('c'),
      authorId: author.id,
      body,
      createdAt: new Date().toISOString(),
    };
    this.mapTasks([taskId], (t) => ({ ...t, comments: [...t.comments, comment] }));
    return comment;
  }

  addTime(id: string, minutes: number): void {
    if (minutes <= 0) return;
    this.mapTasks([id], (t) => ({ ...t, timeSpentMinutes: t.timeSpentMinutes + minutes }));
  }

  // ---------- subtasks ----------

  addSubtask(taskId: string, title: string): void {
    const t = title.trim();
    if (!t) return;
    this.mapTasks([taskId], (task) => ({
      ...task,
      subtasks: [...task.subtasks, { id: uid('s'), title: t, done: false }],
    }));
  }

  toggleSubtask(taskId: string, subId: string): void {
    this.mapTasks([taskId], (task) => ({
      ...task,
      subtasks: task.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)),
    }));
  }

  renameSubtask(taskId: string, subId: string, title: string): void {
    const t = title.trim();
    if (!t) return;
    this.mapTasks([taskId], (task) => ({
      ...task,
      subtasks: task.subtasks.map((s) => (s.id === subId ? { ...s, title: t } : s)),
    }));
  }

  removeSubtask(taskId: string, subId: string): void {
    this.mapTasks([taskId], (task) => ({
      ...task,
      subtasks: task.subtasks.filter((s) => s.id !== subId),
    }));
  }

  // ---------- projects ----------

  createProject(name: string, color: string, parentId: string | null = null): Project {
    const project: Project = {
      id: uid('p'),
      name: name.trim(),
      color,
      createdAt: new Date().toISOString(),
      parentId: parentId && this.projectMap().has(parentId) ? parentId : null,
      workflow: null,
    };
    this.mutate((s) => ({ ...s, projects: [...s.projects, project] }));
    return project;
  }

  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'color'>>): void {
    this.mutate((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }

  /**
   * Moves a project under another one (or to the top level). Refuses cycles. Tasks of projects
   * that inherit a workflow follow the new parent's workflow (statuses mapped by category).
   */
  setProjectParent(id: string, parentId: string | null): EditResult {
    const projects = this.projects();
    if (!this.projectMap().has(id)) return 'That project no longer exists.';
    if (parentId !== null && !this.projectMap().has(parentId))
      return 'That parent no longer exists.';
    if (wouldCreateCycle(projects, id, parentId))
      return 'A project cannot be moved under itself or one of its sub-projects.';
    this.mutate((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === id && p.parentId !== parentId ? { ...p, parentId } : p,
      ),
    }));
    return '';
  }

  /**
   * Deletes a project. Its tasks are unassigned or deleted (`taskMode`); its sub-projects are moved
   * up one level or deleted too (`childMode`, their tasks then follow `taskMode`). Sub-projects that
   * are moved up and inherited this project's custom workflow get a copy of it, so their tasks
   * keep their statuses.
   */
  deleteProject(
    id: string,
    taskMode: 'unassign' | 'delete',
    childMode: SubProjectMode = 'lift',
  ): void {
    this.mutate((s) => {
      const doomed = new Set(
        childMode === 'delete' ? (subtreeMap(s.projects).get(id) ?? [id]) : [id],
      );
      const victim = s.projects.find((p) => p.id === id);
      const map = new Map(s.projects.map((p) => [p.id, p]));
      const inherited = victim ? effectiveWorkflow(id, map) : null;
      const projects = s.projects
        .filter((p) => !doomed.has(p.id))
        .map((p) => {
          if (p.parentId !== id) return p;
          const lifted: Project = { ...p, parentId: victim?.parentId ?? null };
          return p.workflow === null && inherited?.sourceId
            ? { ...lifted, workflow: inherited.statuses.map((x) => ({ ...x })) }
            : lifted;
        });
      const inDoomed = (t: Task) => t.projectId !== null && doomed.has(t.projectId);
      const tasks =
        taskMode === 'delete'
          ? s.tasks.filter((t) => !inDoomed(t))
          : s.tasks.map((t) => (inDoomed(t) ? { ...t, projectId: null } : t));
      return { ...s, projects, tasks };
    });
  }

  // ---------- workflows ----------

  /** Gives a project its own copy of the workflow it currently inherits. */
  customizeWorkflow(projectId: string): void {
    const wf = this.workflowOf()(projectId);
    this.setWorkflow(
      projectId,
      wf.map((x) => ({ ...x })),
    );
  }

  /** Drops a project's custom workflow; it inherits again (tasks are mapped by category). */
  resetWorkflow(projectId: string): void {
    this.setWorkflow(projectId, null);
  }

  addStatus(projectId: string, input: Omit<WorkflowStatus, 'id'>): EditResult {
    const wf = this.editableWorkflow(projectId);
    return this.trySetWorkflow(projectId, [
      ...wf,
      { ...input, name: input.name.trim(), id: uid('st') },
    ]);
  }

  updateStatus(
    projectId: string,
    statusId: string,
    patch: Partial<Omit<WorkflowStatus, 'id'>>,
  ): EditResult {
    const wf = this.editableWorkflow(projectId);
    const clean = patch.name === undefined ? patch : { ...patch, name: patch.name.trim() };
    return this.trySetWorkflow(
      projectId,
      wf.map((x) => (x.id === statusId ? { ...x, ...clean } : x)),
    );
  }

  /** Moves a status one place up (-1) or down (+1). */
  moveStatus(projectId: string, statusId: string, delta: -1 | 1): void {
    const wf = [...this.editableWorkflow(projectId)];
    const i = wf.findIndex((x) => x.id === statusId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= wf.length) return;
    [wf[i], wf[j]] = [wf[j], wf[i]];
    this.setWorkflow(projectId, wf);
  }

  /**
   * Deletes a status; its tasks (in this project and in sub-projects inheriting the workflow) move
   * to `moveToId`. Refused when it would leave a category empty.
   */
  deleteStatus(projectId: string, statusId: string, moveToId: string): EditResult {
    const wf = this.editableWorkflow(projectId);
    const next = wf.filter((x) => x.id !== statusId);
    if (!next.some((x) => x.id === moveToId)) return 'Choose a status to move the tasks to.';
    const err = validateWorkflow(next);
    if (err) return err;
    this.mutate((s) => {
      const projects = s.projects.map((p) => (p.id === projectId ? { ...p, workflow: next } : p));
      const resolver = workflowResolver(projects);
      const tasks = s.tasks.map((t) =>
        t.statusId === statusId && resolver(t.projectId) === next
          ? { ...t, statusId: moveToId }
          : t,
      );
      return { ...s, projects, tasks };
    });
    return '';
  }

  /** Number of tasks currently in a status of the given project's workflow (incl. inheriting sub-projects). */
  tasksInStatus(projectId: string, statusId: string): number {
    const wf = this.workflowOf()(projectId);
    return this.tasks().filter(
      (t) => t.statusId === statusId && this.workflowOf()(t.projectId) === wf,
    ).length;
  }

  private editableWorkflow(projectId: string): readonly WorkflowStatus[] {
    return this.projectMap().get(projectId)?.workflow ?? this.workflowOf()(projectId);
  }

  private trySetWorkflow(projectId: string, wf: WorkflowStatus[]): EditResult {
    const err = validateWorkflow(wf);
    if (err) return err;
    if (wf.some((x) => x.name.trim().length > STATUS_NAME_MAX)) return 'Status name too long.';
    this.setWorkflow(projectId, wf);
    return '';
  }

  private setWorkflow(projectId: string, workflow: WorkflowStatus[] | null): void {
    this.mutate((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.id === projectId ? { ...p, workflow } : p)),
    }));
  }

  // ---------- members ----------

  createMember(name: string, color: string): Member {
    const member: Member = { id: uid('m'), name: name.trim(), color };
    this.mutate((s) => ({ ...s, members: [...s.members, member] }));
    return member;
  }

  updateMember(id: string, patch: Partial<Pick<Member, 'name' | 'color'>>): void {
    const clean = patch.name === undefined ? patch : { ...patch, name: patch.name.trim() };
    this.mutate((s) => ({
      ...s,
      members: s.members.map((m) => (m.id === id ? { ...m, ...clean } : m)),
    }));
  }

  /** Removes a member and unassigns their tasks (one undo step). */
  deleteMember(id: string): void {
    this.mutate((s) => ({
      ...s,
      members: s.members.filter((m) => m.id !== id),
      tasks: s.tasks.map((t) => (t.assigneeId === id ? { ...t, assigneeId: null } : t)),
    }));
  }

  // ---------- saved views ----------

  createView(name: string, params: Record<string, string>): SavedView {
    const view: SavedView = {
      id: uid('v'),
      name: name.trim(),
      params: { ...params },
      createdAt: new Date().toISOString(),
    };
    this.mutate((s) => ({ ...s, views: [...s.views, view] }));
    return view;
  }

  renameView(id: string, name: string): void {
    const n = name.trim();
    this.mutate((s) =>
      s.views.some((v) => v.id === id && v.name !== n)
        ? { ...s, views: s.views.map((v) => (v.id === id ? { ...v, name: n } : v)) }
        : s,
    );
  }

  deleteView(id: string): void {
    this.mutate((s) =>
      s.views.some((v) => v.id === id) ? { ...s, views: s.views.filter((v) => v.id !== id) } : s,
    );
  }

  // ---------- settings / whole state ----------

  updateSettings(patch: Partial<Settings>): void {
    this.state.update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
    this.persist();
  }

  replaceState(next: AppState): void {
    this.state.set(next);
    this.history.clear();
    this.historyVersion.update((v) => v + 1);
    this.syncDueNotifications();
    this.persistNow();
  }

  resetDemo(count = 300): void {
    const settings = this.settings();
    this.replaceState({ ...generateDemoData(count), settings });
  }

  exportJson(): string {
    return JSON.stringify(this.state(), null, 2);
  }
}
