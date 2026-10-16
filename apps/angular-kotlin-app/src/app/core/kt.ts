/**
 * Thin TypeScript facade over the Kotlin/JS library (`core/`, compiled to ES modules).
 * Kotlin `object`s and companions are exposed as singletons; nothing here contains business logic.
 */
import * as core from '@taskpilot/core';

export type {
  AppState,
  BoardColumn,
  ProjectNode,
  ProjectOption,
  WorkflowStatus,
  AppNotification,
  BarDatum,
  Burndown,
  HBarChart,
  SavedView,
  Timeline,
  TimelineBar,
  TimelineRow,
  ActivityEntry,
  ActivityPage,
  Comment,
  CommentSegment,
  MentionQuery,
  Member,
  AssigneeLoad,
  BarChart,
  Task,
  Project,
  Subtask,
  Settings,
  TaskPage,
  DashboardStats,
  DayCount,
  PrioritySlice,
  ProjectProgress,
  LineChart,
  Donut,
  MonthGrid,
  CalendarDay,
  DraftValidation,
  ImportResult,
  ShortcutHelp,
} from '@taskpilot/core';

export {
  buildBurndown,
  buildHBars,
  cycleTimeByPriority,
  exportTaskCount,
  exportTasksCsv,
  notificationsFor,
  unreadCount,
  workloadByAssignee,
  activeView,
  boardColumns,
  projectOptions,
  projectPath,
  projectTree,
  remapStatus,
  StatusLookup,
  validateParent,
  validateWorkflow,
  workflowFor,
  workflowUsage,
  buildTimeline,
  describeTaskQuery,
  timelineDayAt,
  timelineDayEndX,
  timelinePreview,
  shiftDate,
  validateViewName,
  ActivityQuery,
  applyMention,
  blockedTasks,
  blockerCandidates,
  blockerTasks,
  describeActivity,
  isBlocked,
  mentionAt,
  mentionSuggestions,
  openBlockers,
  queryActivity,
  renderComment,
  taskActivity,
  validateComment,
  TaskStore,
  TaskQuery,
  TaskDraft,
  PomodoroTimer,
  ShortcutInterpreter,
  boardColumn,
  buildAssigneeBars,
  buildDonut,
  buildLineChart,
  buildMonthGrid,
  computeDashboardStats,
  isTaskOverdue,
  nearestPointIndex,
  nextOccurrenceDate,
  parseTags,
  projectProgress,
  queryTasks,
  shiftMonth,
  unassignedTaskCount,
  validateMember,
  validateProject,
  validateTaskDraft,
  yearMonthOf,
} from '@taskpilot/core';

export const Status = core.Status.getInstance();
export const Priority = core.Priority.getInstance();
export const Theme = core.Theme.getInstance();
export const Recurrence = core.Recurrence.getInstance();
export const ActivityType = core.ActivityType.getInstance();
export const TimelineZoom = core.TimelineZoom.getInstance();
export const DueFilter = core.DueFilter.getInstance();
export const SortKey = core.SortKey.getInstance();
export const Limits = core.Limits.getInstance();
export const DateFmt = core.DateFmt.getInstance();
export const ShortcutAction = core.ShortcutAction.getInstance();
/*
 * Kotlin companions are exposed at runtime as a static getter returning the instance, but the generated
 * .d.mts types `X.Companion` as an abstract class; this helper re-types it as the instance.
 */
const companion = <T>(c: unknown) => c as T;
export const TaskQueries = companion<core.TaskQuery.Companion.$metadata$.constructor>(core.TaskQuery.Companion);
export const TaskDrafts = companion<core.TaskDraft.Companion.$metadata$.constructor>(core.TaskDraft.Companion);
export const ActivityQueries = companion<core.ActivityQuery.Companion.$metadata$.constructor>(core.ActivityQuery.Companion);
export const Shortcuts = companion<core.ShortcutInterpreter.Companion.$metadata$.constructor>(
  core.ShortcutInterpreter.Companion,
);
export const NO_PROJECT = core.NO_PROJECT.get();
export const UNASSIGNED = core.UNASSIGNED.get();
export const STORAGE_KEY = core.STORAGE_KEY.get();
export const LEGACY_STORAGE_KEY = core.LEGACY_STORAGE_KEY.get();
export const Workflows = core.Workflows.getInstance();
export const PROJECT_PALETTE = core.PROJECT_PALETTE.get();
