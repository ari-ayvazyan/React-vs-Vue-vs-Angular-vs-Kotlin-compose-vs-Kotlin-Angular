import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Member, Task } from '~/lib/types';
import { generateDemoData, mulberry32 } from '~/lib/demo';
import { DEFAULT_QUERY, filterTasks, parseTaskQuery, serializeTaskQuery } from '~/lib/filters';
import { memberInitials, readableTextColor, unassignMember, validateMemberName } from '~/lib/members';
import { advanceDate, nextOccurrence, spawnRecurrences } from '~/lib/recurrence';
import { openByAssignee } from '~/lib/stats';
import { addMonthsISO } from '~/lib/dates';
import { validateImport } from '~/lib/validation';
import { createHistory, record, undo } from '~/lib/history';
import { useTaskStore } from '~/stores/tasks';

// The generator works on local calendar days; pin the zone so the fingerprint below is stable.
process.env.TZ = 'UTC';

const TODAY = '2026-03-15';
const NOW = '2026-03-15T12:00:00.000Z';

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
    createdAt: '2026-03-01T10:00:00.000Z',
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
const ctx = { nowISO: NOW, today: TODAY, makeId: (p: string): string => `${p}_new${++seq}` };

describe('demo data with members', () => {
  it('leaves every pre-existing generated field byte-for-byte unchanged', () => {
    const d = generateDemoData(1000, new Date('2026-03-15T12:00:00Z'));
    const legacy = d.tasks.map(({ assigneeId: _a, recurrence: _r, blockedBy: _b, comments: _c, statusId: _s, ...rest }) => rest);
    const legacyProjects = d.projects.map(({ parentId: _p, workflow: _w, ...rest }) => rest);
    const { currentUserId: _u, ...legacySettings } = d.settings;
    const hash = createHash('sha256').update(JSON.stringify({ tasks: legacy, projects: legacyProjects, settings: legacySettings })).digest('hex');
    // Fingerprint of generateDemoData(1000) taken before members/recurrence were introduced.
    expect(hash).toBe('d043cd171d3a0b967a20c7e5b73cc5b783785659576fd661bf451323729887b4');
  });

  it('adds the five fixed members', () => {
    const { members } = generateDemoData(0);
    expect(members).toEqual([
      { id: 'm1', name: 'Alex Kim', color: '#0ea5e9' },
      { id: 'm2', name: 'Sam Rivera', color: '#f97316' },
      { id: 'm3', name: 'Jordan Lee', color: '#22c55e' },
      { id: 'm4', name: 'Taylor Brooks', color: '#a855f7' },
      { id: 'm5', name: 'Morgan Patel', color: '#ef4444' },
    ]);
  });

  it('draws assignee then recurrence per task from mulberry32(7)', () => {
    const { tasks } = generateDemoData(500);
    const r = mulberry32(7);
    for (const t of tasks) {
      const k = Math.floor(r() * 6);
      expect(t.assigneeId).toBe(k === 5 ? null : `m${k + 1}`);
      expect(t.recurrence).toBe(r() < 0.1 ? 'weekly' : 'none');
    }
    expect(tasks.some((t) => t.assigneeId === null)).toBe(true);
    expect(tasks.some((t) => t.recurrence === 'weekly')).toBe(true);
  });
});

describe('members', () => {
  it('derives initials from the name', () => {
    expect(memberInitials('Alex Kim')).toBe('AK');
    expect(memberInitials('  mary  ann   van der berg ')).toBe('MB');
    expect(memberInitials('Prince')).toBe('PR');
    expect(memberInitials('Ö')).toBe('Ö');
    expect(memberInitials('   ')).toBe('?');
  });

  it('picks the more readable text colour for an avatar background', () => {
    expect(readableTextColor('#ef4444')).toBe('#111827');
    expect(readableTextColor('#22c55e')).toBe('#111827');
    expect(readableTextColor('#1e3a8a')).toBe('#ffffff');
    expect(readableTextColor('#6366f1')).toBe('#ffffff');
  });

  it('validates names (required, length, unique ignoring case)', () => {
    expect(validateMemberName('  ', MEMBERS)).toMatch(/required/);
    expect(validateMemberName('x'.repeat(61), MEMBERS)).toMatch(/60/);
    expect(validateMemberName('alex kim', MEMBERS)).toMatch(/exists/);
    expect(validateMemberName('Alex Kim', MEMBERS, 'm1')).toBe('');
    expect(validateMemberName('New Person', MEMBERS)).toBe('');
  });

  it('unassigns a deleted member without touching other tasks', () => {
    const tasks = [task('a', { assigneeId: 'm1' }), task('b', { assigneeId: 'm2' }), task('c')];
    const next = unassignMember(tasks, 'm1');
    expect(next.map((t) => t.assigneeId)).toEqual([null, 'm2', null]);
    expect(next[1]).toBe(tasks[1]);
  });

  it('counts open tasks per assignee, with unknown ids as unassigned', () => {
    const tasks = [
      task('1', { assigneeId: 'm1' }),
      task('2', { assigneeId: 'm1', status: 'in_progress' }),
      task('3', { assigneeId: 'm1', status: 'done' }),
      task('4', { assigneeId: 'gone' }),
      task('5'),
    ];
    expect(openByAssignee(MEMBERS, tasks).map((l) => [l.member?.id ?? null, l.open])).toEqual([
      ['m1', 2],
      ['m2', 0],
      [null, 2],
    ]);
  });
});

describe('assignee filter', () => {
  const tasks = [task('1', { assigneeId: 'm1' }), task('2', { assigneeId: 'm2' }), task('3')];

  it('filters by member, unassigned or anyone', () => {
    const ids = (assignee: string): string[] => filterTasks(tasks, { ...DEFAULT_QUERY, assignee }, TODAY).map((t) => t.id);
    expect(ids('')).toEqual(['1', '2', '3']);
    expect(ids('m2')).toEqual(['2']);
    expect(ids('none')).toEqual(['3']);
  });

  it('is part of the URL query', () => {
    const q = { ...DEFAULT_QUERY, assignee: 'm1', status: ['todo' as const] };
    expect(serializeTaskQuery(q)).toEqual({ assignee: 'm1', status: 'todo' });
    expect(parseTaskQuery(serializeTaskQuery(q))).toEqual(q);
    expect(parseTaskQuery({}).assignee).toBe('');
  });
});

describe('recurrence', () => {
  it('advances dates by the interval, clamping month ends', () => {
    expect(advanceDate('2026-03-15', 'daily')).toBe('2026-03-16');
    expect(advanceDate('2026-12-31', 'daily')).toBe('2027-01-01');
    expect(advanceDate('2026-03-15', 'weekly')).toBe('2026-03-22');
    expect(advanceDate('2026-03-15', 'monthly')).toBe('2026-04-15');
    expect(advanceDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advanceDate('2028-01-31', 'monthly')).toBe('2028-02-29');
    expect(addMonthsISO('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('creates a fresh todo copy with reset progress', () => {
    const done = task('a', {
      status: 'done',
      completedAt: NOW,
      recurrence: 'weekly',
      dueDate: '2026-03-10',
      assigneeId: 'm1',
      tags: ['x'],
      timeSpentMinutes: 75,
      subtasks: [
        { id: 's1', title: 'One', done: true },
        { id: 's2', title: 'Two', done: false },
      ],
    });
    const copy = nextOccurrence(done, ctx, 7);
    expect(copy).toMatchObject({
      title: done.title,
      status: 'todo',
      dueDate: '2026-03-17',
      timeSpentMinutes: 0,
      completedAt: null,
      createdAt: NOW,
      order: 7,
      assigneeId: 'm1',
      recurrence: 'weekly',
      tags: ['x'],
    });
    expect(copy.id).not.toBe(done.id);
    expect(copy.subtasks.map((s) => [s.title, s.done])).toEqual([
      ['One', false],
      ['Two', false],
    ]);
    expect(copy.subtasks.every((s) => s.id !== 's1' && s.id !== 's2')).toBe(true);
    // no due date → based on today
    expect(nextOccurrence({ ...done, dueDate: null, recurrence: 'daily' }, ctx, 0).dueDate).toBe('2026-03-16');
  });

  it('spawns only for recurring tasks that just became done', () => {
    const prev = [
      task('rec', { recurrence: 'monthly', dueDate: '2026-01-31' }),
      task('plain'),
      task('already', { recurrence: 'daily', status: 'done', completedAt: NOW }),
      task('todo2', { order: 4 }),
    ];
    const next = prev.map((t) => (t.id === 'todo2' ? t : { ...t, status: 'done' as const, completedAt: NOW }));
    const out = spawnRecurrences(prev, next, ctx);
    expect(out).toHaveLength(5);
    const copy = out[4] as Task;
    expect(copy).toMatchObject({ status: 'todo', dueDate: '2026-02-28', recurrence: 'monthly', order: 5 });
    // nothing to do → same array instance
    expect(spawnRecurrences(prev, prev, ctx)).toBe(prev);
  });

  it('one undo restores the state before both the completion and the copy', () => {
    const before = [task('rec', { recurrence: 'weekly' })];
    let h = createHistory<Task[]>(50);
    h = record(h, before);
    const after = spawnRecurrences(before, [{ ...before[0]!, status: 'done', completedAt: NOW }], ctx);
    expect(after).toHaveLength(2);
    expect(undo(h, after)?.state).toBe(before);
  });
});

describe('import compatibility', () => {
  it('loads data saved before members/assignees/recurrence existed', () => {
    const legacy = generateDemoData(5);
    const old = {
      tasks: legacy.tasks.map(({ assigneeId: _a, recurrence: _r, blockedBy: _b, comments: _c, ...rest }) => rest),
      projects: legacy.projects,
      settings: legacy.settings,
    };
    const res = validateImport(JSON.stringify(old));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.members).toEqual([]);
      expect(res.state.tasks.every((t) => t.assigneeId === null && t.recurrence === 'none')).toBe(true);
    }
  });

  it('round-trips members and rejects bad references', () => {
    const state = generateDemoData(10);
    const ok = validateImport(JSON.stringify(state));
    expect(ok.ok && ok.state.members).toEqual(state.members);
    expect(ok.ok && ok.state.tasks.map((t) => t.assigneeId)).toEqual(state.tasks.map((t) => t.assigneeId));

    const bad = validateImport({
      ...state,
      members: [...state.members, { id: 'x', name: '', color: 'red' }],
      tasks: [{ ...state.tasks[0], assigneeId: 'nobody', recurrence: 'yearly' }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.includes('members[5].name'))).toBe(true);
      expect(bad.errors.some((e) => e.includes('members[5].color'))).toBe(true);
      expect(bad.errors.some((e) => e.includes('tasks[0].assigneeId'))).toBe(true);
      expect(bad.errors.some((e) => e.includes('tasks[0].recurrence'))).toBe(true);
    }
    expect(validateImport({ ...state, members: {} }).ok).toBe(false);
  });
});

describe('task store: members & recurring completion', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function seededStore(): ReturnType<typeof useTaskStore> {
    const store = useTaskStore();
    store.replaceAll({
      tasks: [task('r', { recurrence: 'weekly', dueDate: '2026-03-10', assigneeId: 'm1' }), task('p', { assigneeId: 'm1', order: 1 })],
      projects: [],
      members: MEMBERS.map((m) => ({ ...m })),
      activity: [],
      views: [],
      notifications: [],
      settings: { theme: 'system', pomodoroMinutes: 25, pageSize: 25, currentUserId: 'm1' },
    });
    return store;
  }

  it('marking a recurring task done adds the next occurrence, and one undo reverts both', () => {
    const store = seededStore();
    const before = store.tasks;
    store.toggleDone('r');
    expect(store.tasks).toHaveLength(3);
    expect(store.taskById.get('r')?.status).toBe('done');
    const copy = store.tasks[2] as Task;
    expect(copy).toMatchObject({ status: 'todo', dueDate: '2026-03-17', recurrence: 'weekly', assigneeId: 'm1' });

    expect(store.undo()).toBe(true);
    expect(store.tasks).toBe(before);
    expect(store.redo()).toBe(true);
    expect(store.tasks).toHaveLength(3);
  });

  it('spawns via board moves and status edits too, but not for non-recurring tasks', () => {
    const store = seededStore();
    store.moveTask('r', 'done', [], 0);
    expect(store.tasks).toHaveLength(3);
    store.updateTask('p', { status: 'done' });
    expect(store.tasks).toHaveLength(3);
  });

  it('deleting a member unassigns their tasks in one undoable step', () => {
    const store = seededStore();
    store.deleteMember('m1');
    expect(store.members.map((m) => m.id)).toEqual(['m2']);
    expect(store.tasks.every((t) => t.assigneeId === null)).toBe(true);
    store.undo();
    expect(store.members).toHaveLength(2);
    expect(store.tasks.every((t) => t.assigneeId === 'm1')).toBe(true);
  });

  it('creates, renames and recolours members', () => {
    const store = seededStore();
    const m = store.createMember('  Riley Chen ', '#14b8a6');
    expect(store.memberById.get(m.id)).toEqual({ id: m.id, name: 'Riley Chen', color: '#14b8a6' });
    store.updateMember(m.id, { name: ' Riley C. ', color: '#000000' });
    expect(store.memberById.get(m.id)).toMatchObject({ name: 'Riley C.', color: '#000000' });
    expect(store.serialize().members).toHaveLength(3);
  });
});
