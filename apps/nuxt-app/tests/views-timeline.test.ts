import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Member, Project, SavedView, Task } from '~/lib/types';
import { DEFAULT_QUERY, parseTaskQuery } from '~/lib/filters';
import { boardQueryOf, describeQuery, findMatchingView, ignoredOnBoard, normalizeViewQuery, sameViewQuery, suggestViewName, validateViewName, viewQueryOf } from '~/lib/views';
import { axisTicks, barGeometry, buildTimeline, dependencyLinks, dueAfterDrag, GROUP_HEIGHT, linkPath, ROW_HEIGHT } from '~/lib/timeline';
import { daysBetween } from '~/lib/dates';
import { generateDemoData } from '~/lib/demo';
import { validateImport } from '~/lib/validation';
import { useTaskStore } from '~/stores/tasks';

const NOW = '2026-03-15T12:00:00.000Z';
/** Local-noon timestamp for a calendar day (timezone-safe). */
const at = (day: string): string => new Date(`${day}T12:00:00`).toISOString();

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
    createdAt: at('2026-03-01'),
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

const PROJECTS: Project[] = [
  { id: 'p1', name: 'Website', color: '#6366f1', createdAt: NOW, parentId: null, workflow: null },
  { id: 'p2', name: 'Mobile', color: '#ec4899', createdAt: NOW, parentId: null, workflow: null },
];
const MEMBERS: Member[] = [{ id: 'm1', name: 'Alex Kim', color: '#0ea5e9' }];
const lookups = { projects: new Map(PROJECTS.map((p) => [p.id, p])), members: new Map(MEMBERS.map((m) => [m.id, m])) };

describe('saved views', () => {
  const q = { ...DEFAULT_QUERY, status: ['todo' as const], assignee: 'm1', q: 'login', sort: 'due' as const, dir: 'asc' as const, page: 4 };

  it('stores everything but the page and matches regardless of key order', () => {
    const stored = viewQueryOf(q);
    expect(stored).toEqual({ q: 'login', status: 'todo', assignee: 'm1', sort: 'due', dir: 'asc' });
    expect(sameViewQuery(stored, { dir: 'asc', sort: 'due', assignee: 'm1', status: 'todo', q: 'login', page: '2' })).toBe(true);
    expect(sameViewQuery(stored, { ...stored, tag: 'x' })).toBe(false);
    expect(normalizeViewQuery({ status: 'todo,bogus', sort: 'nope', junk: '1' })).toEqual({ status: 'todo' });
    const views: SavedView[] = [{ id: 'v1', name: 'Mine', query: stored, createdAt: NOW }];
    expect(findMatchingView(views, { ...q, page: 1 })?.id).toBe('v1');
    expect(findMatchingView(views, DEFAULT_QUERY)).toBeUndefined();
  });

  it('maps a view to the board, dropping status and sort', () => {
    expect(boardQueryOf(viewQueryOf(q))).toEqual({ q: 'login', assignee: 'm1' });
    expect(ignoredOnBoard(viewQueryOf(q))).toEqual(['status', 'sort order']);
    expect(ignoredOnBoard({ project: 'p1' })).toEqual([]);
    // the board reads the same parameters as the list
    expect(parseTaskQuery(boardQueryOf(viewQueryOf(q)))).toMatchObject({ q: 'login', assignee: 'm1', status: [] });
  });

  it('describes and names views', () => {
    expect(describeQuery(viewQueryOf(q), lookups)).toBe('“login” · Status: To do · Assignee: Alex Kim · Sort: Due date ↑');
    expect(describeQuery({ project: 'gone' }, lookups)).toBe('Project: deleted project · Sort: Created ↓');
    expect(suggestViewName(viewQueryOf(q), lookups)).toBe('Alex · To do · “login”');
    expect(suggestViewName({}, lookups)).toBe('All tasks');
  });

  it('validates names', () => {
    const views: SavedView[] = [{ id: 'v1', name: 'Mine', query: {}, createdAt: NOW }];
    expect(validateViewName(' ', views)).toMatch(/required/);
    expect(validateViewName('mine', views)).toMatch(/exists/);
    expect(validateViewName('Mine', views, 'v1')).toBe('');
    expect(validateViewName('x'.repeat(61), views)).toMatch(/60/);
  });

  it('imports views (optional for older data) and rejects malformed ones', () => {
    const d = generateDemoData(2);
    const { views: _v, ...old } = d;
    const r = validateImport(old);
    expect(r.ok && r.state.views).toEqual([]);
    const ok = validateImport({ ...d, views: [{ id: 'v', name: 'A', query: { status: 'done', bogus: 'x' }, createdAt: NOW }] });
    expect(ok.ok && ok.state.views[0]?.query).toEqual({ status: 'done' });
    const bad = validateImport({ ...d, views: [{ id: 'v', name: '', query: { a: 1 }, createdAt: 'x' }] });
    expect(bad.ok).toBe(false);
  });
});

describe('task store: saved views', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('creates, renames and deletes views with undo, without touching the activity log', () => {
    const store = useTaskStore();
    store.replaceAll(generateDemoData(3));
    const v = store.createView('  Mine ', { status: 'todo', page: '3' });
    expect(store.views).toEqual([{ id: v.id, name: 'Mine', query: { status: 'todo' }, createdAt: v.createdAt }]);
    store.renameView(v.id, 'Ours');
    expect(store.views[0]?.name).toBe('Ours');
    store.deleteView(v.id);
    expect(store.views).toEqual([]);
    store.undo();
    expect(store.views[0]?.name).toBe('Ours');
    expect(store.activity).toEqual([]);
    expect(store.serialize().views).toHaveLength(1);
  });
});

describe('timeline', () => {
  const TODAY = '2026-03-15';
  const tasks = [
    task('a', { projectId: 'p2', createdAt: at('2026-03-05'), dueDate: '2026-03-20' }),
    task('b', { projectId: 'p1', createdAt: at('2026-03-02'), dueDate: '2026-03-10', status: 'done' }),
    task('c', { projectId: 'p1', createdAt: at('2026-03-01'), dueDate: '2026-03-12', blockedBy: ['b'] }),
    task('d', { createdAt: at('2026-03-10'), dueDate: '2026-03-04' }), // due before it was created
    task('e', { projectId: 'p1' }), // no due date
  ];

  it('groups dated tasks by project (project order, then no project), sorted by start', () => {
    const m = buildTimeline(tasks, PROJECTS, { today: TODAY });
    expect(m.rows.map((r) => (r.kind === 'group' ? `[${r.key}:${r.count}]` : r.task.id))).toEqual(['[p1:2]', 'c', 'b', '[p2:1]', 'a', '[none:1]', 'd']);
    expect(m.undated.map((t) => t.id)).toEqual(['e']);
    expect(m.height).toBe(3 * GROUP_HEIGHT + 4 * ROW_HEIGHT);
    expect(m.datedCount).toBe(4);
    // range starts on a Monday at least 3 days before the earliest date and covers today
    expect(new Date(`${m.rangeStart}T12:00:00`).getDay()).toBe(1);
    expect(daysBetween(m.rangeStart, '2026-03-01')).toBeGreaterThanOrEqual(3);
    expect(daysBetween(m.rangeStart, TODAY)).toBeLessThan(m.days);
  });

  it('collapses groups without changing the date range, and can hide done tasks', () => {
    const full = buildTimeline(tasks, PROJECTS, { today: TODAY });
    const col = buildTimeline(tasks, PROJECTS, { today: TODAY, collapsed: new Set(['p1']) });
    expect(col.rows.map((r) => (r.kind === 'group' ? `[${r.key}${r.collapsed ? '-' : '+'}]` : r.task.id))).toEqual(['[p1-]', '[p2+]', 'a', '[none+]', 'd']);
    expect([col.rangeStart, col.days]).toEqual([full.rangeStart, full.days]);
    expect(buildTimeline(tasks, PROJECTS, { today: TODAY, hideDone: true }).rows.some((r) => r.kind === 'task' && r.task.id === 'b')).toBe(false);
  });

  it('computes bar geometry, including due dates before the start', () => {
    expect(barGeometry('2026-03-02', '2026-03-04', '2026-03-02', 10)).toEqual({ x: 0, width: 30, inverted: false, dueX: 30 });
    expect(barGeometry('2026-03-05', '2026-03-03', '2026-03-02', 10)).toEqual({ x: 10, width: 30, inverted: true, dueX: 10 });
    expect(dueAfterDrag('2026-03-10', 44, 14)).toBe('2026-03-13');
    expect(dueAfterDrag('2026-03-10', -6, 14)).toBe('2026-03-10');
    expect(dueAfterDrag('2026-03-31', 14, 14)).toBe('2026-04-01');
  });

  it('builds axis ticks per zoom level', () => {
    const week = axisTicks('2026-02-23', 14, 'week');
    expect(week.ticks).toHaveLength(14);
    expect(week.ticks[0]?.label).toBe('M 23');
    expect(week.months.map((m) => [m.day, m.label])).toEqual([
      [0, 'February 2026'],
      [6, 'March 2026'],
    ]);
    expect(axisTicks('2026-02-23', 14, 'month').ticks.map((t) => t.label)).toEqual(['23', '2']);
    expect(axisTicks('2026-02-23', 14, 'quarter').months[1]?.label).toBe('Mar 2026');
  });

  it('links blockers to blocked tasks when both rows are visible', () => {
    const m = buildTimeline(tasks, PROJECTS, { today: TODAY });
    expect(dependencyLinks(m.rows).map((l) => `${l.from.task.id}>${l.to.task.id}`)).toEqual(['b>c']);
    expect(dependencyLinks(buildTimeline(tasks, PROJECTS, { today: TODAY, hideDone: true }).rows)).toEqual([]);
    expect(linkPath(10, 15, 100, 45)).toBe('M10,15 H18 V45 H100');
    expect(linkPath(100, 15, 40, 45)).toBe('M100,15 H108 V30 H32 V45 H40');
  });

  it('changing a due date through the store is a single undoable, logged change', () => {
    setActivePinia(createPinia());
    const store = useTaskStore();
    store.replaceAll({ ...generateDemoData(0), tasks: [task('a', { dueDate: '2026-03-20' })] });
    store.updateTask('a', { dueDate: '2026-03-25' });
    expect(store.activity.at(-1)).toMatchObject({ field: 'dueDate', from: '2026-03-20', to: '2026-03-25' });
    store.undo();
    expect(store.taskById.get('a')?.dueDate).toBe('2026-03-20');
    expect(store.activity).toEqual([]);
  });
});
