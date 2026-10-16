import { describe, expect, it } from 'vitest';
import type { Task } from '~/lib/types';
import { generateDemoData, mulberry32 } from '~/lib/demo';
import { DEFAULT_QUERY, filterTasks, matchesSearch, paginate, parseTaskQuery, serializeTaskQuery, sortTasks, tokenize } from '~/lib/filters';
import { completedPerDay, computeKpis, openByPriority, productivityStreak, projectProgress, upcomingDeadlines } from '~/lib/stats';
import { validateImport, validateTaskDraft } from '~/lib/validation';
import type { TaskDraft } from '~/lib/validation';
import { createHistory, record, redo, undo } from '~/lib/history';
import { placeInColumn, sortByOrder } from '~/lib/taskOps';
import { withWorkflowStatus, workflowResolver } from '~/lib/workflows';
import { boardColumns, groupByColumn, statusForColumn } from '~/lib/board';
import { monthGrid } from '~/lib/calendar';

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

/** Local-noon timestamp for a calendar day (timezone-safe in tests). */
const at = (day: string): string => new Date(`${day}T12:00:00`).toISOString();

describe('demo data generator', () => {
  it('mulberry32 is deterministic for seed 42', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect(seqA[0]).toBeGreaterThanOrEqual(0);
    expect(seqA[0]).toBeLessThan(1);
  });

  it('produces identical output for identical input', () => {
    const now = new Date('2026-03-15T12:00:00');
    expect(generateDemoData(200, now)).toEqual(generateDemoData(200, now));
  });

  it('follows the spec shape (6 projects, titles, tags, subtasks)', () => {
    const data = generateDemoData(300, new Date('2026-03-15T12:00:00'));
    expect(data.projects.map((p) => p.name)).toEqual(['Website', 'Mobile App', 'Marketing', 'Infrastructure', 'Hiring', 'Personal']);
    expect(data.projects[0]?.color).toBe('#6366f1');
    expect(data.tasks).toHaveLength(300);
    data.tasks.forEach((t, i) => {
      expect(t.title).toMatch(new RegExp(`^\\w+ .+ #${i + 1}$`));
      expect(t.description).toBe(`Demo task ${i + 1}`);
      expect(t.tags.length).toBeLessThanOrEqual(3);
      expect(new Set(t.tags).size).toBe(t.tags.length);
      expect(t.subtasks.length).toBeLessThanOrEqual(3);
      expect(t.completedAt !== null).toBe(t.status === 'done');
      if (t.completedAt) expect(Date.parse(t.completedAt)).toBeLessThanOrEqual(Date.parse('2026-03-15T12:00:00'));
    });
    // first task is stable for seed 42
    expect(data.tasks[0]?.title).toBe(generateDemoData(1, new Date('2026-03-15T12:00:00')).tasks[0]?.title);
  });

  it('status distribution roughly matches the configured probabilities', () => {
    const { tasks } = generateDemoData(2000);
    const done = tasks.filter((t) => t.status === 'done').length / tasks.length;
    expect(done).toBeGreaterThan(0.4);
    expect(done).toBeLessThan(0.5);
  });
});

describe('search & filters', () => {
  const tasks = [
    task('1', { title: 'Deploy invoice export', tags: ['backend'], status: 'todo', priority: 'high', projectId: 'p1', dueDate: '2026-03-10' }),
    task('2', { title: 'Write docs', description: 'Invoice section', status: 'done', priority: 'low', dueDate: '2026-03-10' }),
    task('3', { title: 'Design landing page', tags: ['design', 'frontend'], status: 'in_progress', priority: 'urgent', projectId: 'p2', dueDate: TODAY }),
    task('4', { title: 'Plan sprint', status: 'todo', priority: 'medium', dueDate: '2026-03-18' }),
  ];

  it('tokenizes and matches across title, description and tags (AND semantics)', () => {
    expect(tokenize('  Deploy   INVOICE ')).toEqual(['deploy', 'invoice']);
    expect(matchesSearch(tasks[0]!, tokenize('deploy invoice'))).toBe(true);
    expect(matchesSearch(tasks[1]!, tokenize('invoice'))).toBe(true); // description
    expect(matchesSearch(tasks[2]!, tokenize('frontend'))).toBe(true); // tag
    expect(matchesSearch(tasks[3]!, tokenize('deploy invoice'))).toBe(false);
  });

  it('filters by status, priority, project and tag', () => {
    expect(filterTasks(tasks, { ...DEFAULT_QUERY, status: ['todo', 'in_progress'] }, TODAY).map((t) => t.id)).toEqual(['1', '3', '4']);
    expect(filterTasks(tasks, { ...DEFAULT_QUERY, priority: ['urgent', 'high'] }, TODAY).map((t) => t.id)).toEqual(['1', '3']);
    expect(filterTasks(tasks, { ...DEFAULT_QUERY, project: 'p2' }, TODAY).map((t) => t.id)).toEqual(['3']);
    expect(filterTasks(tasks, { ...DEFAULT_QUERY, project: 'none' }, TODAY).map((t) => t.id)).toEqual(['2', '4']);
    expect(filterTasks(tasks, { ...DEFAULT_QUERY, tag: 'design' }, TODAY).map((t) => t.id)).toEqual(['3']);
  });

  it('filters by due bucket (overdue ignores done tasks)', () => {
    const ids = (due: typeof DEFAULT_QUERY.due): string[] => filterTasks(tasks, { ...DEFAULT_QUERY, due }, TODAY).map((t) => t.id);
    expect(ids('overdue')).toEqual(['1']);
    expect(ids('today')).toEqual(['3']);
    // 2026-03-15 is a Sunday → week is Mon 9th..Sun 15th
    expect(ids('week')).toEqual(['1', '2', '3']);
    expect(filterTasks([...tasks, task('5')], { ...DEFAULT_QUERY, due: 'none' }, TODAY).map((t) => t.id)).toEqual(['5']);
  });

  it('round-trips the query through the URL representation', () => {
    const q = { ...DEFAULT_QUERY, q: 'abc', status: ['done' as const], priority: ['high' as const, 'low' as const], due: 'week' as const, sort: 'title' as const, dir: 'asc' as const, page: 3 };
    expect(parseTaskQuery(serializeTaskQuery(q))).toEqual(q);
    expect(serializeTaskQuery(DEFAULT_QUERY)).toEqual({});
    expect(parseTaskQuery({ status: 'bogus,todo', sort: 'nope', page: '-2' })).toMatchObject({ status: ['todo'], sort: 'created', page: 1 });
  });
});

describe('sorting & pagination', () => {
  const tasks = [
    task('a', { title: 'Banana', priority: 'low', dueDate: '2026-03-20', createdAt: '2026-03-03T00:00:00.000Z' }),
    task('b', { title: 'apple', priority: 'urgent', dueDate: null, createdAt: '2026-03-01T00:00:00.000Z' }),
    task('c', { title: 'Cherry', priority: 'high', dueDate: '2026-03-16', createdAt: '2026-03-02T00:00:00.000Z' }),
  ];

  it('sorts by title, priority and created in both directions', () => {
    expect(sortTasks(tasks, 'title', 'asc').map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(sortTasks(tasks, 'priority', 'desc').map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(sortTasks(tasks, 'created', 'asc').map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(sortTasks(tasks, 'created', 'desc').map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps tasks without due date last in both directions', () => {
    expect(sortTasks(tasks, 'due', 'asc').map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(sortTasks(tasks, 'due', 'desc').map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });

  it('paginates and clamps out-of-range pages', () => {
    const items = Array.from({ length: 53 }, (_, i) => i);
    expect(paginate(items, 1, 25).items).toHaveLength(25);
    expect(paginate(items, 3, 25)).toMatchObject({ page: 3, pageCount: 3, items: [50, 51, 52] });
    expect(paginate(items, 99, 25).page).toBe(3);
    expect(paginate([], 1, 25)).toMatchObject({ page: 1, pageCount: 1, items: [] });
  });
});

describe('KPIs & streak', () => {
  const tasks = [
    task('1', { status: 'done', completedAt: at('2026-03-15'), timeSpentMinutes: 90 }),
    task('2', { status: 'done', completedAt: at('2026-03-14'), timeSpentMinutes: 30 }),
    task('3', { status: 'done', completedAt: at('2026-03-13') }),
    task('4', { status: 'done', completedAt: at('2026-03-01') }),
    task('5', { status: 'todo', dueDate: '2026-03-10', priority: 'urgent' }),
    task('6', { status: 'in_progress', dueDate: '2026-03-17', priority: 'high' }),
  ];

  it('computes KPI tiles', () => {
    expect(computeKpis(tasks, TODAY)).toEqual({ total: 6, open: 2, overdue: 1, completed7d: 3, completionRate: 67, hoursTracked: 2 });
    expect(computeKpis([], TODAY).completionRate).toBe(0);
  });

  it('counts the streak ending today, or yesterday when nothing is done today', () => {
    expect(productivityStreak(tasks, TODAY)).toBe(3);
    expect(productivityStreak(tasks.slice(1), TODAY)).toBe(2); // ends yesterday
    expect(productivityStreak(tasks.slice(3), TODAY)).toBe(0);
  });

  it('builds the 30-day series, priority breakdown, project progress and upcoming list', () => {
    const series = completedPerDay(tasks, TODAY, 30);
    expect(series).toHaveLength(30);
    expect(series[29]).toEqual({ date: TODAY, count: 1 });
    expect(series.reduce((s, d) => s + d.count, 0)).toBe(4);
    expect(openByPriority(tasks)).toEqual({ low: 0, medium: 0, high: 1, urgent: 1 });
    const prog = projectProgress([{ id: 'p', name: 'P', color: '#000000', createdAt: NOW, parentId: null, workflow: null }], [task('x', { projectId: 'p', status: 'done' }), task('y', { projectId: 'p' })]);
    expect(prog[0]).toMatchObject({ total: 2, done: 1, percent: 50 });
    expect(upcomingDeadlines(tasks, TODAY).map((t) => t.id)).toEqual(['6']);
  });
});

describe('validation', () => {
  const draft: TaskDraft = { title: 'Ok', description: '', statusId: 'todo', priority: 'low', projectId: null, tags: [], dueDate: null, estimate: '', assigneeId: null, recurrence: 'none' };

  it('validates task drafts with inline error messages', () => {
    expect(validateTaskDraft(draft)).toEqual({});
    expect(validateTaskDraft({ ...draft, title: '   ' }).title).toMatch(/required/);
    expect(validateTaskDraft({ ...draft, title: 'x'.repeat(121) }).title).toMatch(/120/);
    expect(validateTaskDraft({ ...draft, description: 'x'.repeat(2001) }).description).toBeDefined();
    expect(validateTaskDraft({ ...draft, tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }).tags).toBeDefined();
    expect(validateTaskDraft({ ...draft, estimate: '0' }).estimate).toBeDefined();
    expect(validateTaskDraft({ ...draft, estimate: '1.5' }).estimate).toBeDefined();
    expect(validateTaskDraft({ ...draft, estimate: '45' })).toEqual({});
  });

  it('accepts a valid export and rejects malformed imports with clear errors', () => {
    const state = generateDemoData(20);
    const ok = validateImport(JSON.stringify(state));
    expect(ok.ok).toBe(true);

    const notJson = validateImport('{oops');
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.errors[0]).toMatch(/not valid JSON/);

    const { statusId: _sid, ...v1Task } = state.tasks[0]!;
    const bad = validateImport({ ...state, tasks: [{ ...v1Task, status: 'later', projectId: 'missing' }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.includes('tasks[0].status'))).toBe(true);
      expect(bad.errors.some((e) => e.includes('tasks[0].projectId'))).toBe(true);
    }
    const badStatus = validateImport({ ...state, tasks: [{ ...state.tasks[0], statusId: 'later' }] });
    expect(!badStatus.ok && badStatus.errors[0]).toMatch(/tasks\[0\]\.statusId “later” is not a status/);
    expect(validateImport([1, 2]).ok).toBe(false);
    expect(validateImport({ tasks: [] }).ok).toBe(false);
  });
});

describe('undo / redo history', () => {
  it('undoes and redoes snapshots, and a new change clears redo', () => {
    let h = createHistory<number>(50);
    let cur = 0;
    h = record(h, cur);
    cur = 1;
    h = record(h, cur);
    cur = 2;
    const u1 = undo(h, cur)!;
    expect(u1.state).toBe(1);
    const u2 = undo(u1.history, u1.state)!;
    expect(u2.state).toBe(0);
    expect(undo(u2.history, u2.state)).toBeNull();
    const r1 = redo(u2.history, u2.state)!;
    expect(r1.state).toBe(1);
    const h2 = record(r1.history, r1.state);
    expect(redo(h2, 5)).toBeNull();
  });

  it('caps history depth at the limit (50)', () => {
    let h = createHistory<number>(50);
    for (let i = 0; i < 80; i++) h = record(h, i);
    expect(h.past).toHaveLength(50);
    expect(h.past[0]).toBe(30);
  });
});

describe('board moves', () => {
  const base = [
    task('a', { status: 'todo', order: 0 }),
    task('b', { status: 'todo', order: 1 }),
    task('c', { status: 'todo', order: 2 }),
    task('d', { status: 'done', order: 0, completedAt: NOW }),
  ];
  const wf = workflowResolver([]);
  const { mode, columns } = boardColumns(null, wf);
  const ids = (list: Task[]): string[] => list.map((t) => t.id);

  it('moves within and between columns, renumbering order and maintaining completedAt', () => {
    const col = (tasks: Task[], key: string): string[] => ids(groupByColumn(tasks, mode, columns)[key] ?? []);
    const within = placeInColumn(base, 'c', ['a', 'b'], 0, (t) => t);
    expect(col(within, 'todo')).toEqual(['c', 'a', 'b']);
    const done = wf.statusOf(null, 'done')!;
    const across = placeInColumn(base, 'a', ['d'], 1, (t) => withWorkflowStatus(t, done, NOW));
    expect(col(across, 'done')).toEqual(['d', 'a']);
    expect(col(across, 'todo')).toEqual(['b', 'c']);
    expect(across.find((t) => t.id === 'a')).toMatchObject({ statusId: 'done', status: 'done', completedAt: NOW });
    expect(withWorkflowStatus(across.find((t) => t.id === 'a')!, wf.statusOf(null, 'todo')!, NOW).completedAt).toBeNull();
    // untouched tasks keep their identity
    expect(across.find((t) => t.id === 'b')).toBe(base[1]);
  });

  it('resolves the status a task gets in a column', () => {
    expect(statusForColumn(base[0]!, columns[2]!, mode, wf).id).toBe('done');
    expect(statusForColumn(base[0]!, columns[0]!, mode, wf).id).toBe('todo');
    expect(ids(sortByOrder([base[2]!, base[0]!, base[1]!]))).toEqual(['a', 'b', 'c']);
  });
});

describe('calendar grid', () => {
  it('starts on Monday and covers whole weeks', () => {
    const days = monthGrid(2026, 2); // March 2026 starts on a Sunday
    expect(days.length % 7).toBe(0);
    expect(days[0]?.date).toBe('2026-02-23');
    expect(days.find((d) => d.inMonth)?.date).toBe('2026-03-01');
    expect(days.filter((d) => d.inMonth)).toHaveLength(31);
  });
});
