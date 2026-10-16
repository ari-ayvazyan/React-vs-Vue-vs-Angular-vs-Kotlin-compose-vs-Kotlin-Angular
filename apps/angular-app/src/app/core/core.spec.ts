import { generateDemoData, mulberry32 } from './demo-data';
import {
  DEFAULT_QUERY,
  filterTasks,
  matchesSearch,
  paginate,
  parseQuery,
  serializeQuery,
  sortTasks,
  TaskQuery,
} from './filters';
import {
  completedPerDay,
  computeKpis,
  openByPriority,
  productivityStreak,
  projectProgress,
  upcomingDeadlines,
} from './stats';
import {
  parseImport,
  parseTags,
  validateAppState,
  validateTaskDraft,
  TaskDraft,
} from './validation';
import { UndoHistory } from './history';
import { moveTask, columnTasks, withStatus } from './task-ops';
import { Task } from './models';
import { addDays, toDateKey } from './dates';

const NOW = new Date(2026, 5, 15, 12, 0, 0); // 15 Jun 2026, local noon
const TODAY = toDateKey(NOW);
const q = (p: Partial<TaskQuery> = {}): TaskQuery => ({ ...DEFAULT_QUERY, ...p });

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
    createdAt: NOW.toISOString(),
    completedAt: null,
    order: 0,
    ...p,
  };
  // the default workflow's status ids equal the categories
  return p.statusId ? t : { ...t, statusId: t.status };
}

describe('demo data generator', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const first = mulberry32(42)();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });

  it('produces identical output for the same count and date', () => {
    expect(generateDemoData(200, NOW)).toEqual(generateDemoData(200, NOW));
  });

  it('creates 6 projects and the requested number of tasks with valid shape', () => {
    const s = generateDemoData(300, NOW);
    expect(s.projects.map((p) => p.name)).toEqual([
      'Website',
      'Mobile App',
      'Marketing',
      'Infrastructure',
      'Hiring',
      'Personal',
    ]);
    expect(s.tasks).toHaveLength(300);
    expect(s.tasks[0].title).toMatch(/^\w+ .+ #1$/);
    expect(s.tasks[299].description).toBe('Demo task 300');
    for (const t of s.tasks) {
      expect(t.tags.length).toBeLessThanOrEqual(3);
      expect(new Set(t.tags).size).toBe(t.tags.length);
      expect(t.completedAt === null).toBe(t.status !== 'done');
      if (t.completedAt) expect(Date.parse(t.completedAt)).toBeLessThanOrEqual(NOW.getTime());
    }
    expect(validateAppState(s).ok).toBe(true);
  });

  it('a prefix of tasks is stable regardless of count', () => {
    const a = generateDemoData(10, NOW).tasks.map((t) => t.title);
    const b = generateDemoData(50, NOW)
      .tasks.slice(0, 10)
      .map((t) => t.title);
    expect(a).toEqual(b);
  });
});

describe('filtering & search', () => {
  const tasks = [
    task('a', {
      title: 'Fix login flow',
      status: 'done',
      priority: 'high',
      tags: ['bug'],
      projectId: 'p1',
      dueDate: addKey(-2),
    }),
    task('b', {
      title: 'Write API docs',
      description: 'Swagger update',
      priority: 'low',
      tags: ['docs'],
      dueDate: addKey(-1),
    }),
    task('c', {
      title: 'Design dashboard',
      status: 'in_progress',
      priority: 'urgent',
      projectId: 'p2',
      dueDate: TODAY,
    }),
    task('d', { title: 'Plan release', tags: ['meeting'] }),
  ];

  it('searches title, description and tags case-insensitively', () => {
    expect(matchesSearch(tasks[0], 'LOGIN')).toBe(true);
    expect(filterTasks(tasks, q({ q: 'swagger' }), TODAY).map((t) => t.id)).toEqual(['b']);
    expect(filterTasks(tasks, q({ q: 'meeting' }), TODAY).map((t) => t.id)).toEqual(['d']);
    expect(filterTasks(tasks, q({ q: 'plan release' }), TODAY).map((t) => t.id)).toEqual(['d']);
  });

  it('filters by multiple statuses and priorities', () => {
    expect(
      filterTasks(tasks, q({ status: ['todo', 'in_progress'] }), TODAY).map((t) => t.id),
    ).toEqual(['b', 'c', 'd']);
    expect(filterTasks(tasks, q({ priority: ['high', 'urgent'] }), TODAY).map((t) => t.id)).toEqual(
      ['a', 'c'],
    );
  });

  it('filters by project, no-project and tag', () => {
    expect(filterTasks(tasks, q({ project: 'p2' }), TODAY).map((t) => t.id)).toEqual(['c']);
    expect(filterTasks(tasks, q({ project: 'none' }), TODAY).map((t) => t.id)).toEqual(['b', 'd']);
    expect(filterTasks(tasks, q({ tag: 'bug' }), TODAY).map((t) => t.id)).toEqual(['a']);
  });

  it('filters by due: overdue excludes done tasks, today, none', () => {
    expect(filterTasks(tasks, q({ due: 'overdue' }), TODAY).map((t) => t.id)).toEqual(['b']);
    expect(filterTasks(tasks, q({ due: 'today' }), TODAY).map((t) => t.id)).toEqual(['c']);
    expect(filterTasks(tasks, q({ due: 'none' }), TODAY).map((t) => t.id)).toEqual(['d']);
  });

  it('round-trips query params', () => {
    const query = q({
      q: 'abc',
      status: ['done'],
      priority: ['low', 'high'],
      due: 'week',
      sort: 'title',
      dir: 'asc',
      page: 3,
    });
    expect(parseQuery(serializeQuery(query))).toEqual(query);
    expect(serializeQuery(DEFAULT_QUERY)).toEqual({});
    expect(parseQuery({ status: 'bogus,done', page: '-1', sort: 'nope' })).toMatchObject({
      status: ['done'],
      page: 1,
      sort: 'created',
    });
  });
});

describe('sorting & pagination', () => {
  const tasks = [
    task('a', {
      title: 'beta',
      priority: 'low',
      dueDate: '2026-06-20',
      createdAt: '2026-01-02T00:00:00Z',
    }),
    task('b', {
      title: 'Alpha',
      priority: 'urgent',
      dueDate: null,
      createdAt: '2026-01-03T00:00:00Z',
    }),
    task('c', {
      title: 'gamma',
      priority: 'medium',
      dueDate: '2026-06-10',
      createdAt: '2026-01-01T00:00:00Z',
    }),
  ];

  it('sorts by priority, title and created in both directions', () => {
    expect(sortTasks(tasks, 'priority', 'desc').map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(sortTasks(tasks, 'title', 'asc').map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(sortTasks(tasks, 'created', 'desc').map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by due date keeping tasks without date last in both directions', () => {
    expect(sortTasks(tasks, 'due', 'asc').map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(sortTasks(tasks, 'due', 'desc').map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });

  it('paginates and clamps the page', () => {
    const items = Array.from({ length: 53 }, (_, i) => i);
    expect(paginate(items, 3, 25)).toEqual({ items: [50, 51, 52], page: 3, pages: 3 });
    expect(paginate(items, 99, 25).page).toBe(3);
    expect(paginate([], 1, 25)).toEqual({ items: [], page: 1, pages: 1 });
  });
});

function addKey(days: number): string {
  return toDateKey(addDays(NOW, days));
}
function isoDaysAgo(days: number): string {
  return addDays(NOW, -days).toISOString();
}

describe('KPIs & stats', () => {
  it('computes KPI tiles', () => {
    const tasks = [
      task('a', { status: 'done', completedAt: isoDaysAgo(1), timeSpentMinutes: 90 }),
      task('b', { status: 'done', completedAt: isoDaysAgo(10), timeSpentMinutes: 30 }),
      task('c', { dueDate: addKey(-3) }),
      task('d', { status: 'in_progress', dueDate: addKey(2) }),
    ];
    expect(computeKpis(tasks, NOW)).toEqual({
      total: 4,
      open: 2,
      overdue: 1,
      completed7d: 1,
      completionRate: 50,
      hoursTracked: 2,
    });
    expect(computeKpis([], NOW).completionRate).toBe(0);
  });

  it('counts completions per day over 30 days', () => {
    const tasks = [
      task('a', { status: 'done', completedAt: NOW.toISOString() }),
      task('b', { status: 'done', completedAt: NOW.toISOString() }),
      task('c', { status: 'done', completedAt: isoDaysAgo(29) }),
      task('d', { status: 'done', completedAt: isoDaysAgo(30) }),
    ];
    const days = completedPerDay(tasks, NOW, 30);
    expect(days).toHaveLength(30);
    expect(days[29]).toEqual({ date: TODAY, count: 2 });
    expect(days[0].count).toBe(1);
    expect(days.reduce((a, d) => a + d.count, 0)).toBe(3);
  });

  it('calculates the streak ending today or yesterday', () => {
    const done = (d: number) => task(`t${d}`, { status: 'done', completedAt: isoDaysAgo(d) });
    expect(productivityStreak([done(0), done(1), done(2), done(4)], NOW)).toBe(3);
    expect(productivityStreak([done(1), done(2)], NOW)).toBe(2);
    expect(productivityStreak([done(2), done(3)], NOW)).toBe(0);
    expect(productivityStreak([], NOW)).toBe(0);
  });

  it('breaks down open tasks by priority and projects by completion', () => {
    const tasks = [
      task('a', { priority: 'urgent', projectId: 'p1' }),
      task('b', { priority: 'urgent', status: 'done', projectId: 'p1' }),
      task('c', { priority: 'low', projectId: 'p1', status: 'done' }),
    ];
    expect(openByPriority(tasks)).toEqual({ low: 0, medium: 0, high: 0, urgent: 1 });
    const proj = projectProgress(tasks, [
      {
        id: 'p1',
        name: 'P',
        color: '#000000',
        createdAt: NOW.toISOString(),
        parentId: null,
        workflow: null,
      },
    ]);
    expect(proj[0]).toMatchObject({ total: 3, done: 2, percent: 67 });
  });

  it('lists upcoming deadlines in the next 7 days, sorted, max 8', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(`u${i}`, { dueDate: addKey(i) }));
    tasks.push(task('done', { dueDate: TODAY, status: 'done' }));
    const up = upcomingDeadlines(tasks, NOW, 7, 8);
    expect(up).toHaveLength(8);
    expect(up[0].id).toBe('u0');
    expect(up.every((t) => t.status !== 'done')).toBe(true);
  });
});

describe('validation', () => {
  const draft = (p: Partial<TaskDraft> = {}): TaskDraft => ({
    title: 'ok',
    description: '',
    statusId: 'todo',
    status: 'todo',
    priority: 'low',
    projectId: null,
    assigneeId: null,
    recurrence: 'none',
    tags: [],
    dueDate: null,
    estimate: '',
    ...p,
  });

  it('validates task drafts', () => {
    expect(validateTaskDraft(draft())).toEqual({});
    expect(validateTaskDraft(draft({ title: '   ' })).title).toMatch(/required/);
    expect(validateTaskDraft(draft({ title: 'x'.repeat(121) })).title).toMatch(/120/);
    expect(validateTaskDraft(draft({ description: 'x'.repeat(2001) })).description).toBeTruthy();
    expect(
      validateTaskDraft(draft({ tags: Array.from({ length: 9 }, (_, i) => `t${i}`) })).tags,
    ).toBeTruthy();
    expect(validateTaskDraft(draft({ estimate: '0' })).estimate).toBeTruthy();
    expect(validateTaskDraft(draft({ estimate: '1.5' })).estimate).toBeTruthy();
    expect(validateTaskDraft(draft({ estimate: '45' })).estimate).toBeUndefined();
  });

  it('normalises tags to lowercase unique values', () => {
    expect(parseTags('Bug, bug  #Feature,,ui')).toEqual(['bug', 'feature', 'ui']);
  });

  it('accepts a valid export and rejects invalid imports with a clear message', () => {
    const state = generateDemoData(20, NOW);
    const ok = parseImport(JSON.stringify(state));
    expect(ok.ok).toBe(true);

    const notJson = parseImport('{oops');
    expect(notJson).toEqual({ ok: false, error: 'File is not valid JSON.' });

    const badStatus = structuredClone(state);
    (badStatus.tasks[3] as unknown as Record<string, unknown>)['status'] = 'blocked';
    const r1 = validateAppState(badStatus);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain('tasks[3].status');

    const badProject = structuredClone(state);
    badProject.tasks[0].projectId = 'missing';
    expect(validateAppState(badProject).ok).toBe(false);

    expect(validateAppState([]).ok).toBe(false);
    expect(validateAppState({ tasks: [], projects: 'x' }).ok).toBe(false);
  });
});

describe('undo/redo history', () => {
  it('undoes and redoes snapshots', () => {
    const h = new UndoHistory<number>(50);
    let state = 0;
    for (let i = 1; i <= 3; i++) {
      h.record(state);
      state = i;
    }
    state = h.undo(state)!;
    expect(state).toBe(2);
    state = h.undo(state)!;
    expect(state).toBe(1);
    state = h.redo(state)!;
    expect(state).toBe(2);
    expect(h.canRedo).toBe(true);
    h.record(state);
    state = 9;
    expect(h.canRedo).toBe(false);
    expect(h.redo(state)).toBeNull();
  });

  it('is bounded to the configured depth', () => {
    const h = new UndoHistory<number>(50);
    for (let i = 0; i < 80; i++) h.record(i);
    expect(h.size).toBe(50);
    let cur = 80;
    let n = 0;
    let prev: number | null;
    while ((prev = h.undo(cur)) !== null) {
      cur = prev;
      n++;
    }
    expect(n).toBe(50);
    expect(cur).toBe(30);
  });
});

describe('board moves', () => {
  it('moves a card across columns and renumbers order; sets/clears completedAt', () => {
    const tasks = [
      task('a', { status: 'todo', order: 0 }),
      task('b', { status: 'todo', order: 1 }),
      task('c', { status: 'done', order: 0, completedAt: NOW.toISOString() }),
    ];
    const moved = moveTask(tasks, 'a', 'done', 0, 'NOW');
    expect(columnTasks(moved, 'done').map((t) => t.id)).toEqual(['a', 'c']);
    expect(columnTasks(moved, 'todo').map((t) => [t.id, t.order])).toEqual([['b', 0]]);
    expect(moved.find((t) => t.id === 'a')!.completedAt).toBe('NOW');
    expect(
      withStatus(
        moved.find((t) => t.id === 'c')!,
        'todo',
        'X',
      ).completedAt,
    ).toBeNull();
  });

  it('reorders within a column', () => {
    const tasks = [task('a', { order: 0 }), task('b', { order: 1 }), task('c', { order: 2 })];
    expect(columnTasks(moveTask(tasks, 'a', 'todo', 2, 'N'), 'todo').map((t) => t.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(columnTasks(moveTask(tasks, 'c', 'todo', 0, 'N'), 'todo').map((t) => t.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});
