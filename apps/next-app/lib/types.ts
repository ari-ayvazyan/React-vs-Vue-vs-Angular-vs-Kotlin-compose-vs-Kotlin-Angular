export type Priority = 'low' | 'medium' | 'high' | 'urgent';
/** The three fixed status categories every workflow status belongs to. */
export type StatusCategory = 'todo' | 'in_progress' | 'done';
/** @deprecated name kept for the category type; prefer StatusCategory. */
export type Status = StatusCategory;

/** One status of a project's workflow. */
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
  /** Parent project, null for a top-level project. */
  parentId: string | null;
  /** Ordered statuses; null = inherit the parent's workflow (top level: the default To do / In progress / Done). */
  workflow: WorkflowStatus[] | null;
}

/** A team member tasks can be assigned to. Initials are derived from the name (see lib/members.ts). */
export interface Member {
  id: string;
  name: string;
  /** hex colour, e.g. #0ea5e9 */
  color: string;
}

/** A named task-list query. `search` is a normalised query string (see lib/views.ts), e.g. `?status=todo&assignee=m1`. */
export interface SavedView {
  id: string;
  name: string;
  search: string;
  /** ISO timestamp */
  createdAt: string;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

/** A comment on a task. `body` stores mentions as `@{memberId}` tokens (see lib/mentions.ts). */
export interface Comment {
  id: string;
  authorId: string;
  body: string;
  /** ISO timestamp */
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  /** A status id of the task's project's effective workflow (see lib/workflow.ts). */
  statusId: string;
  /** Category of `statusId`; derived and kept in sync by the reducer. Everything status-dependent reads this. */
  category: StatusCategory;
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
  /** Ids of tasks that must be done before this one can be completed. */
  blockedBy: string[];
  /** Oldest first. */
  comments: Comment[];
}

export type ActivityType = 'create' | 'delete' | 'update' | 'comment';
/** Task fields whose changes are recorded (order/completedAt/createdAt are derived or immutable). */
export type TrackedField =
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'projectId'
  | 'tags'
  | 'dueDate'
  | 'estimateMinutes'
  | 'timeSpentMinutes'
  | 'subtasks'
  | 'assigneeId'
  | 'recurrence'
  | 'blockedBy';
export type ActivityValue = string | number | null | string[];

/** One recorded change to a task. Lives in the undoable state, so undo removes it again. */
export interface ActivityEntry {
  id: string;
  taskId: string;
  /** member who made the change; null when no (valid) current user was set */
  actorId: string | null;
  type: ActivityType;
  field?: TrackedField;
  from?: ActivityValue;
  to?: ActivityValue;
  /** ISO timestamp */
  at: string;
}

export type NotificationType = 'assigned' | 'mentioned' | 'due' | 'overdue' | 'unblocked';

/** A message for one member (`userId`). Kept outside undo history; see lib/notifications.ts. */
export interface Notification {
  id: string;
  /** recipient member id */
  userId: string;
  type: NotificationType;
  taskId: string;
  /** task title when the notification was created (the task may be renamed or deleted later) */
  taskTitle: string;
  /** who caused it (assigner, comment author, whoever completed the blocker); null for reminders */
  actorId: string | null;
  /** ISO timestamp */
  at: string;
  read: boolean;
  /** de-duplication key: one notification per key */
  key: string;
  /** type-specific details: comment snippet (mentioned), due date (due/overdue), the completed blocker's title (unblocked) */
  detail?: string;
}

export interface Settings {
  theme: ThemeSetting;
  pomodoroMinutes: number;
  pageSize: number;
  /** Member who authors comments and is recorded as the actor in the activity log. */
  currentUserId: string | null;
}

export interface AppState {
  tasks: Task[];
  projects: Project[];
  members: Member[];
  /** Oldest first. */
  activity: ActivityEntry[];
  views: SavedView[];
  /** Newest last. Not part of undo history. */
  notifications: Notification[];
  settings: Settings;
}

/** The status categories (also the default workflow's status ids). */
export const STATUSES: readonly StatusCategory[] = ['todo', 'in_progress', 'done'];
export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent'];

export const RECURRENCES: readonly Recurrence[] = ['none', 'daily', 'weekly', 'monthly'];

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

/** Category names (and the default workflow's status names). */
export const STATUS_LABEL: Record<StatusCategory, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const PRIORITY_RANK: Record<Priority, number> = { low: 0, medium: 1, high: 2, urgent: 3 };

export const DEFAULT_SETTINGS: Settings = { theme: 'system', pomodoroMinutes: 25, pageSize: 25, currentUserId: 'm1' };

/** Storage schema v2 (sub-projects, workflows). v1 data is migrated on load (see lib/store.ts). */
export const STORAGE_KEY = 'taskpilot:v2';
export const LEGACY_STORAGE_KEY = 'taskpilot:v1';
export const SCHEMA_VERSION = 2;

export const ACTIVITY_TYPES: readonly ActivityType[] = ['create', 'update', 'comment', 'delete'];
export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  create: 'Created',
  update: 'Changed',
  comment: 'Comments',
  delete: 'Deleted',
};
export const TRACKED_FIELDS: readonly TrackedField[] = [
  'title',
  'description',
  'status',
  'priority',
  'projectId',
  'tags',
  'dueDate',
  'estimateMinutes',
  'timeSpentMinutes',
  'subtasks',
  'assigneeId',
  'recurrence',
  'blockedBy',
];
