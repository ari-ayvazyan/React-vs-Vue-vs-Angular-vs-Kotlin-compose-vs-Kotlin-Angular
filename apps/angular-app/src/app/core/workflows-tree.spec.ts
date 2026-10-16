import { DEFAULT_WORKFLOW, Project, Task, WorkflowStatus } from './models';
import {
  ancestors,
  projectOptions,
  projectPath,
  subtreeMap,
  treeOrder,
  wouldCreateCycle,
} from './project-tree';
import {
  effectiveWorkflow,
  reconcileTasks,
  statusNameMap,
  validateWorkflow,
  workflowResolver,
} from './workflows';
import { filterTasks, DEFAULT_QUERY } from './filters';
import { projectProgress } from './stats';
import { burndown } from './reports';
import { moveTaskTo } from './task-ops';
import { generateDemoData } from './demo-data';
import { validateAppState } from './validation';

const NOW = new Date(2026, 5, 15, 12);
const NOW_ISO = NOW.toISOString();

const REVIEW: WorkflowStatus[] = [
  { id: 'backlog', name: 'Backlog', color: '#94a3b8', category: 'todo' },
  { id: 'doing', name: 'Doing', color: '#6366f1', category: 'in_progress' },
  { id: 'review', name: 'Review', color: '#f59e0b', category: 'in_progress' },
  { id: 'shipped', name: 'Shipped', color: '#10b981', category: 'done' },
];

const project = (
  id: string,
  parentId: string | null = null,
  workflow: WorkflowStatus[] | null = null,
): Project => ({
  id,
  name: id.toUpperCase(),
  color: '#6366f1',
  createdAt: NOW_ISO,
  parentId,
  workflow,
});

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
  return p.statusId ? t : { ...t, statusId: t.status };
}

// a ─ b ─ c   (a has the REVIEW workflow; b inherits; c customises its own copy)
//   └ d
// e (top level, default workflow)
const projects = [
  project('a', null, REVIEW),
  project('b', 'a'),
  project(
    'c',
    'b',
    REVIEW.map((s) => (s.id === 'review' ? { ...s, name: 'QA' } : s)),
  ),
  project('d', 'a'),
  project('e'),
];

describe('project tree', () => {
  it('orders depth-first and computes subtrees, paths and options', () => {
    expect(treeOrder(projects).map((n) => `${n.project.id}${n.depth}`)).toEqual([
      'a0',
      'b1',
      'c2',
      'd1',
      'e0',
    ]);
    const sub = subtreeMap(projects);
    expect([...sub.get('a')!].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...sub.get('b')!].sort()).toEqual(['b', 'c']);
    expect([...sub.get('e')!]).toEqual(['e']);
    expect(ancestors(projects, 'c').map((p) => p.id)).toEqual(['a', 'b']);
    expect(projectPath(projects, 'c')).toBe('A / B / C');
    expect(projectOptions(projects).map((o) => o.depth)).toEqual([0, 1, 2, 1, 0]);
  });

  it('detects cycles when re-parenting', () => {
    expect(wouldCreateCycle(projects, 'a', 'c')).toBe(true); // c is a's descendant
    expect(wouldCreateCycle(projects, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(projects, 'c', 'e')).toBe(false);
    expect(wouldCreateCycle(projects, 'b', null)).toBe(false);
    // a dangling parent counts as top level, a cycle in data never loops forever
    const broken = [project('x', 'y'), project('y', 'x'), project('z', 'gone')];
    expect(treeOrder(broken).map((n) => n.project.id)).toEqual(['z']);
    expect(subtreeMap(broken).get('x')!.size).toBe(2);
  });

  it('filters, progress and burndown include sub-projects', () => {
    const tasks = [
      task('1', { projectId: 'a' }),
      task('2', { projectId: 'c', status: 'done', statusId: 'shipped', completedAt: NOW_ISO }),
      task('3', { projectId: 'd' }),
      task('4', { projectId: 'e' }),
    ];
    const sub = subtreeMap(projects);
    const ids = (project: string) =>
      filterTasks(tasks, { ...DEFAULT_QUERY, project }, '2026-06-15', sub).map((t) => t.id);
    expect(ids('a')).toEqual(['1', '2', '3']);
    expect(ids('b')).toEqual(['2']);
    expect(ids('e')).toEqual(['4']);
    // without the subtree map only the project itself matches (old behaviour)
    expect(
      filterTasks(tasks, { ...DEFAULT_QUERY, project: 'a' }, '2026-06-15').map((t) => t.id),
    ).toEqual(['1']);
    const prog = new Map(projectProgress(tasks, projects, sub).map((p) => [p.project.id, p]));
    expect([prog.get('a')!.total, prog.get('a')!.done, prog.get('a')!.percent]).toEqual([3, 1, 33]);
    expect(prog.get('b')!.total).toBe(1);
    expect(burndown(tasks, 'a', NOW, 1, sub)[0].count).toBe(2);
  });
});

describe('workflows', () => {
  const map = new Map(projects.map((p) => [p.id, p]));

  it('resolves the effective workflow through the parent chain', () => {
    expect(effectiveWorkflow('a', map)).toEqual({ statuses: REVIEW, sourceId: 'a' });
    expect(effectiveWorkflow('b', map).sourceId).toBe('a');
    expect(effectiveWorkflow('d', map).sourceId).toBe('a');
    expect(effectiveWorkflow('c', map).sourceId).toBe('c');
    expect(effectiveWorkflow('e', map)).toEqual({ statuses: DEFAULT_WORKFLOW, sourceId: null });
    expect(effectiveWorkflow(null, map).statuses).toBe(DEFAULT_WORKFLOW);
    const of = workflowResolver(projects);
    expect(of('b')).toBe(of('d')); // same array: inherited from a
    expect(of('unknown')).toBe(DEFAULT_WORKFLOW);
    expect(statusNameMap(projects).get('review')!.name).toBe('Review');
  });

  it('validates workflows', () => {
    expect(validateWorkflow(REVIEW)).toBe('');
    expect(validateWorkflow(REVIEW.filter((s) => s.category !== 'done'))).toMatch(/each category/);
    expect(validateWorkflow([...REVIEW, { ...REVIEW[0] }])).toMatch(/Duplicate/);
    expect(validateWorkflow([...REVIEW, { ...REVIEW[0], id: 'x', name: 'backlog' }])).toMatch(
      /already/,
    );
    expect(validateWorkflow([...REVIEW, { ...REVIEW[0], id: 'x', name: '  ' }])).toMatch(
      /required/,
    );
    expect(
      validateWorkflow([...REVIEW, { ...REVIEW[0], id: 'x', name: 'X', color: 'red' }]),
    ).toMatch(/hex/);
  });

  describe('reconcileTasks', () => {
    const of = workflowResolver(projects);

    it('keeps consistent tasks untouched (same array)', () => {
      const tasks = [
        task('1', { projectId: 'b', statusId: 'review', status: 'in_progress' }),
        task('2'),
      ];
      expect(reconcileTasks(null, tasks, of, NOW_ISO)).toBe(tasks);
    });

    it('maps an unknown status by category (moved project, deleted status, default ids)', () => {
      const [t] = reconcileTasks(
        null,
        [task('1', { projectId: 'a', status: 'in_progress' })],
        of,
        NOW_ISO,
      );
      expect([t.statusId, t.status]).toEqual(['doing', 'in_progress']);
      const [u] = reconcileTasks(
        null,
        [task('2', { projectId: 'e', statusId: 'review', status: 'in_progress' })],
        of,
        NOW_ISO,
      );
      expect(u.statusId).toBe('in_progress');
    });

    it('a status change decides the category and completedAt', () => {
      const before = [task('1', { projectId: 'a', statusId: 'review', status: 'in_progress' })];
      const after = [{ ...before[0], statusId: 'shipped' }];
      const [t] = reconcileTasks(before, after, of, NOW_ISO);
      expect([t.status, t.completedAt]).toEqual(['done', NOW_ISO]);
      const [back] = reconcileTasks([t], [{ ...t, statusId: 'backlog' }], of, NOW_ISO);
      expect([back.status, back.completedAt]).toEqual(['todo', null]);
    });

    it('a category-only change (e.g. "mark done") picks the first status of that category', () => {
      const before = [task('1', { projectId: 'b', statusId: 'review', status: 'in_progress' })];
      const [t] = reconcileTasks(
        before,
        [{ ...before[0], status: 'done', completedAt: NOW_ISO }],
        of,
        NOW_ISO,
      );
      expect([t.statusId, t.status, t.completedAt]).toEqual(['shipped', 'done', NOW_ISO]);
    });

    it('follows a changed status category (workflow edited)', () => {
      const edited = projects.map((p) =>
        p.id === 'a'
          ? {
              ...p,
              workflow: REVIEW.map((s) =>
                s.id === 'review' ? { ...s, category: 'done' as const } : s,
              ),
            }
          : p,
      );
      const tasks = [task('1', { projectId: 'd', statusId: 'review', status: 'in_progress' })];
      const [t] = reconcileTasks(tasks, tasks, workflowResolver(edited), NOW_ISO);
      expect([t.statusId, t.status, t.completedAt]).toEqual(['review', 'done', NOW_ISO]);
    });
  });

  it('board moves into a status column set the status and order', () => {
    const tasks = [
      task('1', { projectId: 'a', statusId: 'doing', status: 'in_progress', order: 0 }),
      task('2', { projectId: 'a', statusId: 'review', status: 'in_progress', order: 0 }),
    ];
    const out = moveTaskTo(
      tasks,
      '1',
      { category: 'in_progress', statusId: 'review', inColumn: (t) => t.statusId === 'review' },
      0,
      NOW_ISO,
    );
    expect(out.find((t) => t.id === '1')).toMatchObject({ statusId: 'review', order: 0 });
    expect(out.find((t) => t.id === '2')!.order).toBe(1);
  });
});

describe('schema v2 and migration', () => {
  it('migrates v1 data: statusId from the status, top-level projects, default workflow', () => {
    const v2 = generateDemoData(30, NOW);
    expect(v2.version).toBe(2);
    expect(v2.tasks.every((t) => t.statusId === t.status)).toBe(true);
    // build a v1 export: no version, no statusId / parentId / workflow
    const v1 = JSON.parse(JSON.stringify(v2));
    delete v1.version;
    for (const t of v1.tasks) delete t.statusId;
    for (const p of v1.projects) {
      delete p.parentId;
      delete p.workflow;
    }
    const res = validateAppState(v1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state).toEqual(v2);
  });

  it('accepts v2 with sub-projects and custom workflows, and rejects broken ones', () => {
    const s = generateDemoData(5, NOW);
    const withTree = {
      ...s,
      projects: [
        { ...s.projects[0], workflow: REVIEW },
        { ...s.projects[1], parentId: s.projects[0].id },
        ...s.projects.slice(2),
      ],
      tasks: s.tasks.map((t) => ({
        ...t,
        projectId: s.projects[1].id,
        statusId: t.status === 'done' ? 'shipped' : t.status === 'todo' ? 'backlog' : 'doing',
      })),
    };
    expect(validateAppState(withTree).ok).toBe(true);
    const badStatus = {
      ...withTree,
      tasks: withTree.tasks.map((t) => ({ ...t, statusId: 'todo' })),
    };
    const r1 = validateAppState(badStatus);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/statusId/);
    const cycle = {
      ...s,
      projects: [
        { ...s.projects[0], parentId: s.projects[1].id },
        { ...s.projects[1], parentId: s.projects[0].id },
      ],
      tasks: [],
    };
    expect(validateAppState(cycle)).toEqual({
      ok: false,
      error: 'Project parents must not form a cycle.',
    });
    const noDone = {
      ...s,
      projects: [{ ...s.projects[0], workflow: REVIEW.slice(0, 3) }],
      tasks: [],
    };
    const r3 = validateAppState(noDone);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error).toMatch(/each category/);
    expect(validateAppState({ ...s, version: 3 }).ok).toBe(false);
  });
});
