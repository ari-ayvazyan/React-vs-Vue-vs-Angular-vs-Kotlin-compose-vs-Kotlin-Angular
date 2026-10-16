export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type Status = 'todo' | 'in_progress' | 'done';
export type Theme = 'light' | 'dark' | 'system';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

/** One column of a project's workflow. Its `category` drives all status-dependent logic. */
export interface WorkflowStatus {
  id: string;
  name: string;
  color: string; // hex
  category: Status;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  /** Parent project (any depth, no cycles); null for a top-level project. */
  parentId: string | null;
  /**
   * Custom workflow, or null to inherit the parent's (top-level projects then use
   * DEFAULT_WORKFLOW). Always holds at least one status of every category.
   */
  workflow: WorkflowStatus[] | null;
}

export interface Member {
  id: string;
  name: string;
  color: string; // hex
}

export interface Comment {
  id: string;
  /** Member id at the time of writing; the member may since have been removed. */
  authorId: string;
  /** Plain text; mentions are stored as `<@memberId>` tokens (see core/mentions.ts). */
  body: string;
  createdAt: string; // ISO
}

export type ActivityType =
  'created' | 'deleted' | 'status' | 'assignee' | 'dependency' | 'comment' | 'field';

export interface ActivityEntry {
  id: string;
  taskId: string;
  /** Title of the task when the entry was recorded (keeps entries of deleted tasks readable). */
  taskTitle: string;
  /** "Current user" at the time of the change; null when none was set. */
  actorId: string | null;
  type: ActivityType;
  field?: string;
  from?: string | null;
  to?: string | null;
  at: string; // ISO
}

/** A named task-list query, stored as URL query params (see core/views.ts). */
export interface SavedView {
  id: string;
  name: string;
  params: Record<string, string>;
  createdAt: string; // ISO
}

export type NotificationType = 'assigned' | 'mentioned' | 'due' | 'overdue' | 'unblocked';

export interface AppNotification {
  id: string;
  type: NotificationType;
  /** Member the notification is for. The bell shows those of the current user. */
  recipientId: string;
  taskId: string;
  /** Task title when the notification was created (readable even if the task is deleted). */
  taskTitle: string;
  /** Who caused it (current user at the time), if anyone. */
  actorId: string | null;
  /** Extra text: the comment body for mentions, the blocker's title for "unblocked". */
  detail?: string;
  /** De-duplication key, e.g. `due:<taskId>:<day>` so due reminders fire once per task per day. */
  key?: string;
  at: string; // ISO
  read: boolean;
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
  /** Workflow status id (from the project's effective workflow): the source of truth. */
  statusId: string;
  /**
   * Category of `statusId`, kept in sync by `reconcileTasks` (core/workflows.ts). Everything that
   * depends on "status" (filters, KPIs, completedAt, recurrence, …) reads this category.
   */
  status: Status;
  priority: Priority;
  projectId: string | null;
  assigneeId: string | null;
  recurrence: Recurrence;
  tags: string[];
  dueDate: string | null;
  estimateMinutes: number | null;
  timeSpentMinutes: number;
  subtasks: Subtask[];
  /** Ids of tasks that must be done before this one can be completed. */
  blockedBy: string[];
  /** Oldest first. */
  comments: Comment[];
  createdAt: string;
  completedAt: string | null;
  order: number;
}

export interface Settings {
  theme: Theme;
  pomodoroMinutes: number;
  pageSize: number;
  /** Member who authors comments and is recorded as the actor in the activity log. */
  currentUserId: string | null;
}

export interface AppState {
  /** Storage schema version (see core/migrate.ts). */
  version: typeof SCHEMA_VERSION;
  tasks: Task[];
  projects: Project[];
  members: Member[];
  /** Oldest first, capped at ACTIVITY_LIMIT entries. */
  activity: ActivityEntry[];
  views: SavedView[];
  /** Newest last, capped at NOTIFICATION_LIMIT. Not part of undo history. */
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

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  pomodoroMinutes: 25,
  pageSize: 25,
  currentUserId: 'm1',
};

export const ACTIVITY_TYPES: readonly ActivityType[] = [
  'created',
  'deleted',
  'status',
  'assignee',
  'dependency',
  'comment',
  'field',
];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  created: 'Created',
  deleted: 'Deleted',
  status: 'Status',
  assignee: 'Assignee',
  dependency: 'Dependencies',
  comment: 'Comments',
  field: 'Other fields',
};

/** Oldest entries are dropped beyond this, to keep localStorage bounded. */
export const ACTIVITY_LIMIT = 5000;
export const COMMENT_MAX = 2000;
export const NOTIFICATION_LIMIT = 500;
export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  'assigned',
  'mentioned',
  'due',
  'overdue',
  'unblocked',
];

export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = 'taskpilot:v2';
/** Older storage keys, migrated on load (see core/migrate.ts). */
export const LEGACY_STORAGE_KEY = 'taskpilot:v1';

/** Used by every project that neither customises nor inherits a custom workflow. */
export const DEFAULT_WORKFLOW: readonly WorkflowStatus[] = [
  { id: 'todo', name: 'To do', color: '#94a3b8', category: 'todo' },
  { id: 'in_progress', name: 'In progress', color: '#6366f1', category: 'in_progress' },
  { id: 'done', name: 'Done', color: '#10b981', category: 'done' },
];

export const STATUS_COLORS = [
  '#94a3b8',
  '#64748b',
  '#6366f1',
  '#3b82f6',
  '#0ea5e9',
  '#f59e0b',
  '#a855f7',
  '#ec4899',
  '#10b981',
  '#22c55e',
];

export const PROJECT_COLORS = [
  '#6366f1',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#64748b',
];

export const MEMBER_COLORS = [
  '#0ea5e9',
  '#f97316',
  '#22c55e',
  '#a855f7',
  '#ef4444',
  '#eab308',
  '#14b8a6',
  '#ec4899',
  '#64748b',
];

let idCounter = 0;
export function uid(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idCounter.toString(36)}`;
}
