import { Project, SavedView, Task } from './models';
import { DEFAULT_QUERY, parseQuery } from './filters';
import {
  boardParams,
  boardQuery,
  findView,
  normalizeParams,
  sameParams,
  validateViewName,
  viewParams,
} from './views';
import {
  axisTicks,
  buildTimeline,
  dayOffset,
  flattenRows,
  shiftDueDate,
  timelineRange,
  visibleWindow,
} from './timeline';
import { generateDemoData } from './demo-data';
import { validateAppState } from './validation';

const NOW = new Date(2026, 5, 15, 12); // Mon 15 Jun 2026
const iso = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();

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

const view = (id: string, name: string, params: Record<string, string>): SavedView => ({
  id,
  name,
  params,
  createdAt: NOW.toISOString(),
});

describe('saved views', () => {
  it('stores the list query without the page and matches it back', () => {
    const q = parseQuery({ priority: 'high,urgent', project: 'p1', sort: 'due', page: '3' });
    const params = viewParams(q);
    expect(params).toEqual({ priority: 'high,urgent', project: 'p1', sort: 'due' });
    const views = [view('v1', 'Other', { tag: 'bug' }), view('v2', 'Hot', params)];
    expect(findView(views, q)?.id).toBe('v2');
    expect(findView(views, { ...q, page: 1 })?.id).toBe('v2');
    expect(findView(views, { ...q, sort: 'title' })).toBeUndefined();
    expect(findView(views, DEFAULT_QUERY)).toBeUndefined();
    expect(sameParams({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
  });

  it('normalises stored params (unknown keys and invalid values are dropped)', () => {
    expect(normalizeParams({ due: 'someday', status: 'todo,bogus', junk: 'x', q: 'api' })).toEqual({
      status: 'todo',
      q: 'api',
    });
  });

  it('maps a view to the filters that make sense on the board', () => {
    const params = {
      q: 'login',
      status: 'todo',
      priority: 'high',
      project: 'p2',
      assignee: 'm1',
      tag: 'bug',
      due: 'overdue',
      sort: 'title',
      dir: 'asc',
    };
    expect(boardParams(params)).toEqual({
      q: 'login',
      priority: 'high',
      project: 'p2',
      assignee: 'm1',
      tag: 'bug',
      due: 'overdue',
    });
    const bq = boardQuery(params);
    expect(bq.status).toEqual([]);
    expect(bq.sort).toBe(DEFAULT_QUERY.sort);
    expect(bq.priority).toEqual(['high']);
  });

  it('validates view names', () => {
    const views = [view('v1', 'My bugs', {})];
    expect(validateViewName(' ', views)).toMatch(/required/);
    expect(validateViewName('my BUGS', views)).toMatch(/exists/);
    expect(validateViewName('my BUGS', views, 'v1')).toBe('');
    expect(validateViewName('x'.repeat(61), views)).toMatch(/60/);
  });

  it('import validation accepts views and defaults them for older data', () => {
    const s = generateDemoData(3, NOW);
    expect(validateAppState({ ...s, views: [view('v1', 'A', { tag: 'bug' })] }).ok).toBe(true);
    const legacy = { ...s } as Partial<typeof s>;
    delete legacy.views;
    const r = validateAppState(legacy);
    expect(r.ok && r.state.views).toEqual([]);
    expect(validateAppState({ ...s, views: [{ id: 'v', name: 'A', params: { a: 1 } }] }).ok).toBe(
      false,
    );
  });
});

describe('timeline', () => {
  const projects: Project[] = [
    {
      id: 'p1',
      name: 'Website',
      color: '#6366f1',
      createdAt: NOW.toISOString(),
      parentId: null,
      workflow: null,
    },
    {
      id: 'p2',
      name: 'Empty',
      color: '#ec4899',
      createdAt: NOW.toISOString(),
      parentId: null,
      workflow: null,
    },
  ];
  const tasks = [
    task('a', { projectId: 'p1', createdAt: iso(2026, 6, 10), dueDate: '2026-06-20' }),
    task('b', { projectId: 'p1', createdAt: iso(2026, 6, 1), dueDate: '2026-06-12' }),
    task('c', { createdAt: iso(2026, 6, 14), dueDate: '2026-06-05' }), // due before creation
    task('d', { projectId: 'p1' }), // no due date
    task('e', {
      projectId: 'gone',
      status: 'done',
      createdAt: iso(2026, 6, 2),
      dueDate: '2026-06-03',
    }),
  ];

  it('groups dated tasks by project, sorted by start; lists undated tasks separately', () => {
    const { groups, undated } = buildTimeline(tasks, projects);
    expect(groups.map((g) => [g.id, g.items.map((i) => i.task.id)])).toEqual([
      ['p1', ['b', 'a']],
      ['none', ['e', 'c']],
    ]);
    expect(undated.map((t) => t.id)).toEqual(['d']);
    const c = groups[1].items.find((i) => i.task.id === 'c')!;
    expect([c.start, c.end]).toEqual(['2026-06-05', '2026-06-05']);
    expect(buildTimeline(tasks, projects, { hideDone: true }).groups[1].items).toHaveLength(1);
  });

  it('computes an aligned, padded range that includes today', () => {
    const { groups } = buildTimeline(tasks, projects);
    const month = timelineRange(groups, '2026-06-15', 'month');
    // min 2026-06-01 - 7 = May 25 (a Monday); max Jun 20 + 7 = Jun 27 → week ends Sun Jun 28
    expect(month).toEqual({ start: '2026-05-25', days: 35 });
    const quarter = timelineRange(groups, '2026-06-15', 'quarter');
    expect(quarter.start).toBe('2026-05-01');
    expect(quarter.days).toBe(31 + 30 + 31);
    expect(dayOffset(month, '2026-06-15')).toBe(21);
    // far-away dates are clamped to ±730 days around today
    const far = buildTimeline([task('z', { dueDate: '2040-01-01' })], projects).groups;
    expect(timelineRange(far, '2026-06-15', 'quarter').days).toBeLessThan(800);
  });

  it('builds axis ticks per zoom level', () => {
    const range = { start: '2026-05-25', days: 35 };
    const week = axisTicks(range, 'week');
    expect(week).toHaveLength(35);
    expect(week[0]).toMatchObject({ label: 'M 25', major: true });
    const month = axisTicks(range, 'month');
    expect(month.map((t) => t.label)).toEqual(['May 25', 'Jun 1', 'Jun 8', 'Jun 15', 'Jun 22']);
    const q = axisTicks({ start: '2026-11-01', days: 92 }, 'quarter');
    expect(q.map((t) => t.label)).toEqual(['Nov 2026', 'Dec', 'Jan 2027']);
  });

  it('flattens groups into rows, honouring collapsed groups', () => {
    const { groups } = buildTimeline(tasks, projects);
    expect(flattenRows(groups, new Set()).map((r) => r.kind)).toEqual([
      'group',
      'task',
      'task',
      'group',
      'task',
      'task',
    ]);
    const rows = flattenRows(groups, new Set(['p1']));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ kind: 'group', collapsed: true });
  });

  it('computes the rendered window with overscan', () => {
    expect(visibleWindow(0, 340, 34, 1000, 5)).toEqual({ first: 0, last: 15 });
    expect(visibleWindow(3400, 340, 34, 1000, 5)).toEqual({ first: 95, last: 115 });
    expect(visibleWindow(33800, 340, 34, 1000, 5)).toEqual({ first: 989, last: 1000 });
    expect(visibleWindow(0, 340, 34, 3, 5)).toEqual({ first: 0, last: 3 });
  });

  it('shifts the due date by whole days, never before the bar start', () => {
    expect(shiftDueDate('2026-06-20', 3.4, '2026-06-10')).toBe('2026-06-23');
    expect(shiftDueDate('2026-06-20', -2.6, '2026-06-10')).toBe('2026-06-17');
    expect(shiftDueDate('2026-06-20', -30, '2026-06-10')).toBe('2026-06-10');
    expect(shiftDueDate('2026-02-27', 3, '2026-02-01')).toBe('2026-03-02');
  });
});
