import { Member, Project, Task } from './models';
import {
  blockedByTask,
  checkCompletion,
  dependencyCycle,
  hasDependencyCycle,
  isBlocked,
  openBlockers,
  pruneBlockers,
} from './dependencies';
import {
  activeMention,
  bodyToText,
  encodeMentions,
  insertMention,
  mentionCandidates,
  parseBody,
} from './mentions';
import { appendActivity, describeActivity, diffActivity, queryActivity } from './activity';
import { generateDemoData } from './demo-data';
import { validateAppState } from './validation';

const NOW_ISO = new Date(2026, 5, 15, 12).toISOString();

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
const mapOf = (ts: Task[]) => new Map(ts.map((t) => [t.id, t]));

const MEMBERS: Member[] = [
  { id: 'm1', name: 'Alex Kim', color: '#0ea5e9' },
  { id: 'm2', name: 'Sam Rivera', color: '#f97316' },
  { id: 'm9', name: 'Sam', color: '#22c55e' },
];
const MEMBER_MAP = new Map(MEMBERS.map((m) => [m.id, m]));

describe('dependencies', () => {
  // c waits for b, b waits for a
  const a = task('a');
  const b = task('b', { blockedBy: ['a'] });
  const c = task('c', { blockedBy: ['b', 'gone'] });
  const map = mapOf([a, b, c]);

  it('finds open blockers and blocked tasks', () => {
    expect(openBlockers(c, map).map((t) => t.id)).toEqual(['b']);
    expect(isBlocked(b, map)).toBe(true);
    expect(isBlocked(a, map)).toBe(false);
    expect(isBlocked({ ...b, status: 'done' }, map)).toBe(false);
    const doneA = mapOf([{ ...a, status: 'done' }, b, c]);
    expect(isBlocked(b, doneA)).toBe(false);
    expect(blockedByTask('a', [a, b, c]).map((t) => t.id)).toEqual(['b']);
  });

  it('detects cycles and returns the path', () => {
    // making a wait for c: c already waits (via b) for a
    expect(dependencyCycle('a', 'c', map)).toEqual(['c', 'b', 'a']);
    expect(dependencyCycle('a', 'a', map)).toEqual(['a']);
    expect(dependencyCycle('c', 'a', map)).toBeNull();
    expect(hasDependencyCycle([a, b, c])).toBe(false);
    expect(hasDependencyCycle([{ ...a, blockedBy: ['c'] }, b, c])).toBe(true);
  });

  it('refuses completion of blocked tasks unless their blockers complete in the same batch', () => {
    const r1 = checkCompletion(['b', 'c'], map);
    expect(r1.allowed).toEqual([]);
    expect(r1.rejected.map((r) => [r.task.id, r.blockers.map((x) => x.id)])).toEqual([
      ['b', ['a']],
      ['c', ['b']],
    ]);
    expect(checkCompletion(['c', 'a', 'b'], map).allowed).toEqual(['c', 'a', 'b']);
    expect(checkCompletion(['a', 'c'], map).rejected.map((r) => r.task.id)).toEqual(['c']);
  });

  it('prunes ids of deleted tasks, keeping identity when nothing changes', () => {
    const tasks = [a, b, c];
    const pruned = pruneBlockers(tasks);
    expect(pruned.find((t) => t.id === 'c')!.blockedBy).toEqual(['b']);
    expect(pruned[0]).toBe(a);
    const clean = [a, b];
    expect(pruneBlockers(clean)).toBe(clean);
  });
});

describe('mentions', () => {
  it('encodes @Full Name into tokens, preferring the longest name', () => {
    expect(encodeMentions('Hi @Sam Rivera and @sam, cc @Alex Kim.', MEMBERS)).toBe(
      'Hi <@m2> and <@m9>, cc <@m1>.',
    );
    expect(encodeMentions('mail me@Alex Kim', MEMBERS)).toBe('mail me@Alex Kim');
    expect(encodeMentions('@Samantha', MEMBERS)).toBe('@Samantha');
  });

  it('parses tokens back into segments and plain text', () => {
    expect(parseBody('ping <@m1> & <@x>!', MEMBER_MAP)).toEqual([
      { kind: 'text', text: 'ping ' },
      { kind: 'mention', id: 'm1', name: 'Alex Kim' },
      { kind: 'text', text: ' & ' },
      { kind: 'mention', id: 'x', name: null },
      { kind: 'text', text: '!' },
    ]);
    expect(bodyToText('ping <@m1> & <@x>', MEMBER_MAP)).toBe('ping @Alex Kim & @former member');
  });

  it('detects the mention under the caret and completes it', () => {
    expect(activeMention('hello @al', 9)).toEqual({ start: 6, query: 'al' });
    expect(activeMention('mail@al', 7)).toBeNull();
    expect(activeMention('@Sam Rivera\nnext', 16)).toBeNull();
    expect(mentionCandidates('sa', MEMBERS).map((m) => m.id)).toEqual(['m2', 'm9']);
    expect(mentionCandidates('kim', MEMBERS).map((m) => m.id)).toEqual(['m1']);
    expect(mentionCandidates('', MEMBERS)).toHaveLength(3);
    const res = insertMention('hey @al there', { start: 4, query: 'al' }, 7, MEMBERS[0]);
    expect(res).toEqual({ text: 'hey @Alex Kim there', caret: 14 });
  });
});

describe('activity log', () => {
  let n = 0;
  const ctx = { actorId: 'm1', at: NOW_ISO, newId: (p: string) => `${p}${++n}` };

  it('records creates, deletes, field changes and new comments', () => {
    const a = task('a', { title: 'A' });
    const b = task('b');
    const a2: Task = {
      ...a,
      statusId: 'done',
      status: 'done',
      completedAt: NOW_ISO,
      order: 5,
      assigneeId: 'm2',
      tags: ['x', 'y'],
      blockedBy: ['c'],
      comments: [{ id: 'k1', authorId: 'm1', body: 'hi <@m2>', createdAt: NOW_ISO }],
    };
    const c = task('c', { title: 'C' });
    const entries = diffActivity([a, b], [c, a2], ctx);
    expect(
      entries.map((e) => [e.taskId, e.type, e.field ?? null, e.from ?? null, e.to ?? null]),
    ).toEqual([
      ['c', 'created', null, null, 'C'],
      ['a', 'status', 'statusId', 'todo', 'done'],
      ['a', 'assignee', 'assigneeId', null, 'm2'],
      ['a', 'field', 'tags', null, 'x,y'],
      ['a', 'dependency', 'blockedBy', null, 'c'],
      ['a', 'comment', null, null, 'hi <@m2>'],
      ['b', 'deleted', null, 'Task b', null],
    ]);
    expect(entries.every((e) => e.actorId === 'm1' && e.at === NOW_ISO)).toBe(true);
    // order / completedAt alone are not logged; identical objects are skipped
    expect(diffActivity([a], [{ ...a, order: 9 }], ctx)).toEqual([]);
    expect(diffActivity([a], [a], ctx)).toEqual([]);
  });

  it('caps the log, dropping the oldest entries', () => {
    const mk = (i: number) => ({ ...diffActivity([], [task(`t${i}`)], ctx)[0] });
    const log = [mk(1), mk(2)];
    expect(appendActivity(log, [])).toBe(log);
    expect(appendActivity(log, [mk(3), mk(4)], 3).map((e) => e.taskId)).toEqual(['t2', 't3', 't4']);
  });

  it('describes entries in words', () => {
    const projects = new Map<string, Project>([
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
    ]);
    const tasks = mapOf([task('c', { title: 'Write spec' })]);
    const names: Record<string, string> = {
      todo: 'To do',
      in_progress: 'In progress',
      done: 'Done',
    };
    const d = (from: Task, to: Task) =>
      diffActivity([from], [to], {
        ...ctx,
        statusName: (t) => names[t.statusId] ?? t.statusId,
      }).map((e) => describeActivity(e, { members: MEMBER_MAP, projects, tasks }));
    const base = task('a');
    expect(d(base, { ...base, statusId: 'in_progress', status: 'in_progress' })).toEqual([
      'changed status from To do to In progress',
    ]);
    expect(d(base, { ...base, projectId: 'p1', dueDate: '2026-06-20' })).toEqual([
      'changed project from no project to Website',
      'changed due date from none to Jun 20',
    ]);
    expect(d(base, { ...base, assigneeId: 'm2' })).toEqual([
      'changed assignee from unassigned to Sam Rivera',
    ]);
    expect(d({ ...base, blockedBy: ['zz'] }, { ...base, blockedBy: ['c'] })).toEqual([
      'added blocker “Write spec” and removed blocker “a deleted task”',
    ]);
    expect(
      d(base, {
        ...base,
        comments: [{ id: 'k', authorId: 'm1', body: 'cc <@m1>', createdAt: NOW_ISO }],
      }),
    ).toEqual(['commented: “cc @Alex Kim”']);
  });

  it('queries newest first, by actor and type', () => {
    const e = (taskId: string, actorId: string | null, type: 'status' | 'comment') => ({
      id: taskId,
      taskId,
      taskTitle: taskId,
      actorId,
      type,
      at: NOW_ISO,
    });
    const log = [e('1', 'm1', 'status'), e('2', 'm2', 'comment'), e('3', null, 'status')];
    expect(queryActivity(log, { actor: '', type: '' }).map((x) => x.id)).toEqual(['3', '2', '1']);
    expect(queryActivity(log, { actor: 'm1', type: '' }).map((x) => x.id)).toEqual(['1']);
    expect(queryActivity(log, { actor: 'none', type: '' }).map((x) => x.id)).toEqual(['3']);
    expect(queryActivity(log, { actor: '', type: 'status' }).map((x) => x.id)).toEqual(['3', '1']);
  });
});

describe('import validation: dependencies, comments, activity', () => {
  const NOW = new Date(2026, 5, 15, 12);

  it('defaults missing fields from older data', () => {
    const s = generateDemoData(3, NOW) as unknown as Record<string, unknown>;
    delete s['activity'];
    delete (s['settings'] as Record<string, unknown>)['currentUserId'];
    for (const t of s['tasks'] as Record<string, unknown>[]) {
      delete t['blockedBy'];
      delete t['comments'];
    }
    const res = validateAppState(JSON.parse(JSON.stringify(s)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.activity).toEqual([]);
    expect(res.state.settings.currentUserId).toBe('m1');
    expect(res.state.tasks.every((t) => t.blockedBy.length === 0 && t.comments.length === 0)).toBe(
      true,
    );
  });

  it('rejects unknown blockers, cycles, bad comments and bad entries', () => {
    const s = generateDemoData(3, NOW);
    const withTasks = (tasks: Task[]) => validateAppState({ ...s, tasks });
    const [t1, t2, t3] = s.tasks;
    const r1 = withTasks([{ ...t1, blockedBy: ['nope'] }, t2, t3]);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain('tasks[0].blockedBy');
    const r2 = withTasks([{ ...t1, blockedBy: ['t2'] }, { ...t2, blockedBy: ['t1'] }, t3]);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toContain('cycle');
    const r3 = withTasks([
      { ...t1, comments: [{ id: 'c', authorId: 'm1', body: '  ', createdAt: NOW_ISO }] },
      t2,
      t3,
    ]);
    expect(r3.ok).toBe(false);
    const r4 = validateAppState({ ...s, activity: [{ id: 'a', taskId: 't1', type: 'nope' }] });
    expect(r4.ok).toBe(false);
    expect(withTasks([{ ...t1, blockedBy: ['t2'] }, t2, t3]).ok).toBe(true);
  });
});
