import { describe, expect, it } from 'vitest';
import { generateDemoData } from '../lib/demo';
import { DEFAULT_QUERY, filterTasks } from '../lib/filters';
import { eventNotifications } from '../lib/notifications';
import { dataReducer, type Data } from '../lib/reducer';
import { burndown } from '../lib/reports';
import { computeKpis, projectProgress } from '../lib/stats';
import { serializeState, TaskStore } from '../lib/store';
import type { Project, WorkflowStatus } from '../lib/types';
import { validateImport } from '../lib/validation';
import {
  DEFAULT_WORKFLOW,
  descendantIds,
  effectiveWorkflow,
  projectMap,
  projectPath,
  projectTree,
  reconcileTasks,
  statusForCategory,
  treeLabel,
  validateWorkflow,
  workflowOwner,
  wouldCreateCycle,
} from '../lib/workflow';
import { emptyData, task } from './fixtures';

const AT = '2026-10-15T12:00:00.000Z';
const TODAY = '2026-10-15';

/** Kanban-ish workflow: Backlog, Ready (todo) · Doing, Review (in progress) · Shipped (done). */
const KANBAN: WorkflowStatus[] = [
  { id: 'backlog', name: 'Backlog', color: '#94a3b8', category: 'todo' },
  { id: 'ready', name: 'Ready', color: '#64748b', category: 'todo' },
  { id: 'doing', name: 'Doing', color: '#3b82f6', category: 'in_progress' },
  { id: 'review', name: 'Review', color: '#a855f7', category: 'in_progress' },
  { id: 'shipped', name: 'Shipped', color: '#22c55e', category: 'done' },
];

function project(id: string, p: Partial<Project> = {}): Project {
  return { id, name: id.toUpperCase(), color: '#6366f1', createdAt: AT, parentId: null, workflow: null, ...p };
}

// web (custom KANBAN) ├─ landing (inherits) │  └─ copy (inherits) └─ api (own default-like workflow)
// ops (default)
const PROJECTS = [
  project('web', { workflow: KANBAN }),
  project('landing', { parentId: 'web' }),
  project('copy', { parentId: 'landing' }),
  project('api', { parentId: 'web', workflow: DEFAULT_WORKFLOW.map((s) => ({ ...s })) }),
  project('ops'),
];

describe('project tree', () => {
  it('collects descendants, detects cycles, orders a tree and builds paths', () => {
    expect([...descendantIds(PROJECTS, 'web')].sort()).toEqual(['api', 'copy', 'landing', 'web']);
    expect([...descendantIds(PROJECTS, 'landing')].sort()).toEqual(['copy', 'landing']);
    expect(wouldCreateCycle(PROJECTS, 'web', 'copy')).toBe(true);
    expect(wouldCreateCycle(PROJECTS, 'web', 'web')).toBe(true);
    expect(wouldCreateCycle(PROJECTS, 'ops', 'copy')).toBe(false);
    expect(wouldCreateCycle(PROJECTS, 'web', null)).toBe(false);
    expect(projectTree(PROJECTS).map((r) => `${r.depth}:${r.project.id}`)).toEqual(['0:web', '1:landing', '2:copy', '1:api', '0:ops']);
    expect(projectPath(projectMap(PROJECTS), 'copy')).toBe('WEB › LANDING › COPY');
    expect(treeLabel({ project: PROJECTS[2], depth: 2 })).toBe('      └ COPY');
  });
});

describe('workflows', () => {
  it('inherit from the nearest customised ancestor, else the default', () => {
    const byId = projectMap(PROJECTS);
    expect(workflowOwner(byId, 'copy')?.id).toBe('web');
    expect(effectiveWorkflow(byId, 'copy')).toBe(KANBAN);
    expect(effectiveWorkflow(byId, 'api').map((s) => s.id)).toEqual(['todo', 'in_progress', 'done']);
    expect(effectiveWorkflow(byId, 'ops')).toBe(DEFAULT_WORKFLOW);
    expect(effectiveWorkflow(byId, null)).toBe(DEFAULT_WORKFLOW);
  });

  it('picks statuses by category', () => {
    expect(statusForCategory(KANBAN, 'done')).toBe('shipped');
    expect(statusForCategory(KANBAN, 'in_progress', 'review')).toBe('review');
    expect(statusForCategory(KANBAN, 'in_progress', 'backlog')).toBe('doing');
  });

  it('validates workflows', () => {
    expect(validateWorkflow(KANBAN)).toBeNull();
    expect(validateWorkflow([])).toMatch(/at least one status/);
    expect(validateWorkflow(KANBAN.filter((s) => s.category !== 'done'))).toMatch(/“Done”/);
    expect(validateWorkflow([...KANBAN, { ...KANBAN[0], id: 'x', name: 'backlog' }])).toMatch(/already a status/);
    expect(validateWorkflow([{ ...KANBAN[0], name: ' ' }, ...KANBAN.slice(1)])).toMatch(/empty/);
    expect(validateWorkflow([{ ...KANBAN[0], color: 'red' }, ...KANBAN.slice(1)])).toMatch(/hex/);
  });

  it('reconciles tasks: unknown statuses map by category; category changes set/clear completedAt and append', () => {
    const tasks = [
      task({ id: 'a', projectId: 'landing', statusId: 'in_progress', category: 'in_progress' }), // not in KANBAN → doing
      task({ id: 'b', projectId: 'web', statusId: 'shipped', category: 'todo', order: 0 }), // category follows status → done
      task({ id: 'c', projectId: 'ops', statusId: 'todo', category: 'todo' }), // fine
    ];
    const out = reconcileTasks(tasks, PROJECTS, AT);
    expect(out.map((t) => [t.id, t.statusId, t.category])).toEqual([
      ['a', 'doing', 'in_progress'],
      ['b', 'shipped', 'done'],
      ['c', 'todo', 'todo'],
    ]);
    expect(out[1].completedAt).toBe(AT);
    expect(out[2]).toBe(tasks[2]);
    expect(reconcileTasks(out, PROJECTS, AT)).toBe(out);
  });
});

describe('descendants everywhere', () => {
  const tasks = [
    task({ projectId: 'web', statusId: 'shipped', category: 'done' }),
    task({ projectId: 'landing', statusId: 'doing', category: 'in_progress' }),
    task({ projectId: 'copy', statusId: 'backlog', category: 'todo' }),
    task({ projectId: 'ops' }),
  ];

  it('a project filter includes sub-projects', () => {
    expect(filterTasks(tasks, { ...DEFAULT_QUERY, project: 'web' }, TODAY, PROJECTS)).toHaveLength(3);
    expect(filterTasks(tasks, { ...DEFAULT_QUERY, project: 'landing' }, TODAY, PROJECTS)).toHaveLength(2);
    expect(filterTasks(tasks, { ...DEFAULT_QUERY, status: ['in_progress'] }, TODAY, PROJECTS)).toHaveLength(1);
  });

  it('progress and counts roll up', () => {
    const p = new Map(projectProgress(tasks, PROJECTS).map((r) => [r.project.id, r]));
    expect([p.get('web')!.total, p.get('web')!.done, p.get('web')!.pct]).toEqual([3, 1, 33]);
    expect([p.get('landing')!.total, p.get('copy')!.total, p.get('api')!.total]).toEqual([2, 1, 0]);
  });

  it('KPIs and burndown use categories and descendants', () => {
    expect(computeKpis(tasks, TODAY)).toMatchObject({ total: 4, open: 3, completionRate: 25 });
    expect(burndown(tasks, 'landing', TODAY, 1, PROJECTS)[0].value).toBe(2);
  });
});

describe('reducer with workflows', () => {
  const base = (): Data =>
    emptyData({
      projects: PROJECTS,
      tasks: [
        task({ id: 'w1', projectId: 'web', statusId: 'review', category: 'in_progress' }),
        task({ id: 'l1', projectId: 'landing', statusId: 'ready', category: 'todo', recurrence: 'weekly', dueDate: '2026-10-10' }),
        task({ id: 'o1', projectId: 'ops' }),
      ],
    });

  it('mark done / reopen use the task’s own workflow; recurrence copies start in its first to-do status', () => {
    const s = dataReducer(base(), { type: 'task/setCategory', ids: ['w1', 'l1', 'o1'], category: 'done', at: AT });
    expect(s.tasks.slice(0, 3).map((t) => [t.statusId, t.category, t.completedAt])).toEqual([
      ['shipped', 'done', AT],
      ['shipped', 'done', AT],
      ['done', 'done', AT],
    ]);
    expect(s.tasks[3]).toMatchObject({ id: 'l1-r1', statusId: 'backlog', category: 'todo', dueDate: '2026-10-17' });
    const reopened = dataReducer(s, { type: 'task/setCategory', ids: ['w1'], category: 'todo', at: AT });
    expect(reopened.tasks[0]).toMatchObject({ statusId: 'backlog', category: 'todo', completedAt: null });
  });

  it('board moves into a custom status set the category from the workflow', () => {
    const s = dataReducer(base(), { type: 'task/move', id: 'w1', statusId: 'shipped', index: 0, at: AT });
    expect(s.tasks[0]).toMatchObject({ statusId: 'shipped', category: 'done', completedAt: AT, order: 0 });
    // a status that is not in the task's workflow is refused
    expect(dataReducer(base(), { type: 'task/move', id: 'o1', statusId: 'shipped', index: 0, at: AT }).tasks[2].statusId).toBe('todo');
  });

  it('changing a project’s parent re-maps tasks into the inherited workflow', () => {
    const s = dataReducer(base(), { type: 'project/update', id: 'ops', patch: { parentId: 'web' }, at: AT });
    expect(s.tasks[2]).toMatchObject({ statusId: 'backlog', category: 'todo' });
    const b = base();
    expect(dataReducer(b, { type: 'project/update', id: 'web', patch: { parentId: 'copy' }, at: AT })).toBe(b);
  });

  it('editing a workflow: changing a status category completes its tasks; invalid workflows are refused', () => {
    const wf = KANBAN.map((st) => (st.id === 'review' ? { ...st, category: 'done' as const } : st));
    const s = dataReducer(base(), { type: 'project/update', id: 'web', patch: { workflow: wf }, at: AT });
    expect(s.tasks[0]).toMatchObject({ statusId: 'review', category: 'done', completedAt: AT });
    const broken = KANBAN.filter((st) => st.category !== 'done');
    const b = base();
    expect(dataReducer(b, { type: 'project/update', id: 'web', patch: { workflow: broken }, at: AT })).toBe(b);
  });

  it('resetting a customised workflow to inherited maps statuses by category', () => {
    const s = dataReducer(base(), { type: 'project/update', id: 'web', patch: { workflow: null }, at: AT });
    expect(s.tasks.slice(0, 2).map((t) => t.statusId)).toEqual(['in_progress', 'todo']);
  });

  it('deleting a status moves its tasks (also in inheriting sub-projects) to the chosen status', () => {
    const b = base();
    const s = dataReducer(b, { type: 'workflow/deleteStatus', projectId: 'web', statusId: 'ready', targetId: 'doing', at: AT });
    expect(s.projects[0].workflow!.map((st) => st.id)).toEqual(['backlog', 'doing', 'review', 'shipped']);
    expect(s.tasks[1]).toMatchObject({ id: 'l1', statusId: 'doing', category: 'in_progress' });
    // the last "done" status cannot be deleted
    expect(dataReducer(b, { type: 'workflow/deleteStatus', projectId: 'web', statusId: 'shipped', targetId: 'doing', at: AT })).toBe(b);
  });

  it('deleting a project lifts sub-projects (keeping the inherited workflow) or deletes them too', () => {
    const lifted = dataReducer(base(), { type: 'project/delete', id: 'web', mode: 'unassign', children: 'lift', at: AT });
    const landing = lifted.projects.find((p) => p.id === 'landing')!;
    expect(landing.parentId).toBeNull();
    expect(landing.workflow!.map((s) => s.id)).toEqual(KANBAN.map((s) => s.id));
    expect(lifted.projects.find((p) => p.id === 'copy')!.parentId).toBe('landing');
    expect(lifted.tasks.find((t) => t.id === 'l1')!.statusId).toBe('ready');
    // web's own task is unassigned → default workflow, mapped by category
    expect(lifted.tasks.find((t) => t.id === 'w1')).toMatchObject({ projectId: null, statusId: 'in_progress' });

    const deep = dataReducer(base(), { type: 'project/delete', id: 'web', mode: 'delete', children: 'delete', at: AT });
    expect(deep.projects.map((p) => p.id)).toEqual(['ops']);
    expect(deep.tasks.map((t) => t.id)).toEqual(['o1']);
  });

  it('blockers stay enforced when a workflow edit would complete a blocked task', () => {
    const b = base();
    b.tasks[0] = { ...b.tasks[0], blockedBy: ['o1'] };
    const wf = KANBAN.map((st) => (st.id === 'review' ? { ...st, category: 'done' as const } : st));
    const s = dataReducer(b, { type: 'project/update', id: 'web', patch: { workflow: wf }, at: AT });
    expect(s.tasks[0]).toMatchObject({ category: 'in_progress', statusId: 'doing', completedAt: null });
  });

  it('a custom done status completes blockers for notifications', () => {
    const before = [task({ id: 'b', projectId: 'web', statusId: 'review', category: 'in_progress' }), task({ id: 'x', assigneeId: 'm1', blockedBy: ['b'] })];
    const after = [{ ...before[0], statusId: 'shipped', category: 'done' as const }, before[1]];
    const out = eventNotifications(
      [{ id: 'e', taskId: 'b', actorId: null, type: 'update', field: 'status', from: 'review', to: 'shipped', at: AT }],
      before,
      after,
      [{ id: 'm1', name: 'Alex Kim', color: '#0ea5e9' }],
    );
    expect(out).toMatchObject([{ userId: 'm1', type: 'unblocked', taskId: 'x' }]);
  });
});

describe('schema v2 and migration', () => {
  /** A v1 export: tasks have `status`, projects have no parentId/workflow, no `schema`. */
  function v1Export() {
    const d = JSON.parse(JSON.stringify(generateDemoData(20)));
    for (const t of d.tasks) {
      t.status = t.statusId;
      delete t.statusId;
      delete t.category;
    }
    for (const p of d.projects) {
      delete p.parentId;
      delete p.workflow;
    }
    return d;
  }

  it('imports v1 exports into the new schema', () => {
    const v1 = v1Export();
    const res = validateImport(v1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.tasks.every((t, i) => t.statusId === v1.tasks[i].status && t.category === v1.tasks[i].status)).toBe(true);
    expect(res.state.projects.every((p) => p.parentId === null && p.workflow === null)).toBe(true);
  });

  it('round-trips v2 exports and validates the tree and statuses', () => {
    const state = generateDemoData(5);
    state.projects[1] = { ...state.projects[1], parentId: 'p1', workflow: KANBAN };
    state.tasks = state.tasks.map((t) => (t.projectId === 'p2' ? { ...t, statusId: 'review', category: 'in_progress' } : t));
    const json = JSON.parse(serializeState(state));
    expect(json.schema).toBe(2);
    const res = validateImport(json);
    expect(res.ok && res.state.projects[1].workflow).toEqual(KANBAN);
    // category is derived, never trusted
    const lying = JSON.parse(serializeState(state));
    lying.tasks[0].category = 'done';
    const r2 = validateImport(lying);
    expect(r2.ok && r2.state.tasks[0].category).toBe(state.tasks[0].category);

    const cyclic = JSON.parse(serializeState(state));
    cyclic.projects[0].parentId = 'p2';
    expect(validateImport(cyclic)).toMatchObject({ ok: false, error: expect.stringContaining('cycle') });
    const badStatus = JSON.parse(serializeState(state));
    badStatus.tasks[0].statusId = 'nope';
    expect(validateImport(badStatus)).toMatchObject({ ok: false, error: expect.stringContaining("not in its project's workflow") });
    expect(validateImport({ ...json, schema: 3 })).toMatchObject({ ok: false, error: expect.stringContaining('newer version') });
  });

  it('the store migrates taskpilot:v1 on load and writes taskpilot:v2', () => {
    const mem = new Map<string, string>([['taskpilot:v1', JSON.stringify(v1Export())]]);
    const store = new TaskStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) }, '');
    expect(store.getSnapshot().state.tasks).toHaveLength(20);
    store.flush();
    const saved = JSON.parse(mem.get('taskpilot:v2')!);
    expect(saved.schema).toBe(2);
    expect(saved.tasks[0].statusId).toBeDefined();
    expect(mem.has('taskpilot:v1')).toBe(true); // left as a backup
  });
});
