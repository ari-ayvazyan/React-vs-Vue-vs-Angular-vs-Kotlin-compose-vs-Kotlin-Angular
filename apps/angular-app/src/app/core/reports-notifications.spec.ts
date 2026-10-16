import { AppNotification, Member, Task } from './models';
import {
  appendNotifications,
  describeNotification,
  dueNotifications,
  notificationsFor,
  notificationsFromChange,
} from './notifications';
import { burndown, cycleTimeByPriority, workloadByAssignee } from './reports';
import { csvCell, tasksToCsv, toCsv } from './csv';
import { generateDemoData } from './demo-data';
import { validateAppState } from './validation';

const NOW = new Date(2026, 5, 15, 12); // Mon 15 Jun 2026, local noon
const NOW_ISO = NOW.toISOString();
const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

function task(id: string, p: Partial<Task> = {}): Task {
  const t: Task = {
    id,
    title: `Task ${id}`,
    description: '',
    statusId: 'todo',
    status: 'todo',
    priority: 'medium',
    projectId: null,
    assigneeId: null,
    recurrence: 'none',
    tags: [],
    dueDate: null,
    estimateMinutes: null,
    timeSpentMinutes: 0,
    subtasks: [],
    blockedBy: [],
    comments: [],
    createdAt: NOW_ISO,
    completedAt: null,
    order: 0,
    ...p,
  };
  // the default workflow's status ids equal the categories
  return p.statusId ? t : { ...t, statusId: t.status };
}

const MEMBERS: Member[] = [
  { id: 'm1', name: 'Alex Kim', color: '#0ea5e9' },
  { id: 'm2', name: 'Sam Rivera', color: '#f97316' },
];
const MM = new Map(MEMBERS.map((m) => [m.id, m]));
let seq = 0;
const ctx = { actorId: 'm2', at: NOW_ISO, newId: (p: string) => `${p}${++seq}` };

describe('notifications from changes', () => {
  it('notifies the new assignee, including on creation (but not for silent creates)', () => {
    const a = task('a');
    const out = notificationsFromChange(
      [a],
      [
        { ...a, assigneeId: 'm1' },
        task('b', { assigneeId: 'm2' }),
        task('c', { assigneeId: 'm1' }),
      ],
      { ...ctx, silentCreates: new Set(['c']) },
    );
    expect(out.map((n) => [n.type, n.recipientId, n.taskId])).toEqual([
      ['assigned', 'm1', 'a'],
      ['assigned', 'm2', 'b'],
    ]);
    expect(out[0]).toMatchObject({ actorId: 'm2', read: false, taskTitle: 'Task a' });
    // unchanged assignee or unassigning: nothing
    const x = task('x', { assigneeId: 'm1' });
    expect(notificationsFromChange([x], [{ ...x, title: 'y' }], ctx)).toEqual([]);
    expect(notificationsFromChange([x], [{ ...x, assigneeId: null }], ctx)).toEqual([]);
  });

  it('notifies each member mentioned in a new comment once', () => {
    const t = task('t');
    const c = {
      id: 'c1',
      authorId: 'm2',
      body: 'hey <@m1> and <@m1>, cc <@m2>',
      createdAt: NOW_ISO,
    };
    const out = notificationsFromChange([t], [{ ...t, comments: [c] }], ctx);
    expect(out.map((n) => [n.type, n.recipientId])).toEqual([
      ['mentioned', 'm1'],
      ['mentioned', 'm2'],
    ]);
    expect(describeNotification(out[0], MM)).toEqual({
      title: 'Sam Rivera mentioned you',
      detail: 'Task t: “hey @Alex Kim and @Alex Kim, cc @Sam Rivera”',
    });
  });

  it('notifies assignees of open tasks when one of their blockers is completed', () => {
    const b = task('b', { title: 'Blocker' });
    const t1 = task('t1', { blockedBy: ['b'], assigneeId: 'm1' });
    const t2 = task('t2', { blockedBy: ['b'] }); // unassigned: nobody to notify
    const t3 = task('t3', { blockedBy: ['b'], assigneeId: 'm2', status: 'done' });
    const out = notificationsFromChange(
      [b, t1, t2, t3],
      [{ ...b, status: 'done', completedAt: NOW_ISO }, t1, t2, t3],
      ctx,
    );
    expect(out.map((n) => [n.type, n.recipientId, n.taskId, n.detail])).toEqual([
      ['unblocked', 'm1', 't1', 'Blocker'],
    ]);
    expect(describeNotification(out[0], MM).title).toBe('Blocker completed: “Blocker”');
  });
});

describe('due reminders', () => {
  const tasks = [
    task('today', { assigneeId: 'm1', dueDate: '2026-06-15' }), // ends in < 24h
    task('tomorrow', { assigneeId: 'm1', dueDate: '2026-06-16' }), // ends in ~36h
    task('late', { assigneeId: 'm2', dueDate: '2026-06-10' }),
    task('done', { assigneeId: 'm1', dueDate: '2026-06-10', status: 'done' }),
    task('nobody', { dueDate: '2026-06-10' }),
  ];

  it('fires for open assigned tasks due within 24 hours or overdue', () => {
    const out = dueNotifications(tasks, [], NOW, ctx.newId);
    expect(out.map((n) => [n.type, n.taskId, n.recipientId])).toEqual([
      ['due', 'today', 'm1'],
      ['overdue', 'late', 'm2'],
    ]);
    // the next day the "tomorrow" task is due within 24h
    const late = new Date(2026, 5, 16, 1);
    expect(dueNotifications(tasks, out, late, ctx.newId).map((n) => n.taskId)).toEqual([
      'today',
      'tomorrow',
      'late',
    ]);
  });

  it('fires once per task, recipient and day', () => {
    const first = dueNotifications(tasks, [], NOW, ctx.newId);
    const later = new Date(2026, 5, 15, 23, 30);
    expect(dueNotifications(tasks, first, later, ctx.newId)).toEqual([]);
    // reassigning: the new assignee is reminded too
    const re = tasks.map((t) => (t.id === 'late' ? { ...t, assigneeId: 'm1' } : t));
    expect(
      dueNotifications(re, first, later, ctx.newId).map((n) => [n.taskId, n.recipientId]),
    ).toEqual([['late', 'm1']]);
  });

  it('filters per recipient (newest first) and caps the list', () => {
    const mk = (id: string, recipientId: string): AppNotification => ({
      id,
      type: 'due',
      recipientId,
      taskId: 't',
      taskTitle: 't',
      actorId: null,
      at: NOW_ISO,
      read: false,
    });
    const list = [mk('1', 'm1'), mk('2', 'm2'), mk('3', 'm1')];
    expect(notificationsFor(list, 'm1').map((n) => n.id)).toEqual(['3', '1']);
    expect(notificationsFor(list, null)).toEqual([]);
    expect(appendNotifications(list, [])).toBe(list);
    expect(appendNotifications(list, [mk('4', 'm1')], 3).map((n) => n.id)).toEqual(['2', '3', '4']);
  });

  it('import validation defaults and checks notifications', () => {
    const s = generateDemoData(2, NOW);
    const legacy = { ...s } as Partial<typeof s>;
    delete legacy.notifications;
    const r = validateAppState(legacy);
    expect(r.ok && r.state.notifications).toEqual([]);
    expect(validateAppState({ ...s, notifications: [{ id: 'x', type: 'nope' }] }).ok).toBe(false);
  });
});

describe('reports', () => {
  it('reconstructs open tasks per day (burndown) for a project', () => {
    const tasks = [
      task('a', { projectId: 'p1', createdAt: iso(2026, 6, 1) }), // open all along
      task('b', {
        projectId: 'p1',
        createdAt: iso(2026, 6, 10),
        status: 'done',
        completedAt: iso(2026, 6, 13),
      }),
      task('c', { projectId: 'p2', createdAt: iso(2026, 6, 1) }),
      task('d', { createdAt: iso(2026, 6, 14) }),
    ];
    const d = burndown(tasks, 'p1', NOW, 7); // Jun 9 … Jun 15
    expect(d.map((x) => x.date)).toEqual([
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
    ]);
    expect(d.map((x) => x.count)).toEqual([1, 2, 2, 2, 1, 1, 1]);
    // Jun 14–15, all projects: a, c, d open; b was completed on Jun 13
    expect(burndown(tasks, '', NOW, 2).map((x) => x.count)).toEqual([3, 3]);
    expect(burndown(tasks, 'none', NOW, 2).map((x) => x.count)).toEqual([1, 1]);
  });

  it('sums estimates of open tasks per assignee', () => {
    const w = workloadByAssignee(
      [
        task('1', { assigneeId: 'm1', estimateMinutes: 90 }),
        task('2', { assigneeId: 'm1', estimateMinutes: 30 }),
        task('3', { assigneeId: 'm1', estimateMinutes: 600, status: 'done' }),
        task('4', { assigneeId: 'm2' }),
        task('5', { estimateMinutes: 60 }),
        task('6', { assigneeId: 'ghost', estimateMinutes: 15 }),
      ],
      MEMBERS,
    );
    expect(w.map((r) => [r.member?.id ?? null, r.minutes, r.openTasks, r.unestimated])).toEqual([
      ['m1', 120, 2, 0],
      ['m2', 0, 1, 1],
      [null, 75, 2, 0],
    ]);
  });

  it('averages cycle time per priority', () => {
    const c = cycleTimeByPriority([
      task('1', {
        priority: 'high',
        status: 'done',
        createdAt: iso(2026, 6, 1),
        completedAt: iso(2026, 6, 3),
      }),
      task('2', {
        priority: 'high',
        status: 'done',
        createdAt: iso(2026, 6, 1),
        completedAt: iso(2026, 6, 6),
      }),
      task('3', {
        priority: 'low',
        status: 'done',
        createdAt: iso(2026, 6, 1, 0),
        completedAt: iso(2026, 6, 1, 12),
      }),
      task('4', { priority: 'urgent' }),
    ]);
    expect(c).toEqual([
      { priority: 'low', count: 1, avgDays: 0.5 },
      { priority: 'medium', count: 0, avgDays: null },
      { priority: 'high', count: 2, avgDays: 3.5 },
      { priority: 'urgent', count: 0, avgDays: null },
    ]);
  });
});

describe('CSV export', () => {
  it('escapes cells and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(
      toCsv([
        ['a', 1],
        ['b', null],
      ]),
    ).toBe('a,1\r\nb,\r\n');
  });

  it('exports tasks in the given order with resolved names', () => {
    const tasks = [
      task('t2', {
        title: 'Second, "quoted"',
        projectId: 'p1',
        assigneeId: 'm1',
        tags: ['bug', 'ui'],
        blockedBy: ['t1'],
        dueDate: '2026-06-20',
        estimateMinutes: 30,
        subtasks: [
          { id: 's', title: 's', done: true },
          { id: 's2', title: 's2', done: false },
        ],
        recurrence: 'weekly',
      }),
      task('t1', { title: 'First' }),
    ];
    const csv = tasksToCsv(tasks, {
      projects: new Map([
        [
          'p1',
          {
            id: 'p1',
            name: 'Website',
            color: '#000000',
            createdAt: NOW_ISO,
            parentId: null,
            workflow: null,
          },
        ],
      ]),
      members: MM,
      tasks: new Map(tasks.map((t) => [t.id, t])),
    });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith('ID,Title,Status,Status category,Priority,Project,Assignee')).toBe(
      true,
    );
    expect(lines[1]).toBe(
      `t2,"Second, ""quoted""",To do,To do,Medium,Website,Alex Kim,bug ui,2026-06-20,30,0,1,2,First,Weekly,${NOW_ISO},,`,
    );
    expect(lines[2].startsWith('t1,First,')).toBe(true);
  });
});
