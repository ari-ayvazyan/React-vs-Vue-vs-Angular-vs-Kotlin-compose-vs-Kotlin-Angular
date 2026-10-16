import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addMonths } from '../lib/dates';
import { generateDemoData, mulberry32 } from '../lib/demo';
import { DEFAULT_QUERY, filterTasks } from '../lib/filters';
import { avatarTextColor, luminance, matchesAssignee, memberInitials, NO_ASSIGNEE, validateMemberName } from '../lib/members';
import { dataReducer, type Data } from '../lib/reducer';
import { advanceDueDate, completionMessage, nextDueDate, nextOccurrence, spawnRecurrences } from '../lib/recurrence';
import { openPerAssignee } from '../lib/stats';
import { TaskStore } from '../lib/store';
import { STORAGE_KEY, type Member } from '../lib/types';
import { draftFromTask, draftToFields, validateImport } from '../lib/validation';
import { emptyData, task } from './fixtures';

const NOW_UTC = new Date('2026-10-15T12:00:00Z');
const AT = '2026-10-15T12:00:00.000Z';
const ALEX: Member = { id: 'm1', name: 'Alex Kim', color: '#0ea5e9' };
const SAM: Member = { id: 'm2', name: 'Sam Rivera', color: '#f97316' };

function memStorage(initial?: unknown) {
  const mem = new Map<string, string>();
  if (initial !== undefined) mem.set(STORAGE_KEY, JSON.stringify(initial));
  return { mem, storage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } };
}

describe('demo data: members, assignees, recurrence', () => {
  it('keeps the original task fields byte-for-byte identical', () => {
    // Fingerprint of generateDemoData(1000) taken before members/assignees/recurrence were added.
    const d = generateDemoData(1000, NOW_UTC);
    // Rebuilt in the original (v1) shape and key order: later requests added fields and, in schema
    // v2, replaced `status` with `statusId` + `category` (equal to the old status for the default workflow).
    const legacy = {
      tasks: d.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.category,
        priority: t.priority,
        projectId: t.projectId,
        tags: t.tags,
        dueDate: t.dueDate,
        estimateMinutes: t.estimateMinutes,
        timeSpentMinutes: t.timeSpentMinutes,
        subtasks: t.subtasks,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
        order: t.order,
      })),
      projects: d.projects.map((p) => ({ id: p.id, name: p.name, color: p.color, createdAt: p.createdAt })),
      // Fields added by later requests are stripped; everything that existed before must be unchanged.
      settings: { theme: d.settings.theme, pomodoroMinutes: d.settings.pomodoroMinutes, pageSize: d.settings.pageSize },
    };
    expect(d.tasks.every((t) => t.statusId === t.category)).toBe(true);
    expect(createHash('sha256').update(JSON.stringify(legacy)).digest('hex')).toBe(
      '209ee276595a9e8e496a12bdad8feb9e5c1e6aa89ba1f2e0789f1545c002279f',
    );
  });

  it('adds the five demo members', () => {
    expect(generateDemoData(1, NOW_UTC).members).toEqual([
      { id: 'm1', name: 'Alex Kim', color: '#0ea5e9' },
      { id: 'm2', name: 'Sam Rivera', color: '#f97316' },
      { id: 'm3', name: 'Jordan Lee', color: '#22c55e' },
      { id: 'm4', name: 'Taylor Brooks', color: '#a855f7' },
      { id: 'm5', name: 'Morgan Patel', color: '#ef4444' },
    ]);
  });

  it('draws assignee then recurrence per task from mulberry32(7)', () => {
    const d = generateDemoData(300, NOW_UTC);
    const r = mulberry32(7);
    for (const t of d.tasks) {
      const k = Math.floor(r() * 6);
      expect(t.assigneeId).toBe(k === 5 ? null : `m${k + 1}`);
      expect(t.recurrence).toBe(r() < 0.1 ? 'weekly' : 'none');
    }
    const assigned = new Set(d.tasks.map((t) => t.assigneeId));
    expect(assigned).toEqual(new Set([null, 'm1', 'm2', 'm3', 'm4', 'm5']));
    expect(d.tasks.some((t) => t.recurrence === 'weekly')).toBe(true);
    expect(validateImport(JSON.parse(JSON.stringify(d)))).toEqual({ ok: true, state: d });
  });
});

describe('members', () => {
  it('derives initials from the name', () => {
    expect(memberInitials('Alex Kim')).toBe('AK');
    expect(memberInitials('  taylor   anne brooks ')).toBe('TB');
    expect(memberInitials('Cher')).toBe('CH');
    expect(memberInitials('Émile Zola')).toBe('ÉZ');
    expect(memberInitials('   ')).toBe('?');
  });

  it('picks the higher-contrast initials colour', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000000')).toBe(0);
    expect(avatarTextColor('#1e3a8a')).toBe('#ffffff');
    expect(avatarTextColor('#22c55e')).toBe('#0f172a');
    expect(avatarTextColor('#fde047')).toBe('#0f172a');
  });

  it('validates member names', () => {
    expect(validateMemberName('  ', [ALEX])).toMatch(/required/);
    expect(validateMemberName('x'.repeat(61), [ALEX])).toMatch(/60/);
    expect(validateMemberName('alex kim', [ALEX])).toMatch(/exists/);
    expect(validateMemberName('Alex Kim', [ALEX], 'm1')).toBeNull();
  });

  it('filters by assignee (member, unassigned, everyone)', () => {
    const tasks = [task({ assigneeId: 'm1' }), task({ assigneeId: 'm2' }), task({ assigneeId: null })];
    expect(filterTasks(tasks, { ...DEFAULT_QUERY, assignee: 'm1' }, '2026-10-15')).toEqual([tasks[0]]);
    expect(filterTasks(tasks, { ...DEFAULT_QUERY, assignee: NO_ASSIGNEE }, '2026-10-15')).toEqual([tasks[2]]);
    expect(tasks.filter((t) => matchesAssignee(t, null))).toHaveLength(3);
  });

  it('member CRUD; deleting a member unassigns their tasks (undoable as one step)', () => {
    let s: Data = emptyData({ tasks: [task({ assigneeId: 'm1' }), task({ assigneeId: 'm2' })], members: [ALEX] });
    s = dataReducer(s, { type: 'member/create', member: SAM });
    s = dataReducer(s, { type: 'member/update', id: 'm2', patch: { name: 'Samantha Rivera', color: '#000000' } });
    expect(s.members[1]).toEqual({ id: 'm2', name: 'Samantha Rivera', color: '#000000' });
    const after = dataReducer(s, { type: 'member/delete', id: 'm1' });
    expect(after.members.map((m) => m.id)).toEqual(['m2']);
    expect(after.tasks.map((t) => t.assigneeId)).toEqual([null, 'm2']);
    expect(dataReducer(after, { type: 'member/delete', id: 'nope' })).toBe(after);
  });

  it('counts open tasks per assignee, busiest first, unassigned last', () => {
    const tasks = [
      task({ assigneeId: 'm2' }),
      task({ assigneeId: 'm2', status: 'in_progress' }),
      task({ assigneeId: 'm1', status: 'done' }),
      task({ assigneeId: null }),
      task({ assigneeId: 'ghost' }),
    ];
    expect(openPerAssignee(tasks, [ALEX, SAM])).toEqual([
      { member: SAM, open: 2 },
      { member: ALEX, open: 0 },
      { member: null, open: 2 },
    ]);
    expect(openPerAssignee([], [ALEX])).toEqual([{ member: ALEX, open: 0 }]);
  });
});

describe('recurrence', () => {
  it('advances due dates by the interval', () => {
    expect(advanceDueDate('2026-10-15', 'daily')).toBe('2026-10-16');
    expect(advanceDueDate('2026-12-28', 'weekly')).toBe('2027-01-04');
    expect(advanceDueDate('2026-10-15', 'monthly')).toBe('2026-11-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(nextDueDate({ dueDate: null, recurrence: 'weekly' }, '2026-10-15')).toBe('2026-10-22');
    expect(nextDueDate({ dueDate: '2026-10-01', recurrence: 'none' }, '2026-10-15')).toBeNull();
  });

  it('describes the completion, including the next due date', () => {
    expect(completionMessage({ title: 'Pay rent', dueDate: '2026-10-01', recurrence: 'monthly' }, AT)).toBe('Completed “Pay rent” · next one due Nov 1');
    expect(completionMessage({ title: 'One-off', dueDate: null, recurrence: 'none' }, AT)).toBe('Completed “One-off”');
  });

  it('builds the next occurrence as a fresh todo copy', () => {
    const src = task({
      id: 't7',
      status: 'done',
      completedAt: AT,
      recurrence: 'weekly',
      dueDate: '2026-10-10',
      assigneeId: 'm1',
      tags: ['ops'],
      timeSpentMinutes: 75,
      subtasks: [
        { id: 's1', title: 'A', done: true },
        { id: 's2', title: 'B', done: false },
      ],
    });
    const todo = task({ status: 'todo', order: 4 });
    const copy = nextOccurrence(src, AT, [src, todo])!;
    expect(copy).toMatchObject({
      id: 't7-r1',
      title: src.title,
      category: 'todo',
      dueDate: '2026-10-17',
      assigneeId: 'm1',
      recurrence: 'weekly',
      tags: ['ops'],
      timeSpentMinutes: 0,
      completedAt: null,
      createdAt: AT,
      order: 5,
    });
    expect(copy.subtasks.map((s) => s.done)).toEqual([false, false]);
    expect(nextOccurrence({ ...src, recurrence: 'none' }, AT, [src])).toBeNull();
    // A copy of a copy gets the next free number rather than a growing suffix.
    expect(nextOccurrence({ ...copy, statusId: 'done', category: 'done' }, AT, [src, copy])!.id).toBe('t7-r2');
  });

  it('only spawns on a not-done → done transition of a repeating task', () => {
    const rep = task({ recurrence: 'daily', dueDate: '2026-10-15' });
    const plain = task();
    const before = [rep, plain];
    const after = before.map((t) => ({ ...t, statusId: 'done', category: 'done' as const }));
    const out = spawnRecurrences(before, after, [rep.id, plain.id], AT);
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ category: 'todo', dueDate: '2026-10-16' });
    expect(spawnRecurrences(after, after, [rep.id], AT)).toBe(after);
  });

  it('completing via update, bulk update or board move creates the copy', () => {
    const rep = task({ id: 'r', recurrence: 'monthly', dueDate: '2026-01-31', status: 'in_progress' });
    const base: Data = emptyData({ tasks: [rep, task({ status: 'todo', order: 0 })] });

    const viaUpdate = dataReducer(base, { type: 'task/update', id: 'r', patch: { statusId: 'done' }, at: AT });
    expect(viaUpdate.tasks).toHaveLength(3);
    expect(viaUpdate.tasks[0]).toMatchObject({ category: 'done', completedAt: AT });
    expect(viaUpdate.tasks[2]).toMatchObject({ id: 'r-r1', category: 'todo', dueDate: '2026-02-28', order: 1 });

    const viaBulk = dataReducer(base, { type: 'task/setCategory', ids: ['r'], category: 'done', at: AT });
    expect(viaBulk.tasks).toHaveLength(3);

    const viaMove = dataReducer(base, { type: 'task/move', id: 'r', statusId: 'done', index: 0, at: AT });
    expect(viaMove.tasks).toHaveLength(3);
    expect(viaMove.tasks[2].category).toBe('todo');

    // Reopening does not spawn; non-status edits do not spawn.
    expect(dataReducer(viaUpdate, { type: 'task/update', id: 'r', patch: { statusId: 'todo' }, at: AT }).tasks).toHaveLength(3);
    expect(dataReducer(base, { type: 'task/update', id: 'r', patch: { title: 'x' }, at: AT }).tasks).toHaveLength(2);
  });

  it('one undo reverts both the completion and the created copy', () => {
    const { storage } = memStorage();
    const store = new TaskStore(storage, '?seed=50');
    const rep = store.getSnapshot().state.tasks.find((t) => t.recurrence === 'weekly' && t.category !== 'done')!;
    expect(rep).toBeDefined();
    store.dispatch({ type: 'task/update', id: rep.id, patch: { statusId: 'done' }, at: AT });
    expect(store.getSnapshot().state.tasks).toHaveLength(51);
    store.undo();
    const tasks = store.getSnapshot().state.tasks;
    expect(tasks).toHaveLength(50);
    expect(tasks.find((t) => t.id === rep.id)!.category).toBe(rep.category);
    expect(store.getSnapshot().canUndo).toBe(false);
  });
});

describe('backwards compatibility', () => {
  it('loads data persisted before members/assignees/recurrence existed', () => {
    const legacy = JSON.parse(JSON.stringify(generateDemoData(20, NOW_UTC))) as Record<string, unknown> & { tasks: Record<string, unknown>[] };
    delete legacy.members;
    delete legacy.activity;
    delete legacy.views;
    delete (legacy.settings as Record<string, unknown>).currentUserId;
    for (const t of legacy.tasks) {
      delete t.assigneeId;
      delete t.recurrence;
      delete t.blockedBy;
      delete t.comments;
    }
    const { storage } = memStorage(legacy);
    const state = new TaskStore(storage, '').getSnapshot().state;
    expect(state.tasks).toHaveLength(20);
    expect(state.members).toEqual([]);
    expect(state.tasks.every((t) => t.assigneeId === null && t.recurrence === 'none')).toBe(true);
    expect(state.tasks.every((t) => t.blockedBy.length === 0 && t.comments.length === 0)).toBe(true);
    expect(state.activity).toEqual([]);
    expect(state.views).toEqual([]);
    expect(state.settings.currentUserId).toBe('m1');
  });

  it('rejects bad member data on import', () => {
    const good = generateDemoData(3, NOW_UTC);
    const orphan = structuredClone(good);
    orphan.tasks[0].assigneeId = 'm99';
    expect(validateImport(orphan)).toMatchObject({ ok: false, error: expect.stringContaining('unknown member') });
    const badRec = structuredClone(good) as unknown as { tasks: Record<string, unknown>[] };
    badRec.tasks[1].recurrence = 'yearly';
    expect(validateImport(badRec)).toMatchObject({ ok: false, error: expect.stringContaining('tasks[1].recurrence') });
    expect(validateImport({ ...good, members: [{ id: 'm1', name: 'A', color: 'red' }] }).ok).toBe(false);
    expect(validateImport({ ...good, members: 'nope' }).ok).toBe(false);
  });

  it('round-trips assignee and recurrence through the task form draft', () => {
    const t = task({ assigneeId: 'm3', recurrence: 'monthly' });
    const d = draftFromTask(t);
    expect(d).toMatchObject({ assigneeId: 'm3', recurrence: 'monthly' });
    expect(draftToFields(d)).toMatchObject({ assigneeId: 'm3', recurrence: 'monthly' });
    expect(draftToFields({ ...d, assigneeId: '' }).assigneeId).toBeNull();
    expect(draftFromTask(null)).toMatchObject({ assigneeId: '', recurrence: 'none' });
  });
});
