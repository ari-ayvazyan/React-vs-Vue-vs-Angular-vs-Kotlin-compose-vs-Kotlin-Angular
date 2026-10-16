import { describe, expect, it } from 'vitest';
import {
  activityQueryToSearch,
  appendActivity,
  describeEntry,
  diffActivity,
  entryCommentText,
  entryTaskTitles,
  filterActivity,
  NO_ACTOR,
  parseActivityQuery,
  taskActivity,
  type ActivityLookup,
} from '../lib/activity';
import { generateDemoData } from '../lib/demo';
import { blockedCompletions, blockedMessage, cycleMessage, findCycle, graphCycle, isBlocked, openBlockers, taskMap } from '../lib/dependencies';
import { activeMention, decodeMentions, encodeMentions, matchMembers, mentionedIds, parseMentions } from '../lib/mentions';
import { dataReducer, type Data } from '../lib/reducer';
import { TaskStore } from '../lib/store';
import type { ActivityEntry, Member } from '../lib/types';
import { validateImport } from '../lib/validation';
import { emptyData, task } from './fixtures';

const AT = '2026-10-15T12:00:00.000Z';
const MEMBERS: Member[] = [
  { id: 'm1', name: 'Alex Kim', color: '#0ea5e9' },
  { id: 'm2', name: 'Sam Rivera', color: '#f97316' },
  { id: 'm3', name: 'Sam', color: '#22c55e' },
];
const data = (tasks: Data['tasks']): Data => emptyData({ tasks, members: MEMBERS });

function memStore(search = '?seed=20') {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  let clock = Date.parse(AT);
  return { mem, store: new TaskStore(storage, search, () => new Date((clock += 1000))) };
}

describe('dependencies', () => {
  // a ← b ← c  (a is blocked by b, b is blocked by c)
  const c = task({ id: 'c', title: 'C' });
  const b = task({ id: 'b', title: 'B', blockedBy: ['c'] });
  const a = task({ id: 'a', title: 'A', blockedBy: ['b'] });
  const byId = taskMap([a, b, c]);

  it('finds open blockers and the blocked state', () => {
    expect(openBlockers(a, byId).map((t) => t.id)).toEqual(['b']);
    expect(isBlocked(a, byId)).toBe(true);
    expect(isBlocked(c, byId)).toBe(false);
    const doneB = taskMap([a, { ...b, statusId: 'done', category: 'done' }, c]);
    expect(isBlocked(a, doneB)).toBe(false);
    expect(isBlocked({ ...a, statusId: 'done', category: 'done' }, byId)).toBe(false);
    expect(openBlockers(task({ blockedBy: ['ghost'] }), byId)).toEqual([]);
  });

  it('detects cycles, including indirect ones and self-blocking', () => {
    expect(findCycle(byId, 'c', 'a')).toEqual(['a', 'b', 'c']);
    expect(findCycle(byId, 'c', 'b')).toEqual(['b', 'c']);
    expect(findCycle(byId, 'a', 'a')).toEqual(['a']);
    expect(findCycle(byId, 'a', 'c')).toBeNull();
    expect(cycleMessage(['a', 'b', 'c'], byId)).toBe('Can’t add “A”: it already waits on “C” (“A” → “B” → “C”), so this would create a cycle.');
    expect(cycleMessage(['a'], byId)).toMatch(/itself/);
    expect(graphCycle([a, b, c])).toBeNull();
    expect(graphCycle([a, b, { ...c, blockedBy: ['a'] }])).toEqual(['a', 'b', 'c', 'a']);
  });

  it('explains refused completions, naming the blockers', () => {
    const blocked = blockedCompletions([a, b, c], ['a', 'b', 'c']);
    expect(blocked.map((x) => x.task.id)).toEqual(['a', 'b']);
    expect(blockedMessage([blocked[0]])).toBe('Can’t complete “A”: blocked by “B”.');
    expect(blockedMessage(blocked)).toBe('Can’t complete 2 blocked tasks (“A”, “B”): waiting on “B”, “C”.');
  });

  it('the reducer refuses every path to done while blockers are open', () => {
    const s = data([a, b, c]);
    expect(dataReducer(s, { type: 'task/update', id: 'a', patch: { statusId: 'done' }, at: AT })).toBe(s);
    const titled = dataReducer(s, { type: 'task/update', id: 'a', patch: { statusId: 'done', title: 'A2' }, at: AT });
    expect(titled.tasks[0]).toMatchObject({ title: 'A2', category: 'todo' });
    expect(dataReducer(s, { type: 'task/move', id: 'a', statusId: 'done', index: 0, at: AT })).toBe(s);
    const bulk = dataReducer(s, { type: 'task/setCategory', ids: ['a', 'b', 'c'], category: 'done', at: AT });
    expect(bulk.tasks.map((t) => t.category)).toEqual(['todo', 'todo', 'done']);
    // moving within/between open columns is still allowed
    expect(dataReducer(s, { type: 'task/move', id: 'a', statusId: 'in_progress', index: 0, at: AT }).tasks[0].category).toBe('in_progress');
  });

  it('adds/removes blockers, rejecting cycles, duplicates and unknown ids; deleting a task drops it as a blocker', () => {
    const s = data([a, b, c]);
    expect(dataReducer(s, { type: 'task/addBlocker', id: 'c', blockerId: 'a' })).toBe(s);
    expect(dataReducer(s, { type: 'task/addBlocker', id: 'a', blockerId: 'b' })).toBe(s);
    expect(dataReducer(s, { type: 'task/addBlocker', id: 'a', blockerId: 'nope' })).toBe(s);
    const added = dataReducer(s, { type: 'task/addBlocker', id: 'a', blockerId: 'c' });
    expect(added.tasks[0].blockedBy).toEqual(['b', 'c']);
    expect(dataReducer(added, { type: 'task/removeBlocker', id: 'a', blockerId: 'b' }).tasks[0].blockedBy).toEqual(['c']);
    const deleted = dataReducer(s, { type: 'task/delete', ids: ['b'] });
    expect(deleted.tasks.find((t) => t.id === 'a')!.blockedBy).toEqual([]);
  });

  it('import rejects self, unknown and cyclic dependencies', () => {
    const good = generateDemoData(3);
    const self = structuredClone(good);
    self.tasks[0].blockedBy = ['t1'];
    expect(validateImport(self)).toMatchObject({ ok: false, error: expect.stringContaining('itself') });
    const unknown = structuredClone(good);
    unknown.tasks[0].blockedBy = ['zzz'];
    expect(validateImport(unknown)).toMatchObject({ ok: false, error: expect.stringContaining('unknown task "zzz"') });
    const cyc = structuredClone(good);
    cyc.tasks[0].blockedBy = ['t2'];
    cyc.tasks[1].blockedBy = ['t1'];
    expect(validateImport(cyc)).toMatchObject({ ok: false, error: expect.stringContaining('cycle') });
  });
});

describe('mentions', () => {
  it('encodes @Full Name to tokens (longest name wins) and decodes back', () => {
    const body = encodeMentions('Hi @sam rivera and @Sam, cc @Alex Kim. mail@example.com @Nobody', MEMBERS);
    expect(body).toBe('Hi @{m2} and @{m3}, cc @{m1}. mail@example.com @Nobody');
    expect(mentionedIds(body)).toEqual(['m2', 'm3', 'm1']);
    expect(decodeMentions(body, MEMBERS)).toBe('Hi @Sam Rivera and @Sam, cc @Alex Kim. mail@example.com @Nobody');
    expect(decodeMentions('@{gone}', MEMBERS)).toBe('@unknown');
    expect(encodeMentions('@Samantha', MEMBERS)).toBe('@Samantha');
  });

  it('parses a body into text and mention parts', () => {
    expect(parseMentions('a @{m1} b')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'mention', memberId: 'm1' },
      { kind: 'text', text: ' b' },
    ]);
    expect(parseMentions('')).toEqual([]);
  });

  it('finds the mention being typed at the caret', () => {
    expect(activeMention('hello @al', 9)).toEqual({ start: 6, query: 'al' });
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' });
    expect(activeMention('hello @alex k', 13)).toEqual({ start: 6, query: 'alex k' });
    expect(activeMention('mail@ex', 7)).toBeNull();
    expect(activeMention('@a\nb', 4)).toBeNull();
    expect(activeMention('no at here', 5)).toBeNull();
  });

  it('matches members by name or word prefix', () => {
    expect(matchMembers(MEMBERS, 'sa').map((m) => m.id)).toEqual(['m2', 'm3']);
    expect(matchMembers(MEMBERS, 'kim').map((m) => m.id)).toEqual(['m1']);
    expect(matchMembers(MEMBERS, '')).toHaveLength(3);
    expect(matchMembers(MEMBERS, 'zz')).toEqual([]);
  });
});

describe('activity log', () => {
  let seq = 0;
  const ctx = { actorId: 'm1', at: AT, nextId: () => `e${++seq}` };

  it('records create, delete, each changed field and comments', () => {
    const t1 = task({ id: 'x', title: 'X' });
    const t2 = task({ id: 'y', title: 'Y' });
    const changed = { ...t1, statusId: 'done', category: 'done' as const, assigneeId: 'm2', blockedBy: ['y'], completedAt: AT, order: 9 };
    const withComment = { ...t2, comments: [{ id: 'c1', authorId: 'm1', body: 'hi @{m2}', createdAt: AT }] };
    const created = task({ id: 'z', title: 'Z' });
    const entries = diffActivity([t1, t2], [changed, created], ctx);
    expect(entries.map((e) => [e.taskId, e.type, e.field ?? null, e.from ?? null, e.to ?? null])).toEqual([
      ['x', 'update', 'status', 'todo', 'done'],
      ['x', 'update', 'assigneeId', null, 'm2'],
      ['x', 'update', 'blockedBy', [], ['y']],
      ['z', 'create', null, null, 'Z'],
      ['y', 'delete', null, 'Y', null],
    ]);
    expect(entries.every((e) => e.actorId === 'm1' && e.at === AT)).toBe(true);
    const c = diffActivity([t2], [withComment], ctx);
    expect(c).toMatchObject([{ type: 'comment', to: 'hi @{m2}' }]);
    expect(diffActivity([t1], [t1], ctx)).toEqual([]);
  });

  it('caps the log, keeping the newest entries', () => {
    const mk = (i: number) => ({ id: `e${i}`, taskId: 't', actorId: null, type: 'create', at: AT }) as ActivityEntry;
    const log = appendActivity([mk(1), mk(2)], [mk(3), mk(4)], 3);
    expect(log.map((e) => e.id)).toEqual(['e2', 'e3', 'e4']);
    const same: ActivityEntry[] = [];
    expect(appendActivity(same, [])).toBe(same);
  });

  it('filters newest first by actor and type', () => {
    const log: ActivityEntry[] = [
      { id: '1', taskId: 't', actorId: 'm1', type: 'create', at: AT },
      { id: '2', taskId: 't', actorId: 'm2', type: 'update', field: 'title', from: 'a', to: 'b', at: AT },
      { id: '3', taskId: 'u', actorId: null, type: 'comment', to: 'x', at: AT },
    ];
    expect(filterActivity(log, { actor: null, type: null }).map((e) => e.id)).toEqual(['3', '2', '1']);
    expect(filterActivity(log, { actor: 'm2', type: null }).map((e) => e.id)).toEqual(['2']);
    expect(filterActivity(log, { actor: NO_ACTOR, type: null }).map((e) => e.id)).toEqual(['3']);
    expect(filterActivity(log, { actor: null, type: 'create' }).map((e) => e.id)).toEqual(['1']);
    expect(taskActivity(log, 't').map((e) => e.id)).toEqual(['2', '1']);
  });

  it('round-trips the /activity query through the URL', () => {
    const query = { actor: 'm2', type: 'comment' as const, page: 3 };
    expect(parseActivityQuery(new URLSearchParams(activityQueryToSearch(query)))).toEqual(query);
    expect(activityQueryToSearch({ actor: null, type: null, page: 1 })).toBe('');
    expect(parseActivityQuery(new URLSearchParams('type=bogus&page=0'))).toEqual({ actor: null, type: null, page: 1 });
  });

  it('describes entries in plain language', () => {
    const lookup: ActivityLookup = { tasks: new Map([['b', { title: 'Blocker' }]]), projects: new Map([['p1', { name: 'Web' }]]), members: MEMBERS };
    const d = (e: Partial<ActivityEntry>) => describeEntry({ id: 'i', taskId: 't', actorId: null, type: 'update', at: AT, ...e }, lookup);
    expect(d({ type: 'create' })).toBe('created the task');
    expect(d({ field: 'status', from: 'todo', to: 'done' })).toBe('changed status from To do to Done');
    expect(d({ field: 'assigneeId', from: null, to: 'm2' })).toBe('assigned it to Sam Rivera');
    expect(d({ field: 'assigneeId', from: 'm2', to: null })).toBe('unassigned Sam Rivera');
    expect(d({ field: 'assigneeId', from: 'm2', to: 'gone' })).toBe('reassigned it from Sam Rivera to a removed member');
    expect(d({ field: 'blockedBy', from: [], to: ['b'] })).toBe('added blocker “Blocker”');
    expect(d({ field: 'blockedBy', from: ['b', 'q'], to: [] })).toBe('removed blockers “Blocker”, “a deleted task”');
    expect(d({ field: 'projectId', from: null, to: 'p1' })).toBe('set project to Web');
    expect(d({ field: 'dueDate', from: '2026-10-01', to: null })).toBe('cleared due date (was Oct 1, 2026)');
    expect(d({ field: 'tags', from: ['a'], to: ['b'] })).toBe('added #b and removed #a');
    expect(d({ field: 'title', from: 'a', to: 'b' })).toBe('renamed it from “a” to “b”');
    expect(d({ field: 'timeSpentMinutes', from: 10, to: 35 })).toBe('logged 25 min (now 35 min)');
    expect(d({ field: 'subtasks', from: ['[ ] a'], to: ['[x] a'] })).toBe('updated subtasks (1/1 done)');
    expect(d({ type: 'comment', to: 'x' })).toBe('commented');
    expect(entryCommentText({ id: 'i', taskId: 't', actorId: null, type: 'comment', to: 'hey @{m1}', at: AT }, MEMBERS)).toBe('hey @Alex Kim');
  });

  it('remembers titles of deleted tasks', () => {
    const log: ActivityEntry[] = [
      { id: '1', taskId: 'gone', actorId: null, type: 'create', to: 'Old', at: AT },
      { id: '2', taskId: 'gone', actorId: null, type: 'update', field: 'title', from: 'Old', to: 'New', at: AT },
      { id: '3', taskId: 'gone', actorId: null, type: 'delete', from: 'New', at: AT },
    ];
    expect(entryTaskTitles(log, [task({ id: 'live', title: 'Live' })])).toEqual(new Map([['gone', 'New'], ['live', 'Live']]));
  });
});

describe('store: activity stays consistent with undo/redo', () => {
  it('records every dispatched change with the current user as actor', () => {
    const { store } = memStore();
    store.dispatch({ type: 'task/update', id: 't1', patch: { title: 'Renamed', priority: 'urgent' }, at: AT });
    const log = store.getSnapshot().state.activity;
    expect(log.map((e) => e.field)).toEqual(['title', 'priority']);
    expect(log.every((e) => e.actorId === 'm1' && e.taskId === 't1' && e.at === AT)).toBe(true);
    store.updateSettings({ currentUserId: 'm3' });
    store.dispatch({ type: 'task/delete', ids: ['t2'] });
    expect(store.getSnapshot().state.activity.at(-1)).toMatchObject({ type: 'delete', actorId: 'm3', taskId: 't2' });
    store.updateSettings({ currentUserId: 'ghost' });
    store.dispatch({ type: 'task/addTime', id: 't3', minutes: 5 });
    expect(store.getSnapshot().state.activity.at(-1)).toMatchObject({ field: 'timeSpentMinutes', actorId: null });
  });

  it('undo removes the entries of the undone change; redo restores them', () => {
    const { store, mem } = memStore();
    store.dispatch({ type: 'task/addComment', id: 't1', comment: { id: 'c1', authorId: 'm1', body: 'hello', createdAt: AT } });
    store.dispatch({ type: 'task/addBlocker', id: 't1', blockerId: 't2' });
    expect(store.getSnapshot().state.activity.map((e) => e.type)).toEqual(['comment', 'update']);
    store.undo();
    expect(store.getSnapshot().state.activity.map((e) => e.type)).toEqual(['comment']);
    expect(store.getSnapshot().state.tasks[0].blockedBy).toEqual([]);
    store.redo();
    expect(store.getSnapshot().state.activity.map((e) => e.type)).toEqual(['comment', 'update']);
    store.undo();
    store.undo();
    expect(store.getSnapshot().state.activity).toEqual([]);
    store.flush();
    expect(JSON.parse(mem.get('taskpilot:v2')!).activity).toEqual([]);
  });

  it('member deletion logs one unassignment per affected task, in one undo step', () => {
    const { store } = memStore();
    const affected = store.getSnapshot().state.tasks.filter((t) => t.assigneeId === 'm2').length;
    expect(affected).toBeGreaterThan(0);
    store.dispatch({ type: 'member/delete', id: 'm2' });
    const log = store.getSnapshot().state.activity;
    expect(log).toHaveLength(affected);
    expect(log.every((e) => e.field === 'assigneeId' && e.from === 'm2' && e.to === null)).toBe(true);
    store.undo();
    expect(store.getSnapshot().state.activity).toEqual([]);
  });

  it('non-task changes and no-ops record nothing', () => {
    const { store } = memStore();
    store.dispatch({ type: 'project/update', id: 'p1', patch: { name: 'Renamed' }, at: AT });
    store.dispatch({ type: 'task/update', id: 'nope', patch: { title: 'x' }, at: AT });
    expect(store.getSnapshot().state.activity).toEqual([]);
  });
});
