import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ActivityEntry, Member, Task } from '~/lib/types';
import { blockedMessage, blockedTaskIds, hasDependencyCycle, openBlockers, partitionCompletable, removeDependencyRefs, validateDependency } from '~/lib/dependencies';
import { activeMention, commentToText, encodeMentions, insertMention, matchMembers, mentionedIds, parseComment } from '~/lib/mentions';
import { appendActivity, describeActivity, diffTasks, filterActivity, knownTaskTitles } from '~/lib/activity';
import type { ActivityLookups } from '~/lib/activity';
import { formatRelativeTime } from '~/lib/dates';
import { generateDemoData } from '~/lib/demo';
import { validateImport } from '~/lib/validation';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

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
  { id: 'm3', name: 'Sam', color: '#22c55e' },
];

let seq = 0;
const ctx = { actorId: 'm1', at: NOW, makeId: (p: string): string => `${p}${++seq}` };

describe('dependencies', () => {
  // a ← b ← c   (b is blocked by a, c is blocked by b)
  const chain = [task('a'), task('b', { blockedBy: ['a'] }), task('c', { blockedBy: ['b'] }), task('d', { status: 'done' })];
  const byId = new Map(chain.map((t) => [t.id, t]));

  it('finds open blockers and blocked tasks (ignoring done and missing ones)', () => {
    expect(openBlockers(chain[1]!, byId).map((t) => t.id)).toEqual(['a']);
    expect(openBlockers(task('x', { blockedBy: ['d', 'gone'] }), byId)).toEqual([]);
    expect([...blockedTaskIds(chain)]).toEqual(['b', 'c']);
  });

  it('rejects self-references, duplicates and cycles with clear messages', () => {
    expect(validateDependency(chain, 'a', 'a')).toMatch(/itself/);
    expect(validateDependency(chain, 'b', 'a')).toMatch(/already blocks/);
    expect(validateDependency(chain, 'a', 'c')).toMatch(/cycle/); // c depends on a through b
    expect(validateDependency(chain, 'a', 'b')).toMatch(/cycle/);
    expect(validateDependency(chain, 'c', 'a')).toBe('');
    expect(validateDependency(chain, 'a', 'zzz')).toMatch(/no longer exists/);
    expect(hasDependencyCycle(chain)).toBe(false);
    expect(hasDependencyCycle([{ id: 'x', blockedBy: ['y'] }, { id: 'y', blockedBy: ['x'] }])).toBe(true);
  });

  it('partitions completions; tasks completed together unblock each other', () => {
    expect(partitionCompletable(chain, ['b']).allowed).toEqual([]);
    expect(partitionCompletable(chain, ['b', 'a']).allowed).toEqual(['b', 'a']);
    expect(partitionCompletable(chain, ['a', 'b', 'c']).allowed).toEqual(['a', 'b', 'c']);
    const r = partitionCompletable(chain, ['c', 'd']);
    expect(r.allowed).toEqual([]); // d is already done → nothing to do for it
    expect(r.blocked.map((b) => [b.task.id, b.blockers.map((x) => x.id)])).toEqual([['c', ['b']]]);
    expect(blockedMessage(r.blocked)).toBe('Can’t complete “Task c”: blocked by “Task b”.');
    expect(blockedMessage(partitionCompletable(chain, ['b', 'c']).blocked)).toMatch(/^2 tasks can’t be completed yet: blocked by “Task a”, “Task b”\.$/);
  });

  it('drops references to deleted tasks', () => {
    const next = removeDependencyRefs(chain, new Set(['a']));
    expect(next[1]?.blockedBy).toEqual([]);
    expect(next[2]).toBe(chain[2]);
  });
});

describe('mentions', () => {
  it('encodes @Name (longest match, whole word, case-insensitive) as id tokens', () => {
    expect(encodeMentions('Hi @Sam Rivera and @sam, cc @Alex Kim.', MEMBERS)).toBe('Hi @[m2] and @[m3], cc @[m1].');
    expect(encodeMentions('mail me@alex kim or @Samantha', MEMBERS)).toBe('mail me@alex kim or @Samantha');
    expect(mentionedIds('@[m1] @[m2] @[m1]')).toEqual(['m1', 'm2']);
  });

  it('parses stored bodies into segments, resolving current names', () => {
    expect(parseComment('Ping @[m1]!', MEMBERS)).toEqual([
      { kind: 'text', text: 'Ping ' },
      { kind: 'mention', memberId: 'm1', name: 'Alex Kim' },
      { kind: 'text', text: '!' },
    ]);
    expect(commentToText('@[gone] hi', MEMBERS)).toBe('@unknown hi');
  });

  it('detects the mention being typed and completes it', () => {
    expect(activeMention('Hello @Sa', 9)).toEqual({ start: 6, query: 'Sa' });
    expect(activeMention('Hello @Sam R', 12)).toEqual({ start: 6, query: 'Sam R' });
    expect(activeMention('mail@x', 6)).toBeNull();
    expect(activeMention('@ x', 3)).toBeNull();
    expect(activeMention('@a\nb', 4)).toBeNull();
    expect(matchMembers(MEMBERS, 'sam').map((m) => m.id)).toEqual(['m2', 'm3']);
    expect(matchMembers(MEMBERS, 'kim').map((m) => m.id)).toEqual(['m1']);
    expect(matchMembers(MEMBERS, '').length).toBe(3);
    expect(insertMention('Hi @al there', { start: 3, query: 'al' }, 6, MEMBERS[0]!)).toEqual({ text: 'Hi @Alex Kim there', caret: 13 });
  });
});

describe('activity log', () => {
  const lookups: ActivityLookups = {
    members: new Map(MEMBERS.map((m) => [m.id, m])),
    projects: new Map(),
    taskTitle: (id) => (id === 'a' ? 'Task a' : null),
    commentText: (b) => commentToText(b, MEMBERS),
  };

  it('records creation, deletion and one entry per changed field', () => {
    const prev = [task('a'), task('b'), task('c')];
    const next = [
      { ...prev[0]!, statusId: 'done', status: 'done' as const, completedAt: NOW, order: 9, title: 'Renamed', assigneeId: 'm2', blockedBy: ['c'] },
      prev[2]!,
      task('new'),
    ];
    const log = diffTasks(prev, next, ctx);
    expect(log.map((e) => [e.taskId, e.type, e.field ?? null])).toEqual([
      ['a', 'updated', 'title'],
      ['a', 'status', 'status'],
      ['a', 'assignee', 'assigneeId'],
      ['a', 'dependencies', 'blockedBy'],
      ['new', 'created', null],
      ['b', 'deleted', null],
    ]);
    expect(log[1]).toMatchObject({ from: 'todo', to: 'done', actorId: 'm1', at: NOW });
    expect(log.find((e) => e.type === 'deleted')).toMatchObject({ from: 'Task b' });
    expect(diffTasks(prev, prev, ctx)).toEqual([]);
  });

  it('logs added and removed comments, and ignores order/time tracking', () => {
    const c = { id: 'c1', authorId: 'm1', body: 'hi @[m2]', createdAt: NOW };
    const a = task('a');
    const withComment = { ...a, comments: [c] };
    expect(diffTasks([a], [withComment], ctx)).toMatchObject([{ type: 'comment', to: 'hi @[m2]' }]);
    expect(diffTasks([withComment], [a], ctx)).toMatchObject([{ type: 'comment', from: 'hi @[m2]' }]);
    expect(diffTasks([a], [{ ...a, order: 5, timeSpentMinutes: 30 }], ctx)).toEqual([]);
  });

  it('caps the log and describes entries for display', () => {
    const e = (id: string): ActivityEntry => ({ id, taskId: 'a', actorId: null, type: 'created', at: NOW });
    expect(appendActivity([e('1'), e('2')], [e('3')], 2).map((x) => x.id)).toEqual(['2', '3']);
    const log: ActivityEntry[] = [];
    expect(appendActivity(log, [])).toBe(log);

    expect(describeActivity({ ...e('x'), type: 'status', field: 'status', from: 'todo', to: 'done' }, lookups)).toEqual({ action: 'changed the status', actionOnTask: 'changed the status of', from: 'To do', to: 'Done' });
    expect(describeActivity({ ...e('x'), type: 'assignee', field: 'assigneeId', from: null, to: 'm2' }, lookups)).toMatchObject({ from: 'Unassigned', to: 'Sam Rivera' });
    expect(describeActivity({ ...e('x'), type: 'dependencies', field: 'blockedBy', from: [], to: ['a'] }, lookups)).toMatchObject({ action: 'added blocker “Task a”', actionOnTask: 'added blocker “Task a” to' });
    expect(describeActivity({ ...e('x'), type: 'dependencies', field: 'blockedBy', from: ['a', 'zz'], to: ['a'] }, lookups).action).toBe('removed blocker “deleted task”');
    expect(describeActivity({ ...e('x'), type: 'comment', field: 'comments', to: 'hey @[m1]' }, lookups)).toEqual({ action: 'commented', actionOnTask: 'commented on', to: 'hey @Alex Kim' });
    expect(describeActivity({ ...e('x'), type: 'updated', field: 'subtasks', from: ['[ ] A'], to: ['[x] A'] }, lookups)).toMatchObject({ from: '0/1 done', to: '1/1 done' });
  });

  it('filters newest first by actor and type, and knows titles of deleted tasks', () => {
    const log: ActivityEntry[] = [
      { id: '1', taskId: 'x', actorId: 'm1', type: 'created', to: 'Old title', at: NOW },
      { id: '2', taskId: 'x', actorId: 'm2', type: 'status', field: 'status', from: 'todo', to: 'done', at: NOW },
      { id: '3', taskId: 'x', actorId: null, type: 'deleted', from: 'Final title', at: NOW },
    ];
    expect(filterActivity(log, { actor: '', type: '' }).map((e) => e.id)).toEqual(['3', '2', '1']);
    expect(filterActivity(log, { actor: 'm2', type: '' }).map((e) => e.id)).toEqual(['2']);
    expect(filterActivity(log, { actor: 'none', type: '' }).map((e) => e.id)).toEqual(['3']);
    expect(filterActivity(log, { actor: '', type: 'created' }).map((e) => e.id)).toEqual(['1']);
    expect(knownTaskTitles([], log).get('x')).toBe('Final title');
    expect(knownTaskTitles([task('x', { title: 'Live' })], log).get('x')).toBe('Live');
  });

  it('formats relative times', () => {
    const now = new Date('2026-03-15T12:00:00');
    expect(formatRelativeTime(new Date('2026-03-15T11:59:40').toISOString(), now)).toBe('just now');
    expect(formatRelativeTime(new Date('2026-03-15T11:30:00').toISOString(), now)).toBe('30 min ago');
    expect(formatRelativeTime(new Date('2026-03-15T08:00:00').toISOString(), now)).toBe('4 h ago');
    expect(formatRelativeTime(new Date('2026-03-14T08:00:00').toISOString(), now)).toBe('yesterday');
    expect(formatRelativeTime(new Date('2026-03-01T08:00:00').toISOString(), now)).toBe('Mar 1');
  });
});

describe('import with dependencies, comments and activity', () => {
  it('defaults missing fields for older data', () => {
    const d = generateDemoData(3);
    const old = { tasks: d.tasks.map(({ blockedBy: _b, comments: _c, ...t }) => t), projects: d.projects, members: d.members, settings: { theme: 'dark', pomodoroMinutes: 25, pageSize: 25 } };
    const r = validateImport(old);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.activity).toEqual([]);
      expect(r.state.settings.currentUserId).toBe('m1');
      expect(r.state.tasks.every((t) => t.blockedBy.length === 0 && t.comments.length === 0)).toBe(true);
    }
  });

  it('rejects dangling or cyclic dependencies and malformed comments/activity', () => {
    const d = generateDemoData(3);
    const [t1, t2, t3] = d.tasks as [Task, Task, Task];
    const bad = (over: object): string[] => {
      const r = validateImport({ ...d, ...over });
      return r.ok ? [] : r.errors;
    };
    expect(bad({ tasks: [{ ...t1, blockedBy: ['nope'] }, t2, t3] }).join()).toMatch(/tasks\[0\]\.blockedBy/);
    expect(bad({ tasks: [{ ...t1, blockedBy: [t2.id] }, { ...t2, blockedBy: [t1.id] }, t3] }).join()).toMatch(/cycle/);
    expect(bad({ tasks: [{ ...t1, comments: [{ id: 'c', authorId: 'm1', body: '', createdAt: NOW }] }, t2, t3] }).join()).toMatch(/comments\[0\]/);
    expect(bad({ activity: [{ id: 'a', taskId: 't1', actorId: 'm1', type: 'exploded', at: NOW }] }).join()).toMatch(/activity\[0\]/);
    const ok = validateImport({ ...d, tasks: [{ ...t1, blockedBy: [t2.id], comments: [{ id: 'c', authorId: 'm1', body: 'Hi @[m2]', createdAt: NOW }] }, t2, t3], activity: [{ id: 'a', taskId: t1.id, actorId: null, type: 'status', field: 'status', from: 'todo', to: 'done', at: NOW }] });
    expect(ok.ok).toBe(true);
  });
});

describe('task store: blockers, comments, activity & undo', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function seeded(): ReturnType<typeof useTaskStore> {
    const store = useTaskStore();
    store.replaceAll({
      tasks: [
        task('a', { order: 0 }),
        task('b', { blockedBy: ['a'], order: 1 }),
        task('r', { recurrence: 'weekly', dueDate: '2026-03-10', order: 2 }),
      ],
      projects: [],
      members: MEMBERS.map((m) => ({ ...m })),
      activity: [],
      views: [],
      notifications: [],
      settings: { theme: 'system', pomodoroMinutes: 25, pageSize: 25, currentUserId: 'm2' },
    });
    return store;
  }
  const errorToasts = (): string[] => useUiStore().toasts.filter((t) => t.kind === 'error').map((t) => t.message);

  it('refuses to complete a blocked task from every path, with an error naming the blockers', () => {
    const store = seeded();
    expect(store.toggleDone('b')).toBe(false);
    expect(store.setStatus(['b'], 'done')).toBe(0);
    expect(store.updateTask('b', { status: 'done', title: 'x' })).toBe(false);
    expect(store.moveTask('b', 'done', [], 0)).toBe(false);
    store.moveTask('b', 'in_progress', [], 0);
    expect(store.moveTask('b', 'done', ['x'], 1)).toBe(false);
    expect(store.taskById.get('b')?.status).toBe('in_progress');
    expect(store.taskById.get('b')?.title).toBe('Task b');
    expect(errorToasts()[0]).toBe('Can’t complete “Task b”: blocked by “Task a”.');
    expect(store.blockedIds.has('b')).toBe(true);

    // bulk: completing the blocker together with the blocked task is fine
    expect(store.setStatus(['a', 'b'], 'done')).toBe(2);
    expect(store.blockedIds.size).toBe(0);
  });

  it('logs every change with the current user as actor; undo removes and redo restores entries', () => {
    const store = seeded();
    store.updateTask('a', { title: 'Alpha', priority: 'high' });
    expect(store.activity.map((e) => [e.type, e.field, e.actorId])).toEqual([
      ['updated', 'title', 'm2'],
      ['updated', 'priority', 'm2'],
    ]);
    store.undo();
    expect(store.activity).toEqual([]);
    store.redo();
    expect(store.activity).toHaveLength(2);

    // completing a recurring task logs the status change and the created copy – one undo removes both
    store.toggleDone('r');
    expect(store.activity.slice(2).map((e) => e.type)).toEqual(['status', 'created']);
    store.undo();
    expect(store.activity).toHaveLength(2);
  });

  it('manages dependencies with cycle rejection and cleans them up on delete', () => {
    const store = seeded();
    expect(store.addDependency('a', 'b')).toMatch(/cycle/);
    expect(store.addDependency('r', 'b')).toBe('');
    expect(store.taskById.get('r')?.blockedBy).toEqual(['b']);
    expect(store.activity.at(-1)).toMatchObject({ type: 'dependencies', taskId: 'r', from: [], to: ['b'] });
    store.removeDependency('r', 'b');
    expect(store.taskById.get('r')?.blockedBy).toEqual([]);
    store.deleteTasks(['a']);
    expect(store.taskById.get('b')?.blockedBy).toEqual([]);
    expect(store.activity.slice(-2).map((e) => [e.taskId, e.type])).toEqual([
      ['b', 'dependencies'],
      ['a', 'deleted'],
    ]);
  });

  it('adds comments as the current user with encoded mentions', () => {
    const store = seeded();
    expect(store.addComment('a', '   ')).toMatch(/Write something/);
    expect(store.addComment('a', 'Thanks @Alex Kim!')).toBe('');
    const c = store.taskById.get('a')?.comments[0];
    expect(c).toMatchObject({ authorId: 'm2', body: 'Thanks @[m1]!' });
    expect(store.activity.at(-1)).toMatchObject({ type: 'comment', actorId: 'm2', to: 'Thanks @[m1]!' });
    store.deleteComment('a', c!.id);
    expect(store.taskById.get('a')?.comments).toEqual([]);
    store.updateSettings({ currentUserId: null });
    expect(store.addComment('a', 'hi')).toMatch(/Settings/);
  });
});
