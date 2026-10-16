import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ActivityEntry, AppNotification, Member, Task } from '~/lib/types';
import { describeNotification, dueReminders, notificationsFor, notificationsForChange, pruneNotifications } from '~/lib/notifications';
import { diffTasks } from '~/lib/activity';
import { burndown, cycleTimeByPriority, workloadByAssignee } from '~/lib/stats';
import { csvField, tasksToCsv, toCsv } from '~/lib/csv';
import { generateDemoData } from '~/lib/demo';
import { validateImport } from '~/lib/validation';
import { useTaskStore } from '~/stores/tasks';

const TODAY = '2026-03-15';
const NOW = '2026-03-15T12:00:00.000Z';
/** Local-noon timestamp for a calendar day (timezone-safe). */
const at = (day: string): string => new Date(`${day}T12:00:00`).toISOString();

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    status: 'todo',
    priority: 'medium',
    projectId: null,
    tags: [],
    dueDate: null,
    estimateMinutes: null,
    timeSpentMinutes: 0,
    subtasks: [],
    createdAt: at('2026-03-01'),
    completedAt: null,
    order: 0,
    assigneeId: null,
    recurrence: 'none',
    blockedBy: [],
    comments: [],
    // default workflow: the status id equals the category
    statusId: over.statusId ?? over.status ?? 'todo',
    ...over,
  };
}

const MEMBERS: Member[] = [
  { id: 'm1', name: 'Alex Kim', color: '#0ea5e9' },
  { id: 'm2', name: 'Sam Rivera', color: '#f97316' },
];
let seq = 0;
const makeId = (p: string): string => `${p}${++seq}`;
const change = (prev: Task[], next: Task[], actorId: string | null = 'm1'): { entries: ActivityEntry[]; notes: AppNotification[] } => {
  const entries = diffTasks(prev, next, { actorId, at: NOW, makeId });
  return { entries, notes: notificationsForChange(entries, prev, next, makeId) };
};

describe('notifications from changes', () => {
  it('notifies assignees, but not about their own actions', () => {
    const prev = [task('a')];
    const { entries, notes } = change(prev, [{ ...prev[0]!, assigneeId: 'm2' }]);
    expect(notes).toMatchObject([{ type: 'assigned', recipientId: 'm2', taskId: 'a', actorId: 'm1', activityId: entries[0]!.id, read: false }]);
    expect(change(prev, [{ ...prev[0]!, assigneeId: 'm1' }]).notes).toEqual([]);
    expect(change([], [task('n', { assigneeId: 'm2' })]).notes).toMatchObject([{ type: 'assigned', recipientId: 'm2', taskId: 'n' }]);
  });

  it('notifies mentioned members (using the full comment, not the clipped log text)', () => {
    const long = `${'x'.repeat(700)} @[m2] @[m1]`;
    const prev = [task('a')];
    const { notes } = change(prev, [{ ...prev[0]!, comments: [{ id: 'c1', authorId: 'm1', body: long, createdAt: NOW }] }]);
    expect(notes.map((n) => [n.type, n.recipientId])).toEqual([['mentioned', 'm2']]);
  });

  it('notifies the assignee of a blocked task when a blocker is completed', () => {
    const prev = [task('b1'), task('b2'), task('t', { blockedBy: ['b1', 'b2'], assigneeId: 'm2' }), task('u', { blockedBy: ['b1'], assigneeId: 'm1' })];
    const next = prev.map((t) => (t.id === 'b1' ? { ...t, statusId: 'done', status: 'done' as const, completedAt: NOW } : t));
    const { notes } = change(prev, next);
    expect(notes).toMatchObject([{ type: 'unblocked', recipientId: 'm2', taskId: 't', blockerId: 'b1', remaining: 1 }]);
  });

  it('creates due reminders once per task per day', () => {
    const tasks = [
      task('today', { assigneeId: 'm1', dueDate: TODAY }),
      task('tomorrow', { assigneeId: 'm1', dueDate: '2026-03-16' }),
      task('later', { assigneeId: 'm1', dueDate: '2026-03-17' }),
      task('late', { assigneeId: 'm1', dueDate: '2026-03-01' }),
      task('done', { assigneeId: 'm1', dueDate: TODAY, status: 'done', completedAt: NOW }),
      task('other', { assigneeId: 'm2', dueDate: TODAY }),
    ];
    const first = dueReminders(tasks, 'm1', TODAY, [], NOW, makeId);
    expect(first.map((n) => n.taskId)).toEqual(['today', 'tomorrow', 'late']);
    expect(dueReminders(tasks, 'm1', TODAY, first, NOW, makeId)).toEqual([]);
    expect(dueReminders(tasks, 'm1', '2026-03-16', first, NOW, makeId).map((n) => n.taskId)).toEqual(['today', 'tomorrow', 'later', 'late']);
  });

  it('describes notifications', () => {
    const l = { members: new Map(MEMBERS.map((m) => [m.id, m])), taskTitle: (id: string) => `T-${id}` };
    const base = { id: 'n', recipientId: 'm2', taskId: 'a', actorId: 'm1', at: NOW, read: false };
    expect(describeNotification({ ...base, type: 'assigned' }, TODAY, l)).toBe('Alex Kim assigned you “T-a”');
    expect(describeNotification({ ...base, type: 'mentioned' }, TODAY, l)).toBe('Alex Kim mentioned you on “T-a”');
    expect(describeNotification({ ...base, type: 'unblocked', blockerId: 'b', remaining: 0 }, TODAY, l)).toBe('Alex Kim completed “T-b”: “T-a” is no longer blocked');
    expect(describeNotification({ ...base, type: 'unblocked', blockerId: 'b', remaining: 2 }, TODAY, l)).toMatch(/2 still open/);
    expect(describeNotification({ ...base, actorId: null, type: 'due', day: TODAY, dueDate: TODAY }, TODAY, l)).toBe('“T-a” is due today');
    expect(describeNotification({ ...base, actorId: null, type: 'due', day: TODAY, dueDate: '2026-03-16' }, TODAY, l)).toBe('“T-a” is due tomorrow');
    expect(describeNotification({ ...base, actorId: null, type: 'due', day: TODAY, dueDate: '2026-03-10' }, TODAY, l)).toBe('“T-a” is overdue (was due Mar 10)');
  });

  it('hides and prunes notifications whose activity entry is gone', () => {
    const list: AppNotification[] = [
      { id: '1', recipientId: 'm2', type: 'assigned', taskId: 'a', actorId: 'm1', activityId: 'a1', at: NOW, read: false },
      { id: '2', recipientId: 'm2', type: 'due', taskId: 'a', actorId: null, day: TODAY, dueDate: TODAY, at: NOW, read: false },
      { id: '3', recipientId: 'm1', type: 'assigned', taskId: 'a', actorId: 'm2', activityId: 'a2', at: NOW, read: false },
    ];
    expect(notificationsFor(list, 'm2', new Set(['a1'])).map((n) => n.id)).toEqual(['2', '1']);
    expect(notificationsFor(list, 'm2', new Set()).map((n) => n.id)).toEqual(['2']);
    expect(pruneNotifications(list, new Set(['a2'])).map((n) => n.id)).toEqual(['2', '3']);
  });
});

describe('task store: notifications', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('undo hides the notification of the undone change; read state survives undo/redo', () => {
    const store = useTaskStore();
    store.replaceAll({ ...generateDemoData(0), tasks: [task('a'), task('b', { assigneeId: 'm2', dueDate: '2000-01-01' })] });
    store.updateTask('a', { assigneeId: 'm2' }); // current user m1 assigns to m2
    store.updateSettings({ currentUserId: 'm2' });
    expect(store.myNotifications.map((n) => n.type)).toEqual(['assigned']);
    const id = store.myNotifications[0]!.id;
    store.markNotificationRead(id);
    expect(store.unreadCount).toBe(0);
    store.undo();
    expect(store.myNotifications).toEqual([]);
    store.redo();
    expect(store.myNotifications).toMatchObject([{ id, read: true }]);

    store.checkDueReminders();
    store.checkDueReminders();
    expect(store.myNotifications.filter((n) => n.type === 'due').map((n) => n.taskId)).toEqual(['b']);
    expect(store.unreadCount).toBe(1);
    store.markAllNotificationsRead();
    expect(store.unreadCount).toBe(0);
    expect(store.serialize().notifications).toHaveLength(2);
  });

  it('imports notifications (optional for older data) and rejects malformed ones', () => {
    const d = generateDemoData(2);
    const { notifications: _n, ...old } = d;
    expect(validateImport(old).ok).toBe(true);
    const bad = validateImport({ ...d, notifications: [{ id: 'x', type: 'spam' }] });
    expect(bad.ok).toBe(false);
    const ok = validateImport({ ...d, notifications: [{ id: 'x', recipientId: 'm1', type: 'due', taskId: 't1', actorId: null, day: TODAY, dueDate: TODAY, at: NOW, read: true }] });
    expect(ok.ok && ok.state.notifications).toHaveLength(1);
  });
});

describe('reports', () => {
  it('computes the burndown (open tasks at the end of each day)', () => {
    const tasks = [
      task('old-open', { createdAt: at('2026-01-01') }), // open the whole window
      task('mid', { createdAt: at('2026-03-10') }), // opens on the 10th
      task('closed', { createdAt: at('2026-03-01'), status: 'done', completedAt: at('2026-03-12') }), // open until the 11th
      task('long-done', { createdAt: at('2026-01-01'), status: 'done', completedAt: at('2026-01-05') }), // never in window
      task('p', { createdAt: at('2026-03-14'), projectId: 'p1' }),
    ];
    const s = burndown(tasks, TODAY, '', 30);
    expect(s).toHaveLength(30);
    expect(s[29]).toEqual({ date: TODAY, count: 3 });
    const by = Object.fromEntries(s.map((d) => [d.date, d.count]));
    expect(by['2026-02-28']).toBe(1);
    expect(by['2026-03-01']).toBe(2);
    expect(by['2026-03-10']).toBe(3);
    expect(by['2026-03-11']).toBe(3);
    expect(by['2026-03-12']).toBe(2);
    expect(by['2026-03-14']).toBe(3);
    expect(burndown(tasks, TODAY, 'p1', 30).map((d) => d.count).slice(-3)).toEqual([0, 1, 1]);
    expect(burndown(tasks, TODAY, 'none', 30)[29]?.count).toBe(2);
  });

  it('sums open estimates per assignee and averages cycle time per priority', () => {
    const tasks = [
      task('1', { assigneeId: 'm1', estimateMinutes: 90 }),
      task('2', { assigneeId: 'm1', estimateMinutes: 30 }),
      task('3', { assigneeId: 'm1' }),
      task('4', { assigneeId: 'm1', estimateMinutes: 600, status: 'done', completedAt: NOW }),
      task('5', { estimateMinutes: 60 }),
      task('6', { assigneeId: 'gone', estimateMinutes: 15 }),
    ];
    expect(workloadByAssignee(MEMBERS, tasks).map((w) => [w.member?.id ?? null, w.open, w.minutes, w.unestimated])).toEqual([
      ['m1', 3, 120, 1],
      ['m2', 0, 0, 0],
      [null, 2, 75, 0],
    ]);
    const done = (id: string, priority: Task['priority'], from: string, to: string): Task =>
      task(id, { priority, status: 'done', createdAt: `${from}T00:00:00.000Z`, completedAt: `${to}T00:00:00.000Z` });
    const c = cycleTimeByPriority([done('a', 'high', '2026-03-01', '2026-03-03'), done('b', 'high', '2026-03-01', '2026-03-06'), done('c', 'low', '2026-03-01', '2026-03-01'), task('d', { priority: 'urgent' })]);
    expect(c).toEqual({ low: { avgDays: 0, count: 1 }, medium: { avgDays: null, count: 0 }, high: { avgDays: 3.5, count: 2 }, urgent: { avgDays: null, count: 0 } });
  });
});

describe('CSV export', () => {
  it('escapes fields and neutralises spreadsheet formulas', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField('-5 apples')).toBe("'-5 apples");
    expect(csvField(-5)).toBe('-5');
    expect(csvField(null)).toBe('');
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n');
  });

  it('exports tasks in the given order with readable values', () => {
    const tasks = [
      task('t2', { title: 'Second, really', status: 'in_progress', priority: 'high', projectId: 'p1', assigneeId: 'm2', tags: ['a', 'b'], dueDate: '2026-03-20', estimateMinutes: 60, subtasks: [{ id: 's', title: 'x', done: true }], blockedBy: ['t1'], recurrence: 'weekly' }),
      task('t1', { title: 'First' }),
    ];
    const csv = tasksToCsv(tasks, {
      projects: new Map([['p1', { id: 'p1', name: 'Website', color: '#000000', createdAt: NOW, parentId: null, workflow: null }]]),
      members: new Map(MEMBERS.map((m) => [m.id, m])),
      tasks: new Map(tasks.map((t) => [t.id, t])),
    });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('ID,Title,Status,Category,Priority,Project,Assignee,Tags,Due date,Estimate (min),Time spent (min),Subtasks done,Subtasks total,Blocked by,Repeat,Created,Completed,Description');
    expect(lines[1]).toBe(`t2,"Second, really",In progress,In progress,High,Website,Sam Rivera,a b,2026-03-20,60,0,1,1,First,Weekly,${at('2026-03-01')},,`);
    expect(lines[2]?.startsWith('t1,First,To do,To do,Medium,,,')).toBe(true);
  });
});
