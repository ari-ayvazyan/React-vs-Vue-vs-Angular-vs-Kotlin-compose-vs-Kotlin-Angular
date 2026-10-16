import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { UiService } from './ui.service';
import {
  AppState,
  DateFmt,
  ImportResult,
  StatusLookup,
  Task,
  TaskDraft,
  TaskQuery,
  TaskStore,
  notificationsFor,
  projectOptions,
  unreadCount,
} from './kt';

/**
 * Angular wrapper around the Kotlin `TaskStore`: exposes its state as signals and forwards actions.
 * Persistence callbacks only touch localStorage in the browser; during SSR the store stays empty
 * and `ready()` is false, so server and first client render produce identical markup.
 */
@Injectable({ providedIn: 'root' })
export class StoreService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly ui = inject(UiService);

  private readonly kt = new TaskStore(
    (key) => (this.isBrowser ? readStorage(key) : null),
    (key, json) => {
      if (this.isBrowser) writeStorage(key, json);
    },
    (key) => {
      if (this.isBrowser) removeStorage(key);
    },
  );

  private readonly _state = signal<AppState>(this.kt.state);
  private readonly _history = signal({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' });

  readonly ready = signal(false);
  readonly state = this._state.asReadonly();
  readonly history = this._history.asReadonly();
  /** Local "today" (YYYY-MM-DD); only meaningful once ready. */
  readonly today = signal('');

  readonly tasks = computed(() => this.state().tasks);
  readonly projects = computed(() => this.state().projects);
  readonly settings = computed(() => this.state().settings);
  readonly allTags = computed(() => this.state().allTags());
  readonly projectMap = computed(() => new Map(this.projects().map((p) => [p.id, p])));
  readonly members = computed(() => this.state().members);
  readonly memberMap = computed(() => new Map(this.members().map((m) => [m.id, m])));
  readonly activity = computed(() => this.state().activity);
  readonly views = computed(() => this.state().views);
  /** Status name / colour / category lookup for the current state (workflows are resolved in Kotlin). */
  readonly statuses = computed(() => new StatusLookup(this.state()));
  /** Project options in tree order with indented labels. */
  readonly projectOptions = computed(() => projectOptions(this.state()));
  /** Notifications of the current user, newest first. */
  readonly notifications = computed(() => notificationsFor(this.state(), this.settings().currentUserId));
  readonly unread = computed(() => unreadCount(this.state(), this.settings().currentUserId));
  readonly currentUser = computed(() => this.member(this.settings().currentUserId));

  constructor() {
    this.kt.subscribe(() => this.sync());
  }

  /** Loads persisted data (browser only). Returns N when `?seed=N` was applied, else -1. */
  initialize(queryString: string): number {
    const seeded = this.kt.initialize(queryString);
    if (this.kt.migratedFromLegacy) this.ui.toast('Your data was upgraded to the new format (sub-projects & workflows).', { tone: 'success' });
    this.today.set(DateFmt.today());
    this.ready.set(true);
    return seeded;
  }

  refreshToday(): void {
    const today = DateFmt.today();
    if (today === this.today()) return;
    this.today.set(today);
    // New day: due / overdue reminders are created once per task per day (rule in Kotlin).
    this.kt.refreshDueNotifications();
  }

  task(id: string) {
    return this.state().findTask(id) ?? null;
  }

  statusOf(task: Task) {
    return this.statuses().statusOf(task);
  }

  member(id: string | null | undefined) {
    return id ? (this.memberMap().get(id) ?? null) : null;
  }

  // ---- actions (all logic lives in Kotlin) ----
  createTask = (draft: TaskDraft) => this.kt.createTask(draft);
  updateTask = (id: string, draft: TaskDraft) => this.kt.updateTask(id, draft);
  deleteTask = (id: string) => this.kt.deleteTask(id);
  deleteTasks = (ids: string[]) => this.kt.deleteTasks(ids);
  toggleDone = (id: string) => this.kt.toggleDone(id);
  setStatus = (id: string, status: string) => this.kt.setStatus(id, status);
  markDone = (ids: string[]) => this.kt.markDone(ids);
  moveToProject = (ids: string[], projectId: string) => this.kt.moveToProject(ids, projectId);
  moveTask = (id: string, status: string, beforeId: string | null) => this.kt.moveTask(id, status, beforeId);
  moveTaskBy = (id: string, col: number, row: number, query: TaskQuery) =>
    this.kt.moveTaskBy(id, col, row, query, this.today());
  setDueDate = (id: string, dueDate: string) => this.kt.setDueDate(id, dueDate);
  /** Returns the new view id, or "" when the name is invalid. */
  saveView = (name: string, query: TaskQuery) => this.kt.saveView(name, query);
  renameView = (id: string, name: string) => this.kt.renameView(id, name);
  deleteView = (id: string) => this.kt.deleteView(id);
  assignTasks = (ids: string[], memberId: string) => this.kt.assignTasks(ids, memberId);
  createMember = (name: string, color: string) => this.kt.createMember(name, color);
  updateMember = (id: string, name: string, color: string) => this.kt.updateMember(id, name, color);
  deleteMember = (id: string) => this.kt.deleteMember(id);
  /** Returns an error message (e.g. a dependency cycle) or "". */
  addBlocker = (taskId: string, blockerId: string) => this.kt.addBlocker(taskId, blockerId);
  removeBlocker = (taskId: string, blockerId: string) => this.kt.removeBlocker(taskId, blockerId);
  /** Returns an error message or "". */
  addComment = (taskId: string, body: string) => this.kt.addComment(taskId, body);
  setCurrentUser = (memberId: string) => this.kt.setCurrentUser(memberId);
  markNotificationRead = (id: string) => this.kt.markNotificationRead(id);
  markAllNotificationsRead = () => this.kt.markAllNotificationsRead();
  addTimeSpent = (id: string, minutes: number) => this.kt.addTimeSpent(id, minutes);
  addSubtask = (taskId: string, title: string) => this.kt.addSubtask(taskId, title);
  toggleSubtask = (taskId: string, subId: string) => this.kt.toggleSubtask(taskId, subId);
  renameSubtask = (taskId: string, subId: string, title: string) => this.kt.renameSubtask(taskId, subId, title);
  removeSubtask = (taskId: string, subId: string) => this.kt.removeSubtask(taskId, subId);
  createProject = (name: string, color: string, parentId = '') => this.kt.createProject(name, color, parentId);
  /** Returns an error message (e.g. a cycle) or "". */
  setProjectParent = (id: string, parentId: string) => this.kt.setProjectParent(id, parentId);
  customizeWorkflow = (projectId: string) => this.kt.customizeWorkflow(projectId);
  resetWorkflow = (projectId: string) => this.kt.resetWorkflow(projectId);
  addStatus = (projectId: string, name: string, color: string, category: string) =>
    this.kt.addStatus(projectId, name, color, category);
  updateStatus = (projectId: string, statusId: string, name: string, color: string, category: string) =>
    this.kt.updateStatus(projectId, statusId, name, color, category);
  moveStatus = (projectId: string, statusId: string, delta: number) => this.kt.moveStatus(projectId, statusId, delta);
  deleteStatus = (projectId: string, statusId: string, targetId: string) =>
    this.kt.deleteStatus(projectId, statusId, targetId);
  moveTaskToColumn = (id: string, columnId: string, beforeId: string | null, boardProject: string) =>
    this.kt.moveTaskToColumn(id, columnId, beforeId, boardProject);
  updateProject = (id: string, name: string, color: string) => this.kt.updateProject(id, name, color);
  deleteProject = (id: string, deleteTasks: boolean, deleteSubprojects: boolean) =>
    this.kt.deleteProject(id, deleteTasks, deleteSubprojects);
  setTheme = (theme: string) => this.kt.setTheme(theme);
  setPomodoroMinutes = (m: number) => this.kt.setPomodoroMinutes(m);
  setPageSize = (n: number) => this.kt.setPageSize(n);
  undo = () => this.kt.undo();
  redo = () => this.kt.redo();
  loadDemoData = (count: number) => this.kt.loadDemoData(count);
  resetDemoData = () => this.kt.resetDemoData();
  importJson = (text: string): ImportResult => this.kt.importJson(text);
  exportJson = () => this.kt.exportJson();

  private sync(): void {
    this._state.set(this.kt.state);
    this.announceSpawned(this.kt.lastSpawned);
    // Rejected actions (e.g. completing a task with open blockers) are explained by Kotlin.
    if (this.kt.lastError) this.ui.toast(this.kt.lastError, { tone: 'error' });
    this._history.set({
      canUndo: this.kt.canUndo,
      canRedo: this.kt.canRedo,
      undoLabel: this.kt.undoLabel,
      redoLabel: this.kt.redoLabel,
    });
  }

  /** Completing a recurring task creates its next occurrence (in Kotlin); tell the user about it. */
  private announceSpawned(ids: string[]): void {
    const created = ids.map((id) => this.kt.state.findTask(id)).filter((t): t is Task => !!t);
    if (created.length === 1) {
      this.ui.toast(`Next “${created[0].title}” scheduled for ${DateFmt.long(created[0].dueDate)}`, { tone: 'success' });
    } else if (created.length > 1) {
      this.ui.toast(`${created.length} recurring tasks rescheduled`, { tone: 'success' });
    }
  }
}

// Keys (taskpilot:v2, legacy taskpilot:v1) and migration are decided in Kotlin; this is just the storage adapter.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, json: string): void {
  try {
    localStorage.setItem(key, json);
  } catch {
    // Quota exceeded / storage disabled: the Kotlin store keeps working in memory.
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
