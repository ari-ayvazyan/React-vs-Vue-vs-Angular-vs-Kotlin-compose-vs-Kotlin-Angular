import { describe, expect, it } from 'vitest';
import { addDays, monthGrid, startOfWeek, weekdayMon } from '../lib/dates';
import { generateDemoData, mulberry32 } from '../lib/demo';
import {
  DEFAULT_QUERY,
  filterTasks,
  matchesSearch,
  paginate,
  parseQuery,
  queryToSearch,
  searchTerms,
  sortTasks,
  type TaskQuery,
} from '../lib/filters';
import { createHistory, pushHistory, redo, undo } from '../lib/history';
import { dataReducer, moveTask, type Data } from '../lib/reducer';
import { completedPerDay, computeKpis, openByPriority, productivityStreak, upcomingDeadlines } from '../lib/stats';
import { TaskStore } from '../lib/store';
import { emptyData, task } from './fixtures';
import { draftFromTask, parseImport, parseTags, validateDraft, validateImport } from '../lib/validation';

const TODAY = '2026-10-15';
const NOW = new Date(2026, 9, 15, 12, 0, 0);

const q = (p: Partial<TaskQuery>): TaskQuery => ({ ...DEFAULT_QUERY, ...p });
const at = (key: string) => new Date(`${key}T12:00:00`).toISOString();

describe('demo data generator', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('generates identical data for identical inputs', () => {
    expect(generateDemoData(200, NOW)).toEqual(generateDemoData(200, NOW));
  });

  it('produces the spec shape: 6 projects, N tasks, valid fields', () => {
    const s = generateDemoData(300, NOW);
    expect(s.projects.map((p) => p.name)).toEqual(['Website', 'Mobile App', 'Marketing', 'Infrastructure', 'Hiring', 'Personal']);
    expect(s.projects[0].color).toBe('#6366f1');
    expect(s.tasks).toHaveLength(300);
    expect(s.tasks[0].title).toMatch(/ #1$/);
    expect(s.tasks[0].description).toBe('Demo task 1');
    for (const t of s.tasks) {
      expect(t.tags.length).toBeLessThanOrEqual(3);
      expect(new Set(t.tags).size).toBe(t.tags.length);
      expect(t.completedAt !== null).toBe(t.category === 'done');
      if (t.completedAt) expect(Date.parse(t.completedAt)).toBeLessThanOrEqual(NOW.getTime());
    }
    expect(validateImport(s).ok).toBe(true);
  });

  it('prefix of a larger dataset equals the smaller dataset', () => {
    const small = generateDemoData(50, NOW).tasks.map((t) => t.title);
    const big = generateDemoData(100, NOW).tasks.slice(0, 50).map((t) => t.title);
    expect(big).toEqual(small);
  });
});

describe('filtering & search', () => {
  const tasks = [
    task({ title: 'Deploy invoice export', status: 'todo', priority: 'high', tags: ['backend'], dueDate: addDays(TODAY, -2) }),
    task({ title: 'Write docs', status: 'done', priority: 'low', tags: ['docs'], projectId: 'p1', dueDate: TODAY }),
    task({ title: 'Plan sprint', description: 'Invoice planning', status: 'in_progress', priority: 'urgent', projectId: 'p1' }),
    task({ title: 'Design landing', status: 'todo', priority: 'low', dueDate: addDays(TODAY, 30) }),
  ];

  it('search matches all terms across title, description and tags', () => {
    expect(searchTerms('  Deploy   INVOICE ')).toEqual(['deploy', 'invoice']);
    expect(filterTasks(tasks, q({ q: 'deploy invoice' }), TODAY).map((t) => t.title)).toEqual(['Deploy invoice export']);
    expect(filterTasks(tasks, q({ q: 'invoice' }), TODAY)).toHaveLength(2);
    expect(matchesSearch(tasks[1], ['docs'])).toBe(true);
  });

  it('filters by status and priority (multi)', () => {
    expect(filterTasks(tasks, q({ status: ['todo', 'done'] }), TODAY)).toHaveLength(3);
    expect(filterTasks(tasks, q({ priority: ['low'] }), TODAY)).toHaveLength(2);
    expect(filterTasks(tasks, q({ status: ['todo'], priority: ['low'] }), TODAY)).toHaveLength(1);
  });

  it('filters by project (incl. no project) and tag', () => {
    expect(filterTasks(tasks, q({ project: 'p1' }), TODAY)).toHaveLength(2);
    expect(filterTasks(tasks, q({ project: 'none' }), TODAY)).toHaveLength(2);
    expect(filterTasks(tasks, q({ tag: 'docs' }), TODAY)).toHaveLength(1);
  });

  it('filters by due bucket', () => {
    expect(filterTasks(tasks, q({ due: 'overdue' }), TODAY).map((t) => t.title)).toEqual(['Deploy invoice export']);
    expect(filterTasks(tasks, q({ due: 'today' }), TODAY)).toHaveLength(1);
    expect(filterTasks(tasks, q({ due: 'none' }), TODAY)).toHaveLength(1);
    // 2026-10-15 is a Thursday → week is Mon 12 .. Sun 18
    expect(filterTasks(tasks, q({ due: 'week' }), TODAY)).toHaveLength(2);
  });

  it('round-trips the query through the URL', () => {
    const query = q({ q: 'abc', status: ['done'], priority: ['high', 'low'], assignee: 'm2', due: 'week', sort: 'title', dir: 'asc', page: 3 });
    expect(parseQuery(new URLSearchParams(queryToSearch(query)))).toEqual(query);
    expect(queryToSearch(DEFAULT_QUERY)).toBe('');
    expect(parseQuery(new URLSearchParams('status=bogus,todo&page=-1&sort=zzz'))).toEqual(q({ status: ['todo'] }));
  });
});

describe('sorting & pagination', () => {
  const a = task({ title: 'b item 10', priority: 'low', dueDate: '2026-10-20', createdAt: '2026-10-01T00:00:00.000Z' });
  const b = task({ title: 'B item 9', priority: 'urgent', dueDate: null, createdAt: '2026-10-03T00:00:00.000Z' });
  const c = task({ title: 'a item', priority: 'high', dueDate: '2026-10-10', createdAt: '2026-10-02T00:00:00.000Z' });

  it('sorts by due date with empty dates last in both directions', () => {
    expect(sortTasks([a, b, c], 'due', 'asc').map((t) => t.id)).toEqual([c.id, a.id, b.id]);
    expect(sortTasks([a, b, c], 'due', 'desc').map((t) => t.id)).toEqual([a.id, c.id, b.id]);
  });

  it('sorts by priority, created and title (natural order)', () => {
    expect(sortTasks([a, b, c], 'priority', 'desc').map((t) => t.priority)).toEqual(['urgent', 'high', 'low']);
    expect(sortTasks([a, b, c], 'created', 'asc').map((t) => t.id)).toEqual([a.id, c.id, b.id]);
    expect(sortTasks([a, b, c], 'title', 'asc').map((t) => t.title)).toEqual(['a item', 'B item 9', 'b item 10']);
  });

  it('paginates and clamps the page', () => {
    const items = Array.from({ length: 53 }, (_, i) => i);
    expect(paginate(items, 1, 25).items).toHaveLength(25);
    expect(paginate(items, 3, 25)).toMatchObject({ page: 3, pageCount: 3, total: 53 });
    expect(paginate(items, 3, 25).items).toEqual([50, 51, 52]);
    expect(paginate(items, 99, 25).page).toBe(3);
    expect(paginate([], 1, 25).pageCount).toBe(1);
  });
});

describe('KPIs & charts', () => {
  const tasks = [
    task({ status: 'done', completedAt: at(TODAY), timeSpentMinutes: 90 }),
    task({ status: 'done', completedAt: at(addDays(TODAY, -1)), timeSpentMinutes: 30 }),
    task({ status: 'done', completedAt: at(addDays(TODAY, -3)) }),
    task({ status: 'done', completedAt: at(addDays(TODAY, -10)) }),
    task({ status: 'todo', dueDate: addDays(TODAY, -1), priority: 'urgent' }),
    task({ status: 'in_progress', dueDate: addDays(TODAY, 2), priority: 'high' }),
  ];

  it('computes KPI tiles', () => {
    expect(computeKpis(tasks, TODAY)).toEqual({
      total: 6,
      open: 2,
      overdue: 1,
      completed7d: 3,
      completionRate: 67,
      hoursTracked: 2,
    });
    expect(computeKpis([], TODAY).completionRate).toBe(0);
  });

  it('counts completions per day for 30 days', () => {
    const series = completedPerDay(tasks, TODAY);
    expect(series).toHaveLength(30);
    expect(series[29]).toEqual({ date: TODAY, count: 1 });
    expect(series.reduce((s, d) => s + d.count, 0)).toBe(4);
  });

  it('counts open tasks by priority and finds upcoming deadlines', () => {
    expect(openByPriority(tasks)).toEqual({ low: 0, medium: 0, high: 1, urgent: 1 });
    expect(upcomingDeadlines(tasks, TODAY)).toHaveLength(1);
  });

  it('streak counts consecutive days ending today or yesterday', () => {
    expect(productivityStreak(tasks, TODAY)).toBe(2);
    const fromYesterday = [task({ status: 'done', completedAt: at(addDays(TODAY, -1)) }), task({ status: 'done', completedAt: at(addDays(TODAY, -2)) })];
    expect(productivityStreak(fromYesterday, TODAY)).toBe(2);
    expect(productivityStreak([task({ status: 'done', completedAt: at(addDays(TODAY, -2)) })], TODAY)).toBe(0);
  });
});

describe('validation', () => {
  it('validates the task draft', () => {
    const ok = draftFromTask(null, { title: 'Hello' });
    expect(validateDraft(ok)).toEqual({});
    expect(validateDraft({ ...ok, title: '  ' }).title).toMatch(/required/);
    expect(validateDraft({ ...ok, title: 'x'.repeat(121) }).title).toMatch(/120/);
    expect(validateDraft({ ...ok, description: 'x'.repeat(2001) }).description).toBeDefined();
    expect(validateDraft({ ...ok, tags: 'a,b,c,d,e,f,g,h,i' }).tags).toMatch(/8/);
    expect(validateDraft({ ...ok, estimate: '0' }).estimate).toBeDefined();
    expect(validateDraft({ ...ok, estimate: '1.5' }).estimate).toBeDefined();
    expect(validateDraft({ ...ok, estimate: '45' }).estimate).toBeUndefined();
  });

  it('normalises tags to lowercase unique values', () => {
    expect(parseTags('Bug, bug , Front End,,docs')).toEqual(['bug', 'front-end', 'docs']);
  });

  it('rejects invalid imports with a clear message', () => {
    expect(parseImport('{not json')).toEqual({ ok: false, error: 'The file is not valid JSON.' });
    expect(parseImport('[]')).toMatchObject({ ok: false });
    const good = generateDemoData(5, NOW);
    const bad = structuredClone(good);
    (bad.tasks[2] as unknown as Record<string, unknown>).statusId = 'blocked';
    const res = validateImport(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('tasks[2] has status "blocked"');
    const orphan = structuredClone(good);
    orphan.tasks[0].projectId = 'nope';
    expect(validateImport(orphan).ok).toBe(false);
    expect(validateImport(JSON.parse(JSON.stringify(good)))).toEqual({ ok: true, state: good });
  });
});

describe('undo / redo', () => {
  it('history pushes, undoes and redoes', () => {
    let h = createHistory(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    h = undo(h);
    expect(h.present).toBe(1);
    h = redo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    h = pushHistory(h, 5);
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it('history depth is limited to 50', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 80; i++) h = pushHistory(h, i);
    expect(h.past).toHaveLength(50);
    for (let i = 0; i < 60; i++) h = undo(h);
    expect(h.present).toBe(30);
  });

  it('store undo/redo restores task mutations and persists', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const store = new TaskStore(storage, '?seed=10');
    expect(store.getSnapshot().state.tasks).toHaveLength(10);
    expect(store.initialSeed).toBe(10);
    store.dispatch({ type: 'task/delete', ids: ['t1', 't2'] });
    expect(store.getSnapshot().state.tasks).toHaveLength(8);
    expect(store.getSnapshot().canUndo).toBe(true);
    store.undo();
    expect(store.getSnapshot().state.tasks).toHaveLength(10);
    store.redo();
    expect(store.getSnapshot().state.tasks).toHaveLength(8);
    store.flush();
    expect(JSON.parse(mem.get('taskpilot:v2')!).tasks).toHaveLength(8);
  });
});

describe('reducer', () => {
  it('sets and clears completedAt on status change', () => {
    const t = task();
    let s: Data = emptyData({ tasks: [t] });
    s = dataReducer(s, { type: 'task/update', id: t.id, patch: { statusId: 'done' }, at: '2026-10-15T10:00:00.000Z' });
    expect(s.tasks[0].completedAt).toBe('2026-10-15T10:00:00.000Z');
    s = dataReducer(s, { type: 'task/update', id: t.id, patch: { statusId: 'todo' }, at: '2026-10-15T11:00:00.000Z' });
    expect(s.tasks[0].completedAt).toBeNull();
  });

  it('moves cards between and within columns, renumbering order', () => {
    const cols = [
      task({ id: 'a', status: 'todo', order: 0 }),
      task({ id: 'b', status: 'todo', order: 1 }),
      task({ id: 'c', status: 'todo', order: 2 }),
      task({ id: 'd', status: 'done', order: 0, completedAt: 'x' }),
    ];
    const within = moveTask(cols, 'c', 'todo', 0, 'now');
    expect(within.filter((t) => t.category === 'todo').sort((x, y) => x.order - y.order).map((t) => t.id)).toEqual(['c', 'a', 'b']);
    const across = moveTask(cols, 'a', 'done', 1, 'now');
    const done = across.filter((t) => t.category === 'done').sort((x, y) => x.order - y.order);
    expect(done.map((t) => t.id)).toEqual(['d', 'a']);
    expect(done[1].completedAt).toBe('now');
    expect(moveTask(cols, 'b', 'todo', 1, 'now')).toBe(cols);
  });

  it('deleting a project can unassign or delete its tasks', () => {
    const s: Data = emptyData({
      tasks: [task({ projectId: 'p1' }), task({ projectId: 'p2' })],
      projects: [{ id: 'p1', name: 'A', color: '#000000', createdAt: '', parentId: null, workflow: null }],
    });
    expect(dataReducer(s, { type: 'project/delete', id: 'p1', mode: 'unassign', children: 'lift', at: '2026-10-15T10:00:00.000Z' }).tasks[0].projectId).toBeNull();
    expect(dataReducer(s, { type: 'project/delete', id: 'p1', mode: 'delete', children: 'lift', at: '2026-10-15T10:00:00.000Z' }).tasks).toHaveLength(1);
  });
});

describe('dates', () => {
  it('builds a Monday-first month grid', () => {
    const grid = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(grid[0]).toBe('2026-09-28');
    expect(weekdayMon(grid[0])).toBe(0);
    expect(grid.length % 7).toBe(0);
    expect(grid).toContain('2026-10-31');
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12');
  });
});
