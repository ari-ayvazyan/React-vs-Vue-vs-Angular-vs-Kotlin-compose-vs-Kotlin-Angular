import type { ActivityEntry, AppNotification, Member, Task } from './types';
import { addDaysISO, daysBetween, formatDate } from './dates';
import { openBlockers } from './dependencies';
import { mentionedIds } from './mentions';

/** Oldest notifications are dropped beyond this many. */
export const NOTIFICATION_LIMIT = 500;

type MakeId = (prefix: string) => string;

/**
 * Notifications caused by one recorded change, derived from its activity entries:
 * - assigned: a task was assigned to someone (also when created with an assignee),
 * - mentioned: someone was @mentioned in a new comment,
 * - unblocked: a blocker of someone's open task was completed.
 * Nobody is notified about their own actions.
 */
export function notificationsForChange(entries: readonly ActivityEntry[], prev: readonly Task[], next: readonly Task[], makeId: MakeId): AppNotification[] {
  if (entries.length === 0) return [];
  const prevById = new Map(prev.map((t) => [t.id, t]));
  const nextById = new Map(next.map((t) => [t.id, t]));
  const out: AppNotification[] = [];
  const push = (e: ActivityEntry, recipientId: string, type: AppNotification['type'], taskId: string, extra: Partial<AppNotification> = {}): void => {
    if (recipientId === e.actorId) return;
    out.push({ id: makeId('n'), recipientId, type, taskId, actorId: e.actorId, activityId: e.id, at: e.at, read: false, ...extra });
  };
  // comments added per task, in order, to pair with their (possibly clipped) activity entries
  const addedComments = new Map<string, string[]>();
  const commentBodies = (taskId: string): string[] => {
    let list = addedComments.get(taskId);
    if (!list) {
      const before = new Set(prevById.get(taskId)?.comments.map((c) => c.id) ?? []);
      list = (nextById.get(taskId)?.comments ?? []).filter((c) => !before.has(c.id)).map((c) => c.body);
      addedComments.set(taskId, list);
    }
    return list;
  };

  for (const e of entries) {
    const task = nextById.get(e.taskId);
    if (e.type === 'assignee' && typeof e.to === 'string') push(e, e.to, 'assigned', e.taskId);
    else if (e.type === 'created' && task?.assigneeId) push(e, task.assigneeId, 'assigned', e.taskId);
    else if (e.type === 'comment' && e.to !== undefined) {
      const body = commentBodies(e.taskId).shift() ?? String(e.to);
      for (const id of mentionedIds(body)) push(e, id, 'mentioned', e.taskId);
    } else if (e.type === 'status' && task?.status === 'done' && prevById.get(e.taskId)?.status !== 'done') {
      // the *category* became done (a move between two done statuses does not count)
      for (const t of next) {
        if (t.status === 'done' || !t.assigneeId || !t.blockedBy.includes(e.taskId)) continue;
        push(e, t.assigneeId, 'unblocked', t.id, { blockerId: e.taskId, remaining: openBlockers(t, nextById).length });
      }
    }
  }
  return out;
}

/**
 * Due reminders for `userId`: open tasks assigned to them that are due today or tomorrow, or overdue.
 * At most one per task per day (`existing` is checked for a reminder with the same task and day).
 */
export function dueReminders(tasks: readonly Task[], userId: string, today: string, existing: readonly AppNotification[], nowISO: string, makeId: MakeId): AppNotification[] {
  const tomorrow = addDaysISO(today, 1);
  const done = new Set(existing.filter((n) => n.type === 'due' && n.recipientId === userId && n.day === today).map((n) => n.taskId));
  const out: AppNotification[] = [];
  for (const t of tasks) {
    if (t.assigneeId !== userId || t.status === 'done' || !t.dueDate || t.dueDate > tomorrow || done.has(t.id)) continue;
    out.push({ id: makeId('n'), recipientId: userId, type: 'due', taskId: t.id, actorId: null, day: today, dueDate: t.dueDate, at: nowISO, read: false });
  }
  return out;
}

/** Append and keep the newest `limit`. Returns `list` itself when nothing is added. */
export function appendNotifications(list: AppNotification[], added: readonly AppNotification[], limit = NOTIFICATION_LIMIT): AppNotification[] {
  if (added.length === 0) return list;
  const next = [...list, ...added];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Event notifications whose activity entry is gone (undone, or dropped from the log) are not shown. */
export function isLive(n: AppNotification, activityIds: ReadonlySet<string>): boolean {
  return n.activityId === undefined || activityIds.has(n.activityId);
}

/** Notifications for one member, newest first. */
export function notificationsFor(all: readonly AppNotification[], recipientId: string, activityIds: ReadonlySet<string>): AppNotification[] {
  const out: AppNotification[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const n = all[i] as AppNotification;
    if (n.recipientId === recipientId && isLive(n, activityIds)) out.push(n);
  }
  return out;
}

/** Drop notifications that can never be shown again (their activity entry no longer exists). */
export function pruneNotifications(all: readonly AppNotification[], activityIds: ReadonlySet<string>): AppNotification[] {
  return all.filter((n) => isLive(n, activityIds));
}

export interface NotificationLookups {
  members: ReadonlyMap<string, Member>;
  taskTitle: (id: string) => string;
}

/** One-line description, e.g. "Sam Rivera assigned you “Fix login”". */
export function describeNotification(n: AppNotification, today: string, l: NotificationLookups): string {
  const who = n.actorId ? (l.members.get(n.actorId)?.name ?? 'A former member') : 'Someone';
  const title = `“${l.taskTitle(n.taskId)}”`;
  switch (n.type) {
    case 'assigned':
      return `${who} assigned you ${title}`;
    case 'mentioned':
      return `${who} mentioned you on ${title}`;
    case 'unblocked': {
      const blocker = `“${l.taskTitle(n.blockerId ?? '')}”`;
      return n.remaining
        ? `${who} completed ${blocker}, a blocker of ${title} (${n.remaining} still open)`
        : `${who} completed ${blocker}: ${title} is no longer blocked`;
    }
    case 'due': {
      const due = n.dueDate ?? today;
      const day = n.day ?? today;
      const diff = daysBetween(day, due);
      if (diff < 0) return `${title} is overdue (was due ${formatDate(due)})`;
      return `${title} is due ${diff === 0 ? 'today' : 'tomorrow'}`;
    }
  }
}
