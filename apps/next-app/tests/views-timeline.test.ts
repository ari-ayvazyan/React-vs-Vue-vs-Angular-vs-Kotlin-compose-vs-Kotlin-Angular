import { describe, expect, it } from 'vitest';
import { generateDemoData } from '../lib/demo';
import { DEFAULT_QUERY, filterTasks, type TaskQuery } from '../lib/filters';
import { dataReducer, type Data } from '../lib/reducer';
import { TaskStore } from '../lib/store';
import {
  NO_GROUP,
  dayX,
  dependencyEdges,
  draggedDue,
  groupTimeline,
  monthBands,
  taskSpan,
  timelineRange,
  timelineTicks,
} from '../lib/timeline';
import type { SavedView } from '../lib/types';
import { validateImport } from '../lib/validation';
import { boardQuery, boardSearch, describeQuery, matchingView, normalizeSearch, validateViewName, viewQuery, viewSearch } from '../lib/views';
import { emptyData, task } from './fixtures';

const q = (p: Partial<TaskQuery>): TaskQuery => ({ ...DEFAULT_QUERY, ...p });
const view = (p: Partial<SavedView>): SavedView => ({ id: 'v1', name: 'Mine', search: '', createdAt: '2026-10-01T00:00:00.000Z', ...p });
const created = (key: string) => new Date(`${key}T12:00:00`).toISOString();

describe('saved views', () => {
  it('stores the query without the page and restores it', () => {
    const query = q({ q: 'login', status: ['todo', 'in_progress'], assignee: 'm1', sort: 'due', dir: 'asc', page: 4 });
    const s = viewSearch(query);
    expect(s).toBe('?q=login&status=todo%2Cin_progress&assignee=m1&sort=due&dir=asc');
    expect(viewQuery(view({ search: s }))).toEqual({ ...query, page: 1 });
    expect(viewSearch(DEFAULT_QUERY)).toBe('');
  });

  it('normalises stored searches (drops unknown params, defaults and page)', () => {
    expect(normalizeSearch('?page=3&status=bogus,done&foo=1&sort=created&dir=desc')).toBe('?status=done');
    expect(normalizeSearch('')).toBe('');
  });

  it('finds the view matching the current query regardless of page', () => {
    const views = [view({ id: 'a', search: '?status=done' }), view({ id: 'b', search: '?assignee=m2' })];
    expect(matchingView(views, q({ assignee: 'm2', page: 3 }))?.id).toBe('b');
    expect(matchingView(views, q({ assignee: 'm2', tag: 'x' }))).toBeUndefined();
  });

  it('validates view names', () => {
    const views = [view({ name: 'My open work' })];
    expect(validateViewName(' ', views)).toMatch(/required/);
    expect(validateViewName('x'.repeat(41), views)).toMatch(/40/);
    expect(validateViewName('my OPEN work', views)).toMatch(/exists/);
    expect(validateViewName('My open work', views, 'v1')).toBeNull();
  });

  it('keeps only board-relevant filters when opening on the board', () => {
    const query = q({ q: 'api', status: ['todo'], priority: ['high'], project: 'p1', assignee: 'm1', tag: 'bug', due: 'week', sort: 'title', dir: 'asc', page: 2 });
    expect(boardQuery(query)).toEqual(q({ q: 'api', priority: ['high'], project: 'p1', assignee: 'm1', tag: 'bug', due: 'week' }));
    expect(boardSearch(query)).toBe('?q=api&priority=high&project=p1&assignee=m1&tag=bug&due=week');
    const tasks = [task({ priority: 'high', projectId: 'p1', status: 'done', title: 'api' }), task({ priority: 'low' })];
    expect(filterTasks(tasks, boardQuery(q({ priority: ['high'], status: ['todo'] })), '2026-10-15')).toHaveLength(1);
  });

  it('describes a query for the view list', () => {
    const names = { project: () => 'Web', member: () => 'Alex Kim', status: (s: string) => s, priority: (p: string) => p, due: (d: string) => d, sort: (k: string) => k };
    expect(describeQuery(DEFAULT_QUERY, names)).toBe('All tasks');
    expect(describeQuery(q({ q: 'x', project: 'p1', assignee: 'm1', tag: 'bug', sort: 'due', dir: 'asc' }), names)).toBe('“x” · Web · Alex Kim · #bug · sorted by due ↑');
  });

  it('reducer: create, rename, update query, delete; no-op updates keep identity', () => {
    let s: Data = emptyData();
    s = dataReducer(s, { type: 'view/create', view: view({}) });
    s = dataReducer(s, { type: 'view/update', id: 'v1', patch: { name: 'Renamed' } });
    expect(s.views[0].name).toBe('Renamed');
    expect(dataReducer(s, { type: 'view/update', id: 'v1', patch: { name: 'Renamed' } })).toBe(s);
    expect(dataReducer(s, { type: 'view/delete', id: 'nope' })).toBe(s);
    expect(dataReducer(s, { type: 'view/delete', id: 'v1' }).views).toEqual([]);
  });

  it('view changes are undoable and do not touch the activity log', () => {
    const mem = new Map<string, string>();
    const store = new TaskStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) }, '?seed=5');
    store.dispatch({ type: 'view/create', view: view({ search: '?status=todo' }) });
    expect(store.getSnapshot().state.views).toHaveLength(1);
    expect(store.getSnapshot().state.activity).toEqual([]);
    store.undo();
    expect(store.getSnapshot().state.views).toEqual([]);
  });

  it('import: views are optional, normalised, and need unique ids', () => {
    const good = generateDemoData(2);
    const withViews = { ...good, views: [view({ search: '?page=2&assignee=m1' })] };
    const res = validateImport(withViews);
    expect(res.ok && res.state.views[0].search).toBe('?assignee=m1');
    expect(validateImport({ ...good, views: [view({}), view({})] }).ok).toBe(false);
    expect(validateImport({ ...good, views: [view({ name: ' ' })] }).ok).toBe(false);
  });
});

describe('timeline', () => {
  it('spans from creation day to due date; inverted spans collapse to the due day', () => {
    expect(taskSpan({ createdAt: created('2026-10-01'), dueDate: '2026-10-10' })).toEqual({ start: '2026-10-01', end: '2026-10-10', inverted: false });
    expect(taskSpan({ createdAt: created('2026-10-10'), dueDate: '2026-10-01' })).toEqual({ start: '2026-10-01', end: '2026-10-01', inverted: true });
    expect(taskSpan({ createdAt: created('2026-10-10'), dueDate: null })).toBeNull();
  });

  it('pads and aligns the range per zoom level, always including today', () => {
    const spans = [{ start: '2026-10-07', end: '2026-10-20', inverted: false }];
    const week = timelineRange(spans, '2026-10-15', 'week');
    expect(week).toEqual({ start: '2026-10-05', end: '2026-10-25', days: 21 });
    const month = timelineRange(spans, '2026-12-02', 'month');
    expect(month.start).toBe('2026-10-01');
    expect(month.end).toBe('2026-12-31');
    expect(timelineRange([], '2026-10-15', 'quarter')).toEqual({ start: '2026-10-01', end: '2026-10-31', days: 31 });
  });

  it('builds header ticks for each zoom', () => {
    const range = { start: '2026-09-28', end: '2026-11-01', days: 35 };
    const week = timelineTicks(range, 'week');
    expect(week).toHaveLength(35);
    expect(week[0]).toEqual({ date: '2026-09-28', label: 'M 28', major: true });
    const month = timelineTicks(range, 'month');
    expect(month.map((t) => t.label)).toEqual(['Sep 28', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26']);
    expect(month.map((t) => t.major)).toEqual([false, true, false, false, false]);
    const quarter = timelineTicks(range, 'quarter');
    expect(quarter.filter((t) => t.major).map((t) => t.label)).toEqual(['Oct 2026', 'Nov 2026']);
    expect(monthBands(range)).toEqual([
      { start: '2026-09-28', days: 3, label: 'September 2026' },
      { start: '2026-10-01', days: 31, label: 'October 2026' },
      { start: '2026-11-01', days: 1, label: 'November 2026' },
    ]);
  });

  it('groups dated tasks by project and lists undated tasks separately', () => {
    const projects = [
      { id: 'p1', name: 'Web', color: '#000000', createdAt: '', parentId: null, workflow: null },
      { id: 'p2', name: 'Empty', color: '#111111', createdAt: '', parentId: null, workflow: null },
    ];
    const tasks = [
      task({ id: 'b', projectId: 'p1', createdAt: created('2026-10-05'), dueDate: '2026-10-09' }),
      task({ id: 'a', projectId: 'p1', createdAt: created('2026-10-01'), dueDate: '2026-10-20' }),
      task({ id: 'c', projectId: null, createdAt: created('2026-10-02'), dueDate: '2026-10-03' }),
      task({ id: 'd', projectId: 'p1', dueDate: null }),
    ];
    const { groups, undated } = groupTimeline(tasks, projects);
    expect(groups.map((g) => g.id)).toEqual(['p1', NO_GROUP]);
    expect(groups[0].tasks.map((x) => x.task.id)).toEqual(['a', 'b']);
    expect(groups[0].span).toEqual({ start: '2026-10-01', end: '2026-10-20', inverted: false });
    expect(undated.map((t) => t.id)).toEqual(['d']);
  });

  it('maps days to pixels and drags the due date by whole days, never before the start', () => {
    const range = { start: '2026-10-01', end: '2026-10-31', days: 31 };
    expect(dayX(range, '2026-10-11', 16)).toBe(160);
    const span = { start: '2026-10-05', end: '2026-10-10', inverted: false };
    expect(draggedDue(span, 0, 16)).toBe('2026-10-10');
    expect(draggedDue(span, 39, 16)).toBe('2026-10-12');
    expect(draggedDue(span, -7, 16)).toBe('2026-10-10');
    expect(draggedDue(span, -9, 16)).toBe('2026-10-09');
    expect(draggedDue(span, -500, 16)).toBe('2026-10-05');
  });

  it('collects dependency edges between shown tasks only', () => {
    const tasks = [task({ id: 'x' }), task({ id: 'y', blockedBy: ['x', 'hidden'] })];
    expect(dependencyEdges(tasks, new Set(['x', 'y']))).toEqual([{ from: 'x', to: 'y' }]);
    expect(dependencyEdges(tasks, new Set(['y']))).toEqual([]);
  });

  it('handles 1000 demo tasks quickly', () => {
    const d = generateDemoData(1000);
    const t0 = performance.now();
    const { groups, undated } = groupTimeline(d.tasks, d.projects);
    const range = timelineRange(groups.flatMap((g) => g.tasks.map((x) => x.span)), '2026-10-15', 'week');
    timelineTicks(range, 'week');
    expect(performance.now() - t0).toBeLessThan(200);
    expect(groups.reduce((s, g) => s + g.tasks.length, 0) + undated.length).toBe(1000);
  });
});
