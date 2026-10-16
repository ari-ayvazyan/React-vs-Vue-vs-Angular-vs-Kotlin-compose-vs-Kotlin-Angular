import { DEMO_MEMBERS, generateDemoData, mulberry32 } from './demo-data';
import { DEFAULT_QUERY, filterTasks, matchesAssignee, parseQuery, serializeQuery } from './filters';
import { avatarTextColor, initials, validateMemberName } from './members';
import { Member, Task } from './models';
import { addMonthsClamped, advanceDueDate, nextOccurrence, spawnRecurrences } from './recurrence';
import { openByAssignee } from './stats';
import { validateAppState } from './validation';
import { niceScale, scaleTicks } from './chart-scale';
import { toDateKey } from './dates';

const NOW = new Date(2026, 5, 15, 12, 0, 0); // 15 Jun 2026, local noon
const TODAY = toDateKey(NOW);
const NOW_ISO = NOW.toISOString();

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

let idSeq = 0;
const ctx = { today: TODAY, nowIso: NOW_ISO, newId: (prefix: string) => `${prefix}_new${++idSeq}` };

/** FNV-1a, enough to pin generator output in a test. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

describe('demo data: members, assignees, recurrence', () => {
  it('keeps every pre-existing generated value unchanged (fingerprint taken before this change)', () => {
    const s = generateDemoData(300, NOW);
    // Timestamps are reduced to local date keys so the fingerprint does not depend on the TZ.
    const legacy = s.tasks.map((t) => [
      t.id,
      t.title,
      t.description,
      t.status,
      t.priority,
      t.projectId,
      t.tags,
      t.dueDate,
      t.estimateMinutes,
      t.timeSpentMinutes,
      t.subtasks,
      toDateKey(new Date(t.createdAt)),
      t.completedAt && toDateKey(new Date(t.completedAt)),
      t.order,
    ]);
    expect(fnv(JSON.stringify(legacy))).toBe('b9f60233');
    expect(fnv(JSON.stringify(s.projects.map((p) => [p.id, p.name, p.color])))).toBe('3c8a2cd1');
  });

  it('adds the five demo members with fixed ids and colours', () => {
    expect(generateDemoData(1, NOW).members).toEqual([
      { id: 'm1', name: 'Alex Kim', color: '#0ea5e9' },
      { id: 'm2', name: 'Sam Rivera', color: '#f97316' },
      { id: 'm3', name: 'Jordan Lee', color: '#22c55e' },
      { id: 'm4', name: 'Taylor Brooks', color: '#a855f7' },
      { id: 'm5', name: 'Morgan Patel', color: '#ef4444' },
    ]);
  });

  it('draws assignee then recurrence per task from mulberry32(7)', () => {
    const s = generateDemoData(300, NOW);
    const r = mulberry32(7);
    for (const t of s.tasks) {
      const k = Math.floor(r() * 6);
      expect(t.assigneeId).toBe(k === 5 ? null : DEMO_MEMBERS[k].id);
      expect(t.recurrence).toBe(r() < 0.1 ? 'weekly' : 'none');
    }
    // pinned values, independent of the loop above
    expect(
      s.tasks
        .slice(0, 8)
        .map((t) => `${t.assigneeId}:${t.recurrence}`)
        .join(' '),
    ).toBe('m1:weekly null:none m4:none m3:none m4:none m2:none m5:none m2:none');
    expect(s.tasks.filter((t) => t.recurrence === 'weekly')).toHaveLength(26);
    expect(s.tasks.filter((t) => t.assigneeId === null)).toHaveLength(40);
    expect(validateAppState(s).ok).toBe(true);
  });
});

describe('members', () => {
  it('derives initials from the name', () => {
    expect(initials('Alex Kim')).toBe('AK');
    expect(initials('  taylor   van der Brooks ')).toBe('TB');
    expect(initials('Cher')).toBe('C');
    expect(initials('élodie durand')).toBe('ÉD');
    expect(initials('')).toBe('?');
  });

  it('picks the avatar text colour with the better contrast', () => {
    expect(avatarTextColor('#22c55e')).toBe('#111827'); // light green -> dark text
    expect(avatarTextColor('#f97316')).toBe('#111827');
    expect(avatarTextColor('#a855f7')).toBe('#111827'); // 4.3:1 vs 3.96:1 with white
    expect(avatarTextColor('#7c3aed')).toBe('#ffffff');
    expect(avatarTextColor('#1e3a8a')).toBe('#ffffff');
    expect(avatarTextColor('not-a-colour')).toBe('#ffffff');
  });

  it('validates member names (required, max length, unique ignoring case)', () => {
    const members: Member[] = [{ id: 'm1', name: 'Alex Kim', color: '#0ea5e9' }];
    expect(validateMemberName('  ', members)).toMatch(/required/);
    expect(validateMemberName('x'.repeat(61), members)).toMatch(/60/);
    expect(validateMemberName('alex kim', members)).toMatch(/exists/);
    expect(validateMemberName('alex kim', members, 'm1')).toBe('');
    expect(validateMemberName('Sam', members)).toBe('');
  });
});

describe('assignee filter', () => {
  const tasks = [task('a', { assigneeId: 'm1' }), task('b', { assigneeId: 'm2' }), task('c')];

  it('matches anyone, unassigned or a specific member', () => {
    expect(tasks.filter((t) => matchesAssignee(t, '')).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(tasks.filter((t) => matchesAssignee(t, 'none')).map((t) => t.id)).toEqual(['c']);
    expect(
      filterTasks(tasks, { ...DEFAULT_QUERY, assignee: 'm2' }, TODAY).map((t) => t.id),
    ).toEqual(['b']);
  });

  it('round-trips through the URL query', () => {
    const q = parseQuery({ assignee: 'm3', status: 'todo' });
    expect(q.assignee).toBe('m3');
    expect(serializeQuery(q)).toEqual({ assignee: 'm3', status: 'todo' });
    expect(serializeQuery(DEFAULT_QUERY)).toEqual({});
  });
});

describe('open tasks per assignee', () => {
  it('counts open tasks per member in member order, unknown ids as unassigned', () => {
    const members: Member[] = [
      { id: 'm1', name: 'A', color: '#000000' },
      { id: 'm2', name: 'B', color: '#ffffff' },
    ];
    const res = openByAssignee(
      [
        task('1', { assigneeId: 'm2' }),
        task('2', { assigneeId: 'm2', status: 'in_progress' }),
        task('3', { assigneeId: 'm2', status: 'done' }),
        task('4', { assigneeId: 'm1', status: 'done' }),
        task('5'),
        task('6', { assigneeId: 'ghost' }),
      ],
      members,
    );
    expect(res.map((r) => [r.member?.id ?? null, r.count])).toEqual([
      ['m1', 0],
      ['m2', 2],
      [null, 2],
    ]);
  });
});

describe('recurrence', () => {
  it('advances due dates by day, week and month (clamped to month end)', () => {
    expect(advanceDueDate('2026-06-15', 'daily')).toBe('2026-06-16');
    expect(advanceDueDate('2026-12-31', 'daily')).toBe('2027-01-01');
    expect(advanceDueDate('2026-06-28', 'weekly')).toBe('2026-07-05');
    expect(advanceDueDate('2026-03-29', 'weekly')).toBe('2026-04-05'); // across DST change
    expect(advanceDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advanceDueDate('2028-01-31', 'monthly')).toBe('2028-02-29');
    expect(advanceDueDate('2026-12-15', 'monthly')).toBe('2027-01-15');
    expect(toDateKey(addMonthsClamped(new Date(2026, 4, 31), 1))).toBe('2026-06-30');
  });

  it('builds the next occurrence: todo, advanced due, subtasks reset, no time spent', () => {
    const done = task('r', {
      status: 'done',
      completedAt: NOW_ISO,
      recurrence: 'weekly',
      dueDate: '2026-06-10',
      timeSpentMinutes: 95,
      assigneeId: 'm1',
      projectId: 'p1',
      tags: ['meeting'],
      subtasks: [
        { id: 's1', title: 'Prep', done: true },
        { id: 's2', title: 'Notes', done: false },
      ],
    });
    const next = nextOccurrence(done, 7, ctx)!;
    expect(next.id).not.toBe('r');
    expect(next).toMatchObject({
      status: 'todo',
      dueDate: '2026-06-17',
      timeSpentMinutes: 0,
      completedAt: null,
      createdAt: NOW_ISO,
      order: 7,
      assigneeId: 'm1',
      projectId: 'p1',
      recurrence: 'weekly',
      title: 'Task r',
    });
    expect(next.subtasks.map((s) => [s.title, s.done])).toEqual([
      ['Prep', false],
      ['Notes', false],
    ]);
    expect(next.subtasks.map((s) => s.id)).not.toContain('s1');
    expect(next.tags).not.toBe(done.tags);
    // no due date: one interval from today
    expect(nextOccurrence(task('x', { recurrence: 'daily' }), 0, ctx)!.dueDate).toBe('2026-06-16');
    expect(nextOccurrence(task('y'), 0, ctx)).toBeNull();
  });

  it('spawns copies only for recurring tasks that just became done', () => {
    const before = [
      task('a', { recurrence: 'weekly', dueDate: TODAY }),
      task('b', { recurrence: 'none' }),
      task('c', { recurrence: 'daily', status: 'done', completedAt: NOW_ISO }),
      task('d', { recurrence: 'monthly', status: 'in_progress', dueDate: '2026-01-31' }),
      task('e', { status: 'todo', order: 4 }),
    ];
    const markDone = (t: Task): Task => ({ ...t, status: 'done', completedAt: NOW_ISO });
    const after = before.map(markDone);
    const res = spawnRecurrences(before, after, ctx);
    expect(res.spawned.map((t) => t.dueDate)).toEqual(['2026-06-22', '2026-02-28']);
    expect(res.tasks).toHaveLength(7);
    expect(res.tasks.slice(0, 2)).toEqual(res.spawned);
    // all todo tasks were marked done, so the copies start the To-do column at 0, 1
    expect(res.spawned.map((t) => t.order)).toEqual([0, 1]);

    const unchanged = before.slice();
    expect(spawnRecurrences(before, unchanged, ctx).tasks).toBe(unchanged);
  });
});

describe('import validation: members & legacy data', () => {
  it('loads data saved before members existed, with defaults for the new fields', () => {
    const legacy = generateDemoData(10, NOW) as unknown as Record<string, unknown>;
    delete legacy['members'];
    for (const t of legacy['tasks'] as Record<string, unknown>[]) {
      delete t['assigneeId'];
      delete t['recurrence'];
    }
    const res = validateAppState(JSON.parse(JSON.stringify(legacy)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.members).toEqual([]);
    expect(res.state.tasks.every((t) => t.assigneeId === null && t.recurrence === 'none')).toBe(
      true,
    );
  });

  it('rejects unknown assignees, bad recurrence and malformed members', () => {
    const s = generateDemoData(5, NOW);
    const r1 = validateAppState({ ...s, tasks: [{ ...s.tasks[0], assigneeId: 'nobody' }] });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain('tasks[0].assigneeId');
    const r2 = validateAppState({ ...s, tasks: [{ ...s.tasks[0], recurrence: 'yearly' }] });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toContain('tasks[0].recurrence');
    const r3 = validateAppState({ ...s, members: [{ id: 'm1', name: 'X', color: 'red' }] });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error).toContain('members[0].color');
    expect(validateAppState({ ...s, members: [s.members[0], s.members[0]] }).ok).toBe(false);
  });
});

describe('chart scale', () => {
  it('produces nice integer steps', () => {
    expect(niceScale(0)).toEqual({ step: 1, max: 1 });
    expect(niceScale(4)).toEqual({ step: 1, max: 4 });
    expect(niceScale(7)).toEqual({ step: 2, max: 8 });
    expect(niceScale(23)).toEqual({ step: 5, max: 25 });
    expect(niceScale(61)).toEqual({ step: 20, max: 80 });
    expect(scaleTicks(niceScale(7))).toEqual([0, 2, 4, 6, 8]);
  });
});
