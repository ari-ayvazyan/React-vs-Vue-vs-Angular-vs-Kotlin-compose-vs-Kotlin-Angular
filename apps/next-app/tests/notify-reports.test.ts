import { describe, expect, it } from 'vitest';
import { csvField, safeText, tasksToCsv, CSV_COLUMNS } from '../lib/csv';
import { NO_PROJECT } from '../lib/filters';
import {
  addNotifications,
  dueNotifications,
  eventNotifications,
  inbox,
  markRead,
  notificationText,
  unreadCount,
} from '../lib/notifications';
import { burndown, cycleTimeByPriority, workload } from '../lib/reports';
import { TaskStore } from '../lib/store';
import type { ActivityEntry, Member, Notification } from '../lib/types';
import { validateImport } from '../lib/validation';
import { generateDemoData } from '../lib/demo';
import { task } from './fixtures';

const TODAY = '2026-10-15';
const AT = '2026-10-15T12:00:00.000Z';
const MEMBERS: Member[] = [
  { id: 'm1', name: 'Alex Kim', color: '#0ea5e9' },
  { id: 'm2', name: 'Sam Rivera', color: '#f97316' },
];
const local = (key: string, h = 12) => new Date(`${key}T${String(h).padStart(2, '0')}:00:00`).toISOString();
let seq = 0;
const nextId = () => `n${++seq}`;
const entry = (p: Partial<ActivityEntry>): ActivityEntry => ({ id: `e${++seq}`, taskId: 't', actorId: 'm2', type: 'update', at: AT, ...p });

function memStore(search = '?seed=30') {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  let clock = Date.parse(AT);
  return { mem, store: new TaskStore(storage, search, () => new Date((clock += 1000))) };
}

describe('notifications: events', () => {
  it('assignment notifies the new assignee', () => {
    const t = task({ id: 't', title: 'Ship it', assigneeId: 'm1' });
    const out = eventNotifications([entry({ field: 'assigneeId', from: null, to: 'm1' })], [t], [t], MEMBERS);
    expect(out).toMatchObject([{ userId: 'm1', type: 'assigned', taskId: 't', taskTitle: 'Ship it', actorId: 'm2' }]);
    expect(eventNotifications([entry({ field: 'assigneeId', from: 'm1', to: null })], [t], [t], MEMBERS)).toEqual([]);
    expect(eventNotifications([entry({ field: 'assigneeId', to: 'ghost' })], [t], [t], MEMBERS)).toEqual([]);
  });

  it('a comment notifies each mentioned member once', () => {
    const t = task({ id: 't', title: 'Docs' });
    const out = eventNotifications([entry({ type: 'comment', to: 'hey @{m1} and @{m2} and @{m1}' })], [t], [t], MEMBERS);
    expect(out.map((n) => [n.userId, n.type, n.detail])).toEqual([
      ['m1', 'mentioned', 'hey @Alex Kim and @Sam Rivera and @Alex Kim'],
      ['m2', 'mentioned', 'hey @Alex Kim and @Sam Rivera and @Alex Kim'],
    ]);
  });

  it('completing a blocker notifies the assignees of the open tasks it blocks', () => {
    const blocker = task({ id: 'b', title: 'API', status: 'done' });
    const mine = task({ id: 'x', title: 'UI', assigneeId: 'm1', blockedBy: ['b'] });
    const doneAlready = task({ id: 'y', assigneeId: 'm2', blockedBy: ['b'], status: 'done' });
    const unassigned = task({ id: 'z', blockedBy: ['b'] });
    const before = [{ ...blocker, statusId: 'in_progress', category: 'in_progress' as const }, mine, doneAlready, unassigned];
    const out = eventNotifications([entry({ taskId: 'b', field: 'status', from: 'in_progress', to: 'done' })], before, [blocker, mine, doneAlready, unassigned], MEMBERS);
    expect(out).toMatchObject([{ userId: 'm1', type: 'unblocked', taskId: 'x', taskTitle: 'UI', detail: 'API' }]);
  });

  it('due reminders: overdue or due within a day, open tasks of the user only, keyed per task per day', () => {
    const tasks = [
      task({ id: 'a', assigneeId: 'm1', dueDate: '2026-10-10' }),
      task({ id: 'b', assigneeId: 'm1', dueDate: TODAY }),
      task({ id: 'c', assigneeId: 'm1', dueDate: '2026-10-16' }),
      task({ id: 'd', assigneeId: 'm1', dueDate: '2026-10-17' }),
      task({ id: 'e', assigneeId: 'm1', dueDate: '2026-10-01', status: 'done' }),
      task({ id: 'f', assigneeId: 'm2', dueDate: TODAY }),
    ];
    const out = dueNotifications(tasks, 'm1', TODAY, AT);
    expect(out.map((n) => [n.taskId, n.type, n.key])).toEqual([
      ['a', 'overdue', 'due:a:2026-10-15'],
      ['b', 'due', 'due:b:2026-10-15'],
      ['c', 'due', 'due:c:2026-10-15'],
    ]);
  });

  it('adds only new keys, caps the list, marks one/all read per user', () => {
    const drafts = dueNotifications([task({ id: 'a', assigneeId: 'm1', dueDate: TODAY })], 'm1', TODAY, AT);
    const list = addNotifications([], drafts, nextId);
    expect(list).toHaveLength(1);
    expect(addNotifications(list, drafts, nextId)).toBe(list);
    const capped = addNotifications(list, [{ ...drafts[0], key: 'k2' }, { ...drafts[0], key: 'k3' }], nextId, 2);
    expect(capped.map((n) => n.key)).toEqual(['k2', 'k3']);
    const other: Notification = { ...capped[0], id: 'o', userId: 'm2', key: 'o' };
    const both = [...capped, other];
    expect(unreadCount(both, 'm1')).toBe(2);
    const one = markRead(both, 'm1', [capped[0].id]);
    expect(unreadCount(one, 'm1')).toBe(1);
    const all = markRead(one, 'm1', 'all');
    expect(unreadCount(all, 'm1')).toBe(0);
    expect(unreadCount(all, 'm2')).toBe(1);
    expect(markRead(all, 'm1', 'all')).toBe(all);
    expect(inbox(all, 'm1').map((n) => n.key)).toEqual(['k3', 'k2']);
    expect(inbox(all, null)).toEqual([]);
  });

  it('describes notifications', () => {
    const base: Notification = { id: 'i', userId: 'm1', type: 'assigned', taskId: 't', taskTitle: 'Ship', actorId: 'm2', at: AT, read: false, key: 'k' };
    expect(notificationText(base, TODAY)).toBe('assigned you “Ship”');
    expect(notificationText({ ...base, type: 'mentioned' }, TODAY)).toBe('mentioned you on “Ship”');
    expect(notificationText({ ...base, type: 'due', detail: TODAY }, TODAY)).toBe('“Ship” is due today');
    expect(notificationText({ ...base, type: 'due', detail: '2026-10-16' }, TODAY)).toBe('“Ship” is due tomorrow');
    expect(notificationText({ ...base, type: 'overdue', detail: '2026-10-01' }, TODAY)).toBe('“Ship” is overdue (was due Oct 1)');
    expect(notificationText({ ...base, type: 'unblocked', detail: 'API' }, TODAY)).toBe('completed “API”, which was blocking your task “Ship”');
  });
});

describe('notifications: store', () => {
  it('records event notifications on dispatch and persists them outside undo history', () => {
    const { store, mem } = memStore();
    const t = store.getSnapshot().state.tasks.find((x) => x.assigneeId !== 'm1')!;
    store.dispatch({ type: 'task/update', id: t.id, patch: { assigneeId: 'm1' }, at: AT });
    let s = store.getSnapshot().state;
    expect(s.notifications).toHaveLength(1);
    expect(s.notifications[0]).toMatchObject({ userId: 'm1', type: 'assigned', taskId: t.id, read: false });
    store.undo();
    expect(store.getSnapshot().state.notifications).toHaveLength(1);
    store.markNotificationsRead([s.notifications[0].id]);
    s = store.getSnapshot().state;
    expect(s.notifications[0].read).toBe(true);
    expect(store.getSnapshot().canRedo).toBe(true); // marking read did not touch undo history
    store.flush();
    expect(JSON.parse(mem.get('taskpilot:v2')!).notifications[0].read).toBe(true);
  });

  it('due sync is idempotent per day and only for the current user', () => {
    // 300 demo tasks: due dates spread over today−25…today+35, so m1 certainly has some due/overdue.
    const { store } = memStore('?seed=300');
    store.syncDueNotifications(TODAY);
    const first = store.getSnapshot().state.notifications;
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((n) => n.userId === 'm1' && (n.type === 'due' || n.type === 'overdue'))).toBe(true);
    store.syncDueNotifications(TODAY);
    expect(store.getSnapshot().state.notifications).toBe(first);
    store.syncDueNotifications('2026-10-16');
    expect(store.getSnapshot().state.notifications.length).toBeGreaterThan(first.length);
    store.updateSettings({ currentUserId: null });
    const before = store.getSnapshot().state.notifications;
    store.syncDueNotifications('2026-10-17');
    expect(store.getSnapshot().state.notifications).toBe(before);
  });

  it('seeding clears notifications; imports validate them; old saves default to none', () => {
    const { store } = memStore();
    store.syncDueNotifications(TODAY);
    store.seed(10);
    expect(store.getSnapshot().state.notifications).toEqual([]);
    const good = generateDemoData(2);
    expect(validateImport({ ...good, notifications: [{ id: 'n', userId: 'm1', type: 'nope' }] }).ok).toBe(false);
    const legacy = JSON.parse(JSON.stringify(good));
    delete legacy.notifications;
    const res = validateImport(legacy);
    expect(res.ok && res.state.notifications).toEqual([]);
  });
});

describe('reports', () => {
  it('burndown counts tasks open at the end of each day', () => {
    const tasks = [
      task({ projectId: 'p1', createdAt: local('2026-10-10') }), // open since 10th
      task({ projectId: 'p1', createdAt: local('2026-10-12'), status: 'done', completedAt: local('2026-10-14') }), // open 12, 13
      task({ projectId: 'p1', createdAt: local('2026-09-01'), status: 'done', completedAt: local('2026-09-05') }), // before window
      task({ projectId: 'p2', createdAt: local('2026-10-13') }),
      task({ projectId: null, createdAt: local('2026-10-14') }),
    ];
    const p1 = burndown(tasks, 'p1', TODAY, 7);
    expect(p1.map((d) => d.date)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
    expect(p1.map((d) => d.value)).toEqual([0, 1, 1, 2, 2, 1, 1]);
    expect(burndown(tasks, null, TODAY, 7).map((d) => d.value)).toEqual([0, 1, 1, 2, 3, 3, 3]);
    expect(burndown(tasks, NO_PROJECT, TODAY, 3).map((d) => d.value)).toEqual([0, 1, 1]);
    expect(burndown(generateDemoData(300).tasks, null, TODAY, 30)).toHaveLength(30);
  });

  it('workload sums estimates of open tasks per member in hours', () => {
    const tasks = [
      task({ assigneeId: 'm1', estimateMinutes: 90 }),
      task({ assigneeId: 'm1', estimateMinutes: 30 }),
      task({ assigneeId: 'm1', estimateMinutes: null }),
      task({ assigneeId: 'm1', estimateMinutes: 600, status: 'done' }),
      task({ assigneeId: 'm2', estimateMinutes: 240 }),
      task({ assigneeId: null, estimateMinutes: 15 }),
    ];
    expect(workload(tasks, MEMBERS)).toEqual([
      { member: MEMBERS[1], hours: 4, open: 1, unestimated: 0 },
      { member: MEMBERS[0], hours: 2, open: 3, unestimated: 1 },
      { member: null, hours: 0.3, open: 1, unestimated: 0 },
    ]);
  });

  it('average cycle time per priority, urgent first', () => {
    const tasks = [
      task({ priority: 'high', status: 'done', createdAt: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-03T00:00:00.000Z' }),
      task({ priority: 'high', status: 'done', createdAt: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-06T00:00:00.000Z' }),
      task({ priority: 'low', status: 'done', createdAt: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-01T12:00:00.000Z' }),
      task({ priority: 'urgent', status: 'todo' }),
    ];
    expect(cycleTimeByPriority(tasks)).toEqual([
      { priority: 'urgent', avgDays: null, count: 0 },
      { priority: 'high', avgDays: 3.5, count: 2 },
      { priority: 'medium', avgDays: null, count: 0 },
      { priority: 'low', avgDays: 0.5, count: 1 },
    ]);
  });
});

describe('CSV export', () => {
  it('escapes fields per RFC 4180 and neutralises formulas', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(null)).toBe('');
    expect(csvField(0)).toBe('0');
    expect(safeText('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(safeText('-5 apples')).toBe("'-5 apples");
    expect(safeText('ok')).toBe('ok');
  });

  it('writes exactly the given tasks in order with resolved names', () => {
    const tasks = [
      task({ id: 'b', title: 'Second, "quoted"', projectId: 'p1', assigneeId: 'm2', tags: ['x', 'y'], dueDate: '2026-10-20', estimateMinutes: 30, blockedBy: ['a'] }),
      task({ id: 'a', title: '=evil()', description: 'multi\nline' }),
    ];
    const csv = tasksToCsv(tasks, [{ id: 'p1', name: 'Web', color: '#000000', createdAt: '', parentId: null, workflow: null }], MEMBERS);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines[1].startsWith('b,"Second, ""quoted""",To do,todo,medium,Web,Sam Rivera,x y,2026-10-20,30,0,none,a,0,0,0,')).toBe(true);
    expect(lines[2].startsWith("a,'=evil(),To do,todo,medium,,,,,,0,none,,0,0,0,")).toBe(true);
    expect(csv.endsWith('"multi\nline"\r\n')).toBe(true);
    expect(tasksToCsv([], [], [])).toBe(`${CSV_COLUMNS.join(',')}\r\n`);
  });
});
