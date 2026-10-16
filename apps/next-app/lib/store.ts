import { appendActivity, diffActivity } from './activity';
import { generateDemoData } from './demo';
import { addNotifications, dueNotifications, eventNotifications, markRead } from './notifications';
import { createHistory, pushHistory, redo, undo, type History } from './history';
import { dataReducer, type Data, type DataAction } from './reducer';
import { DEFAULT_SETTINGS, LEGACY_STORAGE_KEY, SCHEMA_VERSION, STORAGE_KEY, type AppState, type Notification, type Settings } from './types';
import { validateImport } from './validation';

/** What components read. Recreated (new identity) on every change. */
export interface StoreSnapshot {
  state: AppState;
  canUndo: boolean;
  canRedo: boolean;
}

export const INITIAL_SEED_COUNT = 300;

type Listener = () => void;

/**
 * Framework-agnostic client store: undoable task/project/member data + settings, persisted to localStorage.
 * React binds to it through useSyncExternalStore (see components/store-hooks.ts).
 */
export class TaskStore {
  private history: History<Data> | null = null;
  private settings: Settings = DEFAULT_SETTINGS;
  /** Outside undo history: undoing a change does not un-send its notification, and reading one is not undoable. */
  private notifications: Notification[] = [];
  private snapshot: StoreSnapshot | null = null;
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The seed value consumed while loading from the initial URL (so the URL handler skips it once). */
  initialSeed: number | null = null;

  private activitySeq = 0;

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null,
    private readonly initialSearch = '',
    /** Injectable clock (tests). */
    private readonly now: () => Date = () => new Date(),
  ) {}

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): StoreSnapshot => {
    if (!this.snapshot) this.load();
    return this.snapshot!;
  };

  private load() {
    const seed = parseSeed(new URLSearchParams(this.initialSearch).get('seed'));
    let state: AppState | null = null;
    let fromStorage = false;
    let migrated = false;
    try {
      // Current schema first; otherwise migrate data saved by v1 (validateImport upgrades it).
      // The v1 entry is left in place as a backup; from now on only v2 is written.
      let raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) {
        raw = this.storage?.getItem(LEGACY_STORAGE_KEY);
        migrated = !!raw;
      }
      if (raw) {
        const res = validateImport(JSON.parse(raw));
        if (res.ok) {
          state = res.state;
          fromStorage = true;
        }
      }
    } catch {
      // corrupt storage: fall through to demo data
    }
    if (seed !== null) {
      this.initialSeed = seed;
      state = { ...generateDemoData(seed), settings: state?.settings ?? { ...DEFAULT_SETTINGS } };
    }
    if (!state) state = generateDemoData(INITIAL_SEED_COUNT);
    this.history = createHistory<Data>(toData(state));
    this.settings = state.settings;
    this.notifications = seed !== null ? [] : state.notifications;
    this.publish(!fromStorage || migrated || seed !== null);
  }

  private publish(persist = true) {
    const h = this.history!;
    this.snapshot = {
      state: { ...h.present, notifications: this.notifications, settings: this.settings },
      canUndo: h.past.length > 0,
      canRedo: h.future.length > 0,
    };
    if (persist) this.scheduleSave();
    for (const l of this.listeners) l();
  }

  private scheduleSave() {
    if (!this.storage) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 120);
  }

  /** Writes pending changes immediately (also called on pagehide). */
  flush = () => {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.storage || !this.snapshot) return;
    try {
      this.storage.setItem(STORAGE_KEY, serializeState(this.snapshot.state));
    } catch {
      // quota exceeded / private mode — keep working in memory
    }
  };

  /** The member recorded as actor / comment author, or null if the setting points nowhere. */
  currentUserId = (): string | null => {
    const { members, settings } = this.getSnapshot().state;
    const id = settings.currentUserId;
    return id && members.some((m) => m.id === id) ? id : null;
  };

  /**
   * Applies an action and records its activity entries in the same history step, so undo/redo
   * add and remove log entries together with the change they describe.
   */
  dispatch = (action: DataAction) => {
    this.getSnapshot();
    const h = this.history!;
    const next = dataReducer(h.present, action);
    if (next === h.present) return;
    const at = 'at' in action ? action.at : this.now().toISOString();
    const entries = diffActivity(h.present.tasks, next.tasks, { actorId: this.currentUserId(), at, nextId: this.nextActivityId });
    this.history = pushHistory(h, entries.length ? { ...next, activity: appendActivity(next.activity, entries) } : next);
    this.notifications = addNotifications(this.notifications, eventNotifications(entries, h.present.tasks, next.tasks, next.members), this.nextNotificationId);
    this.publish();
  };

  /**
   * Adds today's due/overdue reminders for the current user (idempotent: one per task per day).
   * Called by the UI when the day, the data or the current user changes.
   */
  syncDueNotifications = (today: string) => {
    const { tasks } = this.getSnapshot().state;
    const userId = this.currentUserId();
    if (!userId || !today) return;
    const next = addNotifications(this.notifications, dueNotifications(tasks, userId, today, this.now().toISOString()), this.nextNotificationId);
    if (next === this.notifications) return;
    this.notifications = next;
    this.publish();
  };

  /** Marks notifications of the current user as read (not undoable). */
  markNotificationsRead = (ids: string[] | 'all') => {
    this.getSnapshot();
    const userId = this.currentUserId();
    if (!userId) return;
    const next = markRead(this.notifications, userId, ids);
    if (next === this.notifications) return;
    this.notifications = next;
    this.publish();
  };

  private nextNotificationId = () => `n-${this.now().getTime().toString(36)}-${(this.activitySeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  private nextActivityId = () => `a-${this.now().getTime().toString(36)}-${(this.activitySeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  updateSettings = (patch: Partial<Settings>) => {
    this.getSnapshot();
    this.settings = { ...this.settings, ...patch };
    this.publish();
  };

  /** Replace everything (import / seed / reset). Undoable for tasks, projects & members. */
  replaceState = (state: AppState, keepSettings = false) => {
    this.getSnapshot();
    if (!keepSettings) this.settings = state.settings;
    // Old notifications point at tasks that no longer exist; an import brings its own.
    this.notifications = keepSettings ? [] : state.notifications;
    this.history = pushHistory(this.history!, toData(state));
    this.publish();
  };

  /** Seed handling: replaces data and clears history (benchmark hook). */
  seed = (count: number) => {
    this.getSnapshot();
    const demo = generateDemoData(count);
    this.notifications = [];
    this.history = createHistory<Data>(toData(demo));
    this.publish();
  };

  undo = () => {
    this.getSnapshot();
    const h = undo(this.history!);
    if (h === this.history) return false;
    this.history = h;
    this.publish();
    return true;
  };

  redo = () => {
    this.getSnapshot();
    const h = redo(this.history!);
    if (h === this.history) return false;
    this.history = h;
    this.publish();
    return true;
  };

  /** Another tab wrote to storage: adopt its state (history is reset). */
  reloadFromStorage = () => {
    const raw = this.storage?.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const res = validateImport(JSON.parse(raw));
      if (!res.ok) return;
      this.history = createHistory<Data>(toData(res.state));
      this.settings = res.state.settings;
      this.notifications = res.state.notifications;
      this.publish(false);
    } catch {
      // ignore
    }
  };
}

/** The persisted / exported form: the state tagged with its schema version. */
export function serializeState(state: AppState, space?: number): string {
  return JSON.stringify({ schema: SCHEMA_VERSION, ...state }, null, space);
}

function toData(state: AppState): Data {
  return { tasks: state.tasks, projects: state.projects, members: state.members, activity: state.activity, views: state.views };
}

export function parseSeed(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100_000) : null;
}
