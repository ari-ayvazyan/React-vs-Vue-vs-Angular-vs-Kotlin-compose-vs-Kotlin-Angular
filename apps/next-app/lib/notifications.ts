import { addDays, formatShort } from './dates';
import { decodeMentions, mentionedIds } from './mentions';
import type { ActivityEntry, Member, Notification, NotificationType, Task } from './types';

/** Oldest notifications are dropped beyond this. */
export const NOTIFICATION_LIMIT = 1000;

type Draft = Omit<Notification, 'id' | 'read'>;

/**
 * Notifications caused by one dispatched change, derived from its activity entries:
 * - assignee set → the new assignee is notified ("assigned");
 * - comment added → every mentioned member ("mentioned");
 * - a task became done → the assignee of each open task it blocks ("unblocked").
 * Self-caused events are included on purpose: in this single-browser app the "current user" is a
 * role you switch between, and the request asks to notify whenever these things happen to them.
 */
export function eventNotifications(entries: ActivityEntry[], before: Task[], after: Task[], members: Member[]): Draft[] {
  if (!entries.length) return [];
  const byId = new Map(after.map((t) => [t.id, t]));
  const prev = new Map(before.map((t) => [t.id, t]));
  // A status change "completes" a task when its category becomes done (status ids are per workflow).
  const completed = (taskId: string) => byId.get(taskId)?.category === 'done' && prev.get(taskId)?.category !== 'done';
  const known = new Set(members.map((m) => m.id));
  const out: Draft[] = [];
  const title = (id: string, fallback = 'a task') => byId.get(id)?.title ?? fallback;
  for (const e of entries) {
    if (e.type === 'update' && e.field === 'assigneeId' && typeof e.to === 'string' && known.has(e.to)) {
      out.push({ userId: e.to, type: 'assigned', taskId: e.taskId, taskTitle: title(e.taskId), actorId: e.actorId, at: e.at, key: `assigned:${e.id}` });
    } else if (e.type === 'comment' && typeof e.to === 'string') {
      for (const id of mentionedIds(e.to)) {
        if (!known.has(id)) continue;
        out.push({
          userId: id,
          type: 'mentioned',
          taskId: e.taskId,
          taskTitle: title(e.taskId),
          actorId: e.actorId,
          at: e.at,
          key: `mentioned:${e.id}:${id}`,
          detail: decodeMentions(e.to, members).slice(0, 140),
        });
      }
    } else if (e.type === 'update' && e.field === 'status' && completed(e.taskId)) {
      for (const t of after) {
        if (t.category === 'done' || !t.assigneeId || !known.has(t.assigneeId) || !t.blockedBy.includes(e.taskId)) continue;
        out.push({
          userId: t.assigneeId,
          type: 'unblocked',
          taskId: t.id,
          taskTitle: t.title,
          actorId: e.actorId,
          at: e.at,
          key: `unblocked:${e.id}:${t.id}`,
          detail: title(e.taskId),
        });
      }
    }
  }
  return out;
}

/**
 * Reminders for `userId`'s open tasks that are overdue or due today/tomorrow (within 24 h at
 * day granularity). Keyed per task per day, so each task produces at most one reminder a day.
 */
export function dueNotifications(tasks: Task[], userId: string, today: string, at: string): Draft[] {
  const tomorrow = addDays(today, 1);
  const out: Draft[] = [];
  for (const t of tasks) {
    if (t.assigneeId !== userId || t.category === 'done' || !t.dueDate || t.dueDate > tomorrow) continue;
    const type: NotificationType = t.dueDate < today ? 'overdue' : 'due';
    out.push({ userId, type, taskId: t.id, taskTitle: t.title, actorId: null, at, key: `due:${t.id}:${today}`, detail: t.dueDate });
  }
  return out;
}

/** Adds drafts whose key is new (ids from `nextId`), keeping at most `limit` newest. Returns `list` if nothing changed. */
export function addNotifications(list: Notification[], drafts: Draft[], nextId: () => string, limit = NOTIFICATION_LIMIT): Notification[] {
  if (!drafts.length) return list;
  const keys = new Set(list.map((n) => n.key));
  const fresh: Notification[] = [];
  for (const d of drafts) {
    if (keys.has(d.key)) continue;
    keys.add(d.key);
    fresh.push({ ...d, id: nextId(), read: false });
  }
  if (!fresh.length) return list;
  const next = [...list, ...fresh];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Marks the given ids (or every notification of `userId` when ids is 'all') as read. */
export function markRead(list: Notification[], userId: string, ids: string[] | 'all'): Notification[] {
  const set = ids === 'all' ? null : new Set(ids);
  let changed = false;
  const next = list.map((n) => {
    if (n.read || n.userId !== userId || (set && !set.has(n.id))) return n;
    changed = true;
    return { ...n, read: true };
  });
  return changed ? next : list;
}

/** The user's notifications, newest first. */
export function inbox(list: Notification[], userId: string | null): Notification[] {
  if (!userId) return [];
  const out: Notification[] = [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].userId === userId) out.push(list[i]);
  return out;
}

export function unreadCount(list: Notification[], userId: string | null): number {
  if (!userId) return 0;
  let n = 0;
  for (const x of list) if (x.userId === userId && !x.read) n++;
  return n;
}

/** One-line text (the actor's name is rendered separately when present). */
export function notificationText(n: Notification, today: string): string {
  const t = `“${n.taskTitle}”`;
  switch (n.type) {
    case 'assigned':
      return `assigned you ${t}`;
    case 'mentioned':
      return `mentioned you on ${t}`;
    case 'unblocked':
      return `completed “${n.detail ?? 'a blocker'}”, which was blocking your task ${t}`;
    case 'due':
      return `${t} is due ${n.detail === today ? 'today' : n.detail === addDays(today, 1) ? 'tomorrow' : n.detail ? formatShort(n.detail) : 'soon'}`;
    case 'overdue':
      return `${t} is overdue${n.detail ? ` (was due ${formatShort(n.detail)})` : ''}`;
  }
}
