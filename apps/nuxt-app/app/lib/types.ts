export type Priority = 'low' | 'medium' | 'high' | 'urgent';
/** Status *category*. Every workflow status belongs to one; all status-dependent logic uses the category. */
export type Status = 'todo' | 'in_progress' | 'done';
export type StatusCategory = Status;

/** One column of a project's workflow. */
export interface WorkflowStatus {
  id: string;
  name: string;
  /** hex colour */
  color: string;
  category: StatusCategory;
}
export type ThemeSetting = 'light' | 'dark' | 'system';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export interface Project {
  id: string;
  name: string;
  /** hex colour, e.g. #6366f1 */
  color: string;
  /** ISO timestamp */
  createdAt: string;
  /** parent project (any depth, never a cycle); null for top-level projects */
  parentId: string | null;
  /** own workflow, or null to inherit the parent's (top level: the default workflow) */
  workflow: WorkflowStatus[] | null;
}

/** A team member tasks can be assigned to. Initials are derived from `name`. */
export interface Member {
  id: string;
  name: string;
  /** hex colour, e.g. #0ea5e9 */
  color: string;
}

export type NotificationType = 'assigned' | 'mentioned' | 'due' | 'unblocked';

/**
 * A notification for one member. Event notifications point at the activity entry that caused them
 * (`activityId`), so undoing the change hides them again; due reminders have a `day` instead.
 */
export interface AppNotification {
  id: string;
  recipientId: string;
  type: NotificationType;
  taskId: string;
  /** member who caused it (null for reminders / unknown actor) */
  actorId: string | null;
  activityId?: string;
  /** due reminders: local day the reminder is for (one per task per day) */
  day?: string;
  /** due reminders: the task's due date at that time */
  dueDate?: string;
  /** unblocked: the completed blocker and how many open blockers remain */
  blockerId?: string;
  remaining?: number;
  /** ISO timestamp */
  at: string;
  read: boolean;
}

/** A named task-list query (filters, search and sort) shown in the sidebar under "Views". */
export interface SavedView {
  id: string;
  name: string;
  /** serialized task-list query (see lib/filters.ts serializeTaskQuery), without the page */
  query: Record<string, string>;
  /** ISO timestamp */
  createdAt: string;
}

/** A comment on a task. `body` stores mentions as `@[memberId]` tokens (see lib/mentions.ts). */
export interface TaskComment {
  id: string;
  /** member id of the author */
  authorId: string;
  body: string;
  /** ISO timestamp */
  createdAt: string;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  /** workflow status id (a status of the effective workflow of the task's project) */
  statusId: string;
  /**
   * Category of `statusId`, kept in sync by the store (lib/workflows normalizeTasks). Everything that depends on
   * "is it done / in progress" reads this.
   */
  status: Status;
  priority: Priority;
  projectId: string | null;
  tags: string[];
  /** 'YYYY-MM-DD' */
  dueDate: string | null;
  estimateMinutes: number | null;
  timeSpentMinutes: number;
  subtasks: Subtask[];
  createdAt: string;
  completedAt: string | null;
  order: number;
  /** Member id, or null when unassigned. */
  assigneeId: string | null;
  /** When not 'none', completing the task creates the next occurrence. */
  recurrence: Recurrence;
  /** Ids of tasks that must be done before this one can be done. */
  blockedBy: string[];
  /** Oldest first. */
  comments: TaskComment[];
}

export type ActivityType = 'created' | 'deleted' | 'status' | 'assignee' | 'dependencies' | 'comment' | 'updated';

/** Task fields whose changes are recorded in the activity log. */
export type LoggedField =
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'projectId'
  | 'tags'
  | 'dueDate'
  | 'estimateMinutes'
  | 'assigneeId'
  | 'recurrence'
  | 'blockedBy'
  | 'subtasks'
  | 'comments';

export type ActivityValue = string | number | null | string[];

/** One entry of the activity log. */
export interface ActivityEntry {
  id: string;
  taskId: string;
  /** member id of the current user at the time, null when no (known) current user was set */
  actorId: string | null;
  type: ActivityType;
  field?: LoggedField;
  from?: ActivityValue;
  to?: ActivityValue;
  /** ISO timestamp */
  at: string;
}

export interface Settings {
  theme: ThemeSetting;
  pomodoroMinutes: number;
  pageSize: number;
  /** Member acting as the current user (comment author, activity actor). */
  currentUserId: string | null;
}

export interface AppState {
  tasks: Task[];
  projects: Project[];
  members: Member[];
  /** Oldest first. */
  activity: ActivityEntry[];
  views: SavedView[];
  /** Newest last. Not part of undo history (read state is not an edit). */
  notifications: AppNotification[];
  settings: Settings;
}

export const STATUSES: readonly Status[] = ['todo', 'in_progress', 'done'];
export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent'];

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const RECURRENCES: readonly Recurrence[] = ['none', 'daily', 'weekly', 'monthly'];

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export const PRIORITY_RANK: Record<Priority, number> = { low: 0, medium: 1, high: 2, urgent: 3 };

export const DEFAULT_SETTINGS: Settings = { theme: 'system', pomodoroMinutes: 25, pageSize: 25, currentUserId: 'm1' };

/** Storage schema v2 (sub-projects, workflows). v1 data is migrated on load. */
export const STORAGE_KEY = 'taskpilot:v2';
export const LEGACY_STORAGE_KEYS: readonly string[] = ['taskpilot:v1'];
export const SCHEMA_VERSION = 2;

/** What is persisted and exported. */
export type PersistedState = AppState & { schemaVersion: number };
