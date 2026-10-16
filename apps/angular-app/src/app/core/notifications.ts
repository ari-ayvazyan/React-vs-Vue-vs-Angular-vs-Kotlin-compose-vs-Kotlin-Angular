import { AppNotification, Member, NOTIFICATION_LIMIT, Task } from './models';
import { parseDateKey, toDateKey } from './dates';
import { bodyToText } from './mentions';

const MENTION = /<@([^<>\s]+)>/g;
const DAY_MS = 86_400_000;

export interface NotifyContext {
  actorId: string | null;
  at: string;
  newId: (prefix: string) => string;
  /** Ids of tasks created by the system (e.g. recurring copies): not announced as assignments. */
  silentCreates?: ReadonlySet<string>;
}

function make(
  ctx: NotifyContext,
  type: AppNotification['type'],
  recipientId: string,
  task: Task,
  extra: Partial<Pick<AppNotification, 'detail' | 'key'>> = {},
): AppNotification {
  return {
    id: ctx.newId('n'),
    type,
    recipientId,
    taskId: task.id,
    taskTitle: task.title,
    actorId: ctx.actorId,
    ...extra,
    at: ctx.at,
    read: false,
  };
}

/**
 * Notifications caused by a change of the task list:
 * - `assigned`: a task got a (new) assignee, or was created with one;
 * - `mentioned`: a new comment mentions a member;
 * - `unblocked`: a task was completed, for the assignees of open tasks it was blocking.
 */
export function notificationsFromChange(
  before: readonly Task[],
  after: readonly Task[],
  ctx: NotifyContext,
): AppNotification[] {
  const out: AppNotification[] = [];
  const prev = new Map(before.map((t) => [t.id, t]));
  const completed: Task[] = [];
  for (const t of after) {
    const old = prev.get(t.id);
    if (old === t) continue;
    if (t.assigneeId && t.assigneeId !== old?.assigneeId) {
      if (old || !ctx.silentCreates?.has(t.id)) out.push(make(ctx, 'assigned', t.assigneeId, t));
    }
    if (old && t.comments !== old.comments) {
      const known = new Set(old.comments.map((c) => c.id));
      for (const c of t.comments) {
        if (known.has(c.id)) continue;
        const ids = new Set([...c.body.matchAll(MENTION)].map((m) => m[1]));
        for (const id of ids) out.push(make(ctx, 'mentioned', id, t, { detail: c.body }));
      }
    }
    if (old && old.status !== 'done' && t.status === 'done') completed.push(t);
  }
  // only blockers completed in this change count
  if (completed.length) {
    for (const t of after) {
      if (t.status === 'done' || !t.assigneeId) continue;
      for (const b of completed)
        if (t.blockedBy.includes(b.id))
          out.push(make(ctx, 'unblocked', t.assigneeId, t, { detail: b.title }));
    }
  }
  return out;
}

/** End of the due day (local), in ms. */
function dueDeadline(dueDate: string): number {
  return parseDateKey(dueDate).getTime() + DAY_MS - 1;
}

/**
 * Reminders for open, assigned tasks whose due day ends within 24 hours (`due`) or has passed
 * (`overdue`), at most once per task, recipient and calendar day.
 */
export function dueNotifications(
  tasks: readonly Task[],
  existing: readonly AppNotification[],
  now: Date,
  newId: (prefix: string) => string,
): AppNotification[] {
  const day = toDateKey(now);
  const keys = new Set(existing.map((n) => n.key).filter((k): k is string => !!k));
  const out: AppNotification[] = [];
  const nowMs = now.getTime();
  for (const t of tasks) {
    if (t.status === 'done' || !t.dueDate || !t.assigneeId) continue;
    const left = dueDeadline(t.dueDate) - nowMs;
    if (left > DAY_MS) continue;
    const key = `due:${t.id}:${t.assigneeId}:${day}`;
    if (keys.has(key)) continue;
    keys.add(key);
    out.push(
      make(
        { actorId: null, at: now.toISOString(), newId },
        left < 0 ? 'overdue' : 'due',
        t.assigneeId,
        t,
        {
          key,
          detail: t.dueDate,
        },
      ),
    );
  }
  return out;
}

/** Appends, dropping the oldest beyond the limit. Keeps identity when nothing is added. */
export function appendNotifications(
  list: AppNotification[],
  add: AppNotification[],
  limit = NOTIFICATION_LIMIT,
): AppNotification[] {
  if (!add.length) return list;
  const next = [...list, ...add];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Notifications of one member, newest first. */
export function notificationsFor(
  list: readonly AppNotification[],
  memberId: string | null,
): AppNotification[] {
  if (!memberId) return [];
  const out: AppNotification[] = [];
  for (let i = list.length - 1; i >= 0; i--)
    if (list[i].recipientId === memberId) out.push(list[i]);
  return out;
}

/** Headline of a notification, e.g. "Sam Rivera mentioned you". */
export function describeNotification(
  n: AppNotification,
  members: ReadonlyMap<string, Member>,
): { title: string; detail: string } {
  const actor = n.actorId ? (members.get(n.actorId)?.name ?? 'A former member') : null;
  const self = n.actorId !== null && n.actorId === n.recipientId;
  switch (n.type) {
    case 'assigned':
      return {
        title: self ? 'You assigned yourself' : actor ? `${actor} assigned you` : 'Assigned to you',
        detail: n.taskTitle,
      };
    case 'mentioned':
      return {
        title: `${actor ?? 'Someone'} mentioned you`,
        detail: `${n.taskTitle}: “${bodyToText(n.detail ?? '', members)}”`,
      };
    case 'due':
      return { title: 'Due within 24 hours', detail: n.taskTitle };
    case 'overdue':
      return { title: 'Overdue', detail: n.taskTitle };
    case 'unblocked':
      return {
        title: `Blocker completed: “${n.detail ?? 'a task'}”`,
        detail: n.taskTitle,
      };
  }
}
