import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Project, Task, WorkflowStatus } from '~/lib/types';
import { DEFAULT_WORKFLOW, normalizeTasks, validateWorkflow, workflowResolver } from '~/lib/workflows';
import { deleteProjectPlan, descendantIds, hasParentCycle, makeProjectScope, projectOptions, projectTree, validateParent } from '~/lib/projects';
import { boardColumns, columnKeyOf, groupByColumn, statusForColumn } from '~/lib/board';
import { DEFAULT_QUERY, filterTasks } from '~/lib/filters';
import { burndown, projectProgress } from '~/lib/stats';
import { generateDemoData } from '~/lib/demo';
import { validateImport } from '~/lib/validation';
import { useTaskStore } from '~/stores/tasks';

const NOW = '2026-03-15T12:00:00.000Z';
const TODAY = '2026-03-15';

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    statusId: over.statusId ?? over.status ?? 'todo',
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
    ...over,
  };
}

const KANBAN: WorkflowStatus[] = [
  { id: 'backlog', name: 'Backlog', color: '#64748b', category: 'todo' },
  { id: 'ready', name: 'Ready', color: '#0891b2', category: 'todo' },
  { id: 'doing', name: 'Doing', color: '#2563eb', category: 'in_progress' },
  { id: 'review', name: 'Review', color: '#7c3aed', category: 'in_progress' },
  { id: 'shipped', name: 'Shipped', color: '#059669', category: 'done' },
];

const project = (id: string, over: Partial<Project> = {}): Project => ({ id, name: id.toUpperCase(), color: '#6366f1', createdAt: NOW, parentId: null, workflow: null, ...over });
// web (custom workflow) ─ docs (inherits) ─ api (inherits)
//                       └ mobile (own default copy)
// ops (default)
const PROJECTS = [
  project('web', { workflow: KANBAN }),
  project('docs', { parentId: 'web' }),
  project('api', { parentId: 'docs' }),
  project('mobile', { parentId: 'web', workflow: DEFAULT_WORKFLOW.map((s) => ({ ...s })) }),
  project('ops'),
];

describe('workflows', () => {
  const wf = workflowResolver(PROJECTS);

  it('inherits the nearest ancestor workflow, else the default', () => {
    expect(wf.workflowOf('api').map((s) => s.id)).toEqual(KANBAN.map((s) => s.id));
    expect(wf.sourceOf('api')).toBe('web');
    expect(wf.workflowOf('mobile').map((s) => s.id)).toEqual(['todo', 'in_progress', 'done']);
    expect(wf.workflowOf('ops')).toBe(DEFAULT_WORKFLOW);
    expect(wf.workflowOf(null)).toBe(DEFAULT_WORKFLOW);
    expect(wf.firstOfCategory('docs', 'in_progress').id).toBe('doing');
    expect(wf.resolve('docs', 'review').id).toBe('review');
    expect(wf.resolve('docs', 'done').id).toBe('shipped'); // category name → first status of it
    expect(wf.resolve('docs', 'nope').id).toBe('backlog');
    expect(wf.resolve('docs', 'nope', 'done').id).toBe('shipped');
  });

  it('validates workflows', () => {
    expect(validateWorkflow(KANBAN)).toBe('');
    expect(validateWorkflow([])).toMatch(/at least one status/);
    expect(validateWorkflow(KANBAN.filter((s) => s.category !== 'done'))).toMatch(/Done/);
    expect(validateWorkflow(KANBAN.filter((s) => s.category !== 'todo'))).toMatch(/To do/);
    expect(validateWorkflow([...KANBAN, { ...KANBAN[0]!, id: 'x' }])).toMatch(/already a status called/);
    expect(validateWorkflow([...KANBAN, { ...KANBAN[0]!, name: 'Other' }])).toMatch(/Duplicate status id/);
    expect(validateWorkflow([{ ...KANBAN[0]!, color: 'red' }, KANBAN[4]!])).toMatch(/hex colour/);
  });

  it('normalizes task statuses, categories and completedAt (keeping identity when valid)', () => {
    const ok = task('ok', { projectId: 'docs', statusId: 'review', status: 'in_progress' });
    const tasks = [
      ok,
      task('moved', { projectId: 'docs', statusId: 'in_progress', status: 'in_progress' }), // default id in a custom workflow
      task('done', { projectId: 'api', statusId: 'shipped', status: 'todo' }), // stale category
      task('back', { projectId: 'ops', statusId: 'review', status: 'in_progress' }),
    ];
    const out = normalizeTasks(tasks, PROJECTS, NOW);
    expect(out[0]).toBe(ok);
    expect(out[1]).toMatchObject({ statusId: 'doing', status: 'in_progress' });
    expect(out[2]).toMatchObject({ statusId: 'shipped', status: 'done', completedAt: NOW });
    expect(out[3]).toMatchObject({ statusId: 'in_progress', status: 'in_progress', completedAt: null });
    expect(normalizeTasks([ok], PROJECTS, NOW)).toEqual([ok]);
  });
});

describe('sub-projects', () => {
  it('builds the tree with paths and indented options', () => {
    expect(projectTree(PROJECTS).map((n) => [n.project.id, n.depth, n.path])).toEqual([
      ['web', 0, 'WEB'],
      ['docs', 1, 'WEB / DOCS'],
      ['api', 2, 'WEB / DOCS / API'],
      ['mobile', 1, 'WEB / MOBILE'],
      ['ops', 0, 'OPS'],
    ]);
    expect(projectOptions(PROJECTS)[2]?.label).toBe('      ↳ API');
    expect([...descendantIds(PROJECTS, 'web')].sort()).toEqual(['api', 'docs', 'mobile', 'web']);
  });

  it('rejects parent cycles', () => {
    expect(validateParent(PROJECTS, 'web', 'api')).toMatch(/own sub-projects/);
    expect(validateParent(PROJECTS, 'web', 'web')).toMatch(/own parent/);
    expect(validateParent(PROJECTS, 'ops', 'api')).toBe('');
    expect(validateParent(PROJECTS, 'ops', null)).toBe('');
    expect(hasParentCycle(PROJECTS)).toBe(false);
    expect(hasParentCycle([project('a', { parentId: 'b' }), project('b', { parentId: 'a' })])).toBe(true);
  });

  it('includes sub-projects in filters, progress and burndown', () => {
    const tasks = [
      task('1', { projectId: 'web' }),
      task('2', { projectId: 'api', statusId: 'shipped', status: 'done', completedAt: NOW }),
      task('3', { projectId: 'mobile' }),
      task('4', { projectId: 'ops' }),
    ];
    const scope = makeProjectScope(PROJECTS);
    const ids = (project: string): string[] => filterTasks(tasks, { ...DEFAULT_QUERY, project }, TODAY, scope).map((t) => t.id);
    expect(ids('web')).toEqual(['1', '2', '3']);
    expect(ids('docs')).toEqual(['2']);
    expect(ids('none')).toEqual([]);
    expect(filterTasks(tasks, { ...DEFAULT_QUERY, project: 'web' }, TODAY).map((t) => t.id)).toEqual(['1']); // no scope → exact
    const prog = Object.fromEntries(projectProgress(PROJECTS, tasks).map((p) => [p.project.id, [p.total, p.done]]));
    expect(prog).toEqual({ web: [3, 1], docs: [1, 1], api: [1, 1], mobile: [1, 0], ops: [1, 0] });
    expect(burndown(tasks, TODAY, 'web', 5, scope).at(-1)?.count).toBe(2);
  });

  it('deletes a project lifting or deleting its sub-projects', () => {
    const tasks = [task('1', { projectId: 'web' }), task('2', { projectId: 'docs', statusId: 'review', status: 'in_progress' }), task('3', { projectId: 'api' })];
    const lift = deleteProjectPlan(PROJECTS, tasks, 'web', 'lift', 'unassign');
    expect(lift.projects.map((p) => [p.id, p.parentId])).toEqual([
      ['docs', null],
      ['api', 'docs'],
      ['mobile', null],
      ['ops', null],
    ]);
    // docs inherited web's workflow → gets its own copy so "Review" survives; mobile keeps its own
    expect(lift.projects.find((p) => p.id === 'docs')?.workflow?.map((s) => s.id)).toEqual(KANBAN.map((s) => s.id));
    expect(lift.tasks.map((t) => t.projectId)).toEqual([null, 'docs', 'api']);
    const del = deleteProjectPlan(PROJECTS, tasks, 'docs', 'delete', 'delete');
    expect(del.projects.map((p) => p.id)).toEqual(['web', 'mobile', 'ops']);
    expect(del.tasks.map((t) => t.id)).toEqual(['1']);
    expect([...del.deletedTaskIds]).toEqual(['2', '3']);
  });
});

describe('board columns with workflows', () => {
  const wf = workflowResolver(PROJECTS);
  const tasks = [
    task('a', { projectId: 'web', statusId: 'ready', order: 2 }),
    task('b', { projectId: 'web', statusId: 'backlog', order: 1 }),
    task('c', { projectId: 'mobile', statusId: 'in_progress', status: 'in_progress', order: 0 }), // other workflow
    task('d', { projectId: 'ops', statusId: 'done', status: 'done', completedAt: NOW }),
  ];

  it('shows the project workflow as columns, mapping foreign statuses by category', () => {
    const { mode, columns } = boardColumns('web', wf);
    expect(mode).toBe('workflow');
    expect(columns.map((c) => c.key)).toEqual(['backlog', 'ready', 'doing', 'review', 'shipped']);
    expect(columnKeyOf(tasks[2]!, mode, columns)).toBe('doing');
    const groups = groupByColumn(tasks.slice(0, 3), mode, columns);
    expect(groups.backlog?.map((t) => t.id)).toEqual(['b']);
    expect(groups.doing?.map((t) => t.id)).toEqual(['c']);
    // dropping the mobile task on "Review" gives it its own workflow's first in-progress status
    expect(statusForColumn(tasks[2]!, columns[3]!, mode, wf).id).toBe('in_progress');
    expect(statusForColumn(tasks[0]!, columns[4]!, mode, wf).id).toBe('shipped');
  });

  it('shows the three categories for all projects', () => {
    const { mode, columns } = boardColumns(null, wf);
    expect(mode).toBe('category');
    expect(columns.map((c) => c.key)).toEqual(['todo', 'in_progress', 'done']);
    expect(columnKeyOf(tasks[0]!, mode, columns)).toBe('todo');
    // staying in the same category keeps the status; another category → first status of it
    expect(statusForColumn(tasks[0]!, columns[0]!, mode, wf).id).toBe('ready');
    expect(statusForColumn(tasks[0]!, columns[1]!, mode, wf).id).toBe('doing');
  });
});

describe('schema v2 import and v1 migration', () => {
  it('migrates v1 exports (no statusId, no parent/workflow, no schemaVersion)', () => {
    const v2 = generateDemoData(5);
    const v1 = {
      // a real v1 file: none of the later task fields
      tasks: v2.tasks.map(({ statusId: _s, assigneeId: _a, recurrence: _r, blockedBy: _b, comments: _c, ...t }) => t),
      projects: v2.projects.map(({ parentId: _p, workflow: _w, ...p }) => p),
      settings: { theme: 'light', pomodoroMinutes: 25, pageSize: 25 },
    };
    const r = validateImport(JSON.stringify(v1));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.tasks.map((t) => [t.statusId, t.status])).toEqual(v2.tasks.map((t) => [t.status, t.status]));
      expect(r.state.projects.every((p) => p.parentId === null && p.workflow === null)).toBe(true);
    }
  });

  it('round-trips custom workflows and rejects invalid v2 data', () => {
    const d = generateDemoData(3);
    const projects = [{ ...d.projects[0]!, workflow: KANBAN }, { ...d.projects[1]!, parentId: d.projects[0]!.id }, ...d.projects.slice(2)];
    const tasks = d.tasks.map((t) => ({ ...t, projectId: projects[1]!.id, statusId: 'review', status: 'in_progress' as const, completedAt: null }));
    const ok = validateImport(JSON.stringify({ schemaVersion: 2, ...d, projects, tasks }));
    expect(ok.ok && ok.state.tasks.map((t) => t.statusId)).toEqual(['review', 'review', 'review']);
    const bad = (over: object): string => {
      const r = validateImport({ ...d, ...over });
      return r.ok ? '' : r.errors.join(' | ');
    };
    expect(bad({ schemaVersion: 3 })).toMatch(/newer version/);
    expect(bad({ projects: [{ ...d.projects[0]!, parentId: d.projects[1]!.id }, { ...d.projects[1]!, parentId: d.projects[0]!.id }, ...d.projects.slice(2)] })).toMatch(/cycle/);
    expect(bad({ projects: [{ ...d.projects[0]!, parentId: 'ghost' }, ...d.projects.slice(1)] })).toMatch(/parentId/);
    expect(bad({ projects: [{ ...d.projects[0]!, workflow: [KANBAN[0]] }, ...d.projects.slice(1)] })).toMatch(/workflow is invalid: .*Done/);
    expect(bad({ tasks: [{ ...d.tasks[0]!, statusId: 'review' }] })).toMatch(/statusId “review” is not a status/);
  });
});

describe('task store: workflows and sub-projects', () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    setActivePinia(createPinia());
    storage.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  function seeded(): ReturnType<typeof useTaskStore> {
    const store = useTaskStore();
    store.replaceAll({
      ...generateDemoData(0),
      projects: PROJECTS.map((p) => ({ ...p, workflow: p.workflow ? p.workflow.map((s) => ({ ...s })) : null })),
      tasks: [
        task('a', { projectId: 'docs', statusId: 'ready' }),
        task('b', { projectId: 'docs', statusId: 'review', status: 'in_progress' }),
        task('r', { projectId: 'api', statusId: 'doing', status: 'in_progress', recurrence: 'weekly', dueDate: '2026-03-10' }),
        task('o', { projectId: 'ops' }),
      ],
    });
    return store;
  }

  it('uses each task’s workflow for category moves, board moves and recurrence', () => {
    const store = seeded();
    expect(store.setStatus(['a', 'o'], 'in_progress')).toBe(2);
    expect(store.taskById.get('a')).toMatchObject({ statusId: 'doing', status: 'in_progress' });
    expect(store.taskById.get('o')).toMatchObject({ statusId: 'in_progress' });
    expect(store.moveTask('b', 'shipped', [], 0)).toBe(true);
    expect(store.taskById.get('b')).toMatchObject({ statusId: 'shipped', status: 'done' });
    expect(store.taskById.get('b')?.completedAt).toBeTruthy();
    store.toggleDone('r');
    const copy = store.tasks.at(-1)!;
    expect(copy).toMatchObject({ projectId: 'api', statusId: 'backlog', status: 'todo', dueDate: '2026-03-17' });
    expect(store.updateTask('a', { statusId: 'review' })).toBe(true);
    expect(store.activity.at(-1)).toMatchObject({ type: 'status', from: 'doing', to: 'review' });
    // moving a task to a project with another workflow maps its status by category
    store.moveToProject(['a'], 'ops');
    expect(store.taskById.get('a')).toMatchObject({ statusId: 'in_progress', status: 'in_progress' });
  });

  it('edits workflows with remapping, validation and a single undo step', () => {
    const store = seeded();
    const before = { tasks: store.tasks, projects: store.projects };
    // delete "Review": its task moves to "Doing"
    const wf = store.projectById.get('web')!.workflow!;
    expect(store.setWorkflow('web', wf.filter((s) => s.id !== 'review'), { review: 'doing' })).toBe('');
    expect(store.taskById.get('b')?.statusId).toBe('doing');
    expect(store.undo()).toBe(true);
    expect(store.tasks).toBe(before.tasks);
    expect(store.projects).toBe(before.projects);
    // recategorising a status completes its tasks (completedAt set)
    expect(store.setWorkflow('web', wf.map((s) => (s.id === 'review' ? { ...s, category: 'done' as const } : s)))).toBe('');
    expect(store.taskById.get('b')).toMatchObject({ status: 'done' });
    expect(store.taskById.get('b')?.completedAt).toBeTruthy();
    // invalid workflow is refused
    expect(store.setWorkflow('web', wf.filter((s) => s.category !== 'done'))).toMatch(/Done/);
    // a sub-project customises (copy, ids kept) and resets back
    expect(store.setWorkflow('docs', wf.map((s) => ({ ...s })))).toBe('');
    expect(store.workflows.sourceOf('api')).toBe('docs');
    expect(store.setWorkflow('docs', null)).toBe('');
    expect(store.workflows.sourceOf('api')).toBe('web');
  });

  it('re-parents without cycles and deletes with sub-project handling', () => {
    const store = seeded();
    expect(store.updateProject('web', { parentId: 'api' })).toMatch(/own sub-projects/);
    expect(store.updateProject('ops', { parentId: 'web' })).toBe('');
    // ops now inherits web's workflow: its task is mapped by category
    expect(store.taskById.get('o')?.statusId).toBe('backlog');
    store.deleteProject('docs', 'unassign', 'lift');
    expect(store.projectById.get('api')?.parentId).toBe('web');
    expect(store.taskById.get('a')?.projectId).toBeNull();
    expect(store.taskById.get('a')?.statusId).toBe('todo'); // default workflow now
    store.undo();
    store.deleteProject('web', 'delete', 'delete');
    expect(store.projects.map((p) => p.id)).toEqual([]);
    expect(store.tasks).toEqual([]);
  });

  it('migrates taskpilot:v1 storage to taskpilot:v2 on load', () => {
    const d = generateDemoData(4);
    storage.set('taskpilot:v1', JSON.stringify({ tasks: d.tasks.map(({ statusId: _s, assigneeId: _a, recurrence: _r, blockedBy: _b, comments: _c, ...t }) => t), projects: d.projects.map(({ parentId: _p, workflow: _w, ...p }) => p), settings: d.settings }));
    const store = useTaskStore();
    store.load();
    expect(store.tasks).toHaveLength(4);
    expect(storage.has('taskpilot:v1')).toBe(false);
    const saved = JSON.parse(storage.get('taskpilot:v2')!);
    expect(saved.schemaVersion).toBe(2);
    expect(saved.tasks[0].statusId).toBe(d.tasks[0]!.status);
    // a second load reads v2
    setActivePinia(createPinia());
    const again = useTaskStore();
    again.load();
    expect(again.tasks.map((t) => t.id)).toEqual(store.tasks.map((t) => t.id));
  });
});
