import { TestBed } from '@angular/core/testing';
import { StoreService } from './store.service';
import { ToastService } from './toast.service';
import { STORAGE_KEY } from '../core/models';

describe('StoreService', () => {
  let store: StoreService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    store = TestBed.inject(StoreService);
    store.init(20);
  });

  it('seeds demo data on init and persists it', () => {
    expect(store.ready()).toBe(true);
    expect(store.tasks()).toHaveLength(20);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks).toHaveLength(20);
  });

  it('creates tasks and supports undo/redo of task mutations', () => {
    const t = store.createTask({
      title: 'New',
      description: '',
      status: 'todo',
      priority: 'high',
      projectId: null,
      tags: [],
      dueDate: null,
      estimateMinutes: null,
    });
    expect(store.tasks()).toHaveLength(21);
    store.updateTask(t.id, { title: 'Renamed' });
    expect(store.getTask(t.id)!.title).toBe('Renamed');
    store.undo();
    expect(store.getTask(t.id)!.title).toBe('New');
    store.undo();
    expect(store.getTask(t.id)).toBeUndefined();
    store.redo();
    expect(store.getTask(t.id)!.title).toBe('New');
    expect(store.canRedo()).toBe(true);
  });

  it('sets completedAt when a task is marked done and clears it when reopened', () => {
    const id = store.tasks().find((t) => t.status !== 'done')!.id;
    store.toggleDone(id);
    expect(store.getTask(id)!.completedAt).not.toBeNull();
    store.toggleDone(id);
    expect(store.getTask(id)!.status).toBe('todo');
    expect(store.getTask(id)!.completedAt).toBeNull();
  });

  it('deletes a project, unassigning or deleting its tasks', () => {
    const p = store.projects()[0];
    const count = store.tasks().filter((t) => t.projectId === p.id).length;
    store.deleteProject(p.id, 'unassign');
    expect(store.projects().some((x) => x.id === p.id)).toBe(false);
    expect(store.tasks()).toHaveLength(20);
    store.undo();
    store.deleteProject(p.id, 'delete');
    expect(store.tasks()).toHaveLength(20 - count);
  });

  it('completing a recurring task creates the next occurrence; one undo reverts both', () => {
    const base = store.createTask({
      title: 'Weekly sync',
      description: '',
      status: 'in_progress',
      priority: 'medium',
      projectId: null,
      tags: ['meeting'],
      dueDate: '2026-06-10',
      estimateMinutes: 30,
      recurrence: 'weekly',
      assigneeId: 'm2',
      subtasks: [{ id: 's1', title: 'Agenda', done: true }],
      timeSpentMinutes: 40,
    });
    const count = store.tasks().length;
    store.toggleDone(base.id);
    expect(store.tasks()).toHaveLength(count + 1);
    const copy = store.tasks().find((t) => t.id !== base.id && t.title === 'Weekly sync')!;
    expect(copy).toMatchObject({
      status: 'todo',
      dueDate: '2026-06-17',
      timeSpentMinutes: 0,
      assigneeId: 'm2',
      recurrence: 'weekly',
      completedAt: null,
    });
    expect(copy.subtasks[0].done).toBe(false);
    expect(store.getTask(base.id)!.status).toBe('done');

    store.undo();
    expect(store.tasks()).toHaveLength(count);
    expect(store.getTask(base.id)!.status).toBe('in_progress');
    expect(store.getTask(copy.id)).toBeUndefined();

    store.redo();
    expect(store.getTask(copy.id)).toBeDefined();
    expect(store.getTask(base.id)!.status).toBe('done');

    // reopening does not spawn; completing via the board does, once per transition
    store.setStatus([base.id], 'todo');
    expect(store.tasks()).toHaveLength(count + 1);
    store.moveOnBoard(base.id, { category: 'done', inColumn: (t) => t.status === 'done' }, 0);
    expect(store.tasks()).toHaveLength(count + 2);
    // marking an already-done task done again does nothing
    store.setStatus([base.id], 'done');
    expect(store.tasks()).toHaveLength(count + 2);
  });

  it('creates, updates and deletes members; deleting unassigns their tasks (undoable)', () => {
    const m = store.createMember('  Robin Chen ', '#14b8a6');
    expect(store.members().at(-1)).toEqual({ id: m.id, name: 'Robin Chen', color: '#14b8a6' });
    store.updateMember(m.id, { name: 'Robin C.', color: '#ec4899' });
    expect(store.memberMap().get(m.id)).toMatchObject({ name: 'Robin C.', color: '#ec4899' });

    const alex = store.members().find((x) => x.id === 'm1')!;
    const assigned = store
      .tasks()
      .filter((t) => t.assigneeId === 'm1')
      .map((t) => t.id);
    expect(assigned.length).toBeGreaterThan(0);
    store.deleteMember('m1');
    expect(store.memberMap().has('m1')).toBe(false);
    expect(assigned.every((id) => store.getTask(id)!.assigneeId === null)).toBe(true);
    store.undo();
    expect(store.memberMap().get('m1')).toEqual(alex);
    expect(assigned.every((id) => store.getTask(id)!.assigneeId === 'm1')).toBe(true);
  });

  it('refuses to complete blocked tasks from every entry point and names the blockers', () => {
    const toasts = TestBed.inject(ToastService);
    const [a, b] = store.tasks().filter((t) => t.status === 'todo');
    expect(store.addBlocker(b.id, a.id)).toEqual({ ok: true });
    expect(store.blockedIds().has(b.id)).toBe(true);

    expect(store.setStatus([b.id], 'done')).toEqual([]);
    expect(store.getTask(b.id)!.status).toBe('todo');
    expect(toasts.toasts().at(-1)).toMatchObject({ kind: 'error' });
    expect(toasts.toasts().at(-1)!.message).toContain(`“${a.title}”`);

    store.toggleDone(b.id);
    expect(
      store.moveOnBoard(b.id, { category: 'done', inColumn: (t) => t.status === 'done' }, 0),
    ).toBe(false);
    expect(store.updateTask(b.id, { status: 'done', title: 'Renamed' })).toBe(false);
    expect(store.getTask(b.id)).toMatchObject({ status: 'todo', title: 'Renamed' });

    // bulk: blocker and blocked together are fine
    expect(store.setStatus([b.id, a.id], 'done').sort()).toEqual([a.id, b.id].sort());
    expect(store.getTask(b.id)!.status).toBe('done');
  });

  it('rejects dependency cycles with a clear message', () => {
    const [a, b, c] = store.tasks();
    store.addBlocker(b.id, a.id);
    store.addBlocker(c.id, b.id);
    const res = store.addBlocker(a.id, c.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cycle/);
    expect(store.addBlocker(a.id, a.id)).toEqual({
      ok: false,
      error: 'A task cannot block itself.',
    });
    expect(store.getTask(a.id)!.blockedBy).toEqual([]);
  });

  it('removes dependencies on deleted tasks (and undo restores them)', () => {
    const [a, b] = store.tasks();
    store.addBlocker(b.id, a.id);
    store.deleteTasks([a.id]);
    expect(store.getTask(b.id)!.blockedBy).toEqual([]);
    store.undo();
    expect(store.getTask(b.id)!.blockedBy).toEqual([a.id]);
  });

  it('adds comments by the current user with mention tokens', () => {
    const t = store.tasks()[0];
    const c = store.addComment(t.id, '  Thanks @Sam Rivera!  ')!;
    expect(c).toMatchObject({ authorId: 'm1', body: 'Thanks <@m2>!' });
    expect(store.getTask(t.id)!.comments).toEqual([c]);
    store.updateSettings({ currentUserId: null });
    expect(store.addComment(t.id, 'nobody')).toBeNull();
    store.updateSettings({ currentUserId: 'm3' });
    expect(store.addComment(t.id, 'second')!.authorId).toBe('m3');
    expect(store.getTask(t.id)!.comments.map((x) => x.body)).toEqual(['Thanks <@m2>!', 'second']);
  });

  it('logs every task change with the current user; undo/redo keep the log consistent', () => {
    expect(store.activity()).toEqual([]);
    const t = store.tasks().find((x) => x.status === 'todo' && x.recurrence === 'none')!;
    store.updateSettings({ currentUserId: 'm2' });
    store.updateTask(t.id, { priority: 'urgent', assigneeId: 'm3' });
    store.setStatus([t.id], 'in_progress');
    store.addComment(t.id, 'hi');
    const log = store.activity();
    expect(log.map((e) => [e.type, e.field ?? null])).toEqual([
      ['field', 'priority'],
      ['assignee', 'assigneeId'],
      ['status', 'statusId'],
      ['comment', null],
    ]);
    expect(log.every((e) => e.actorId === 'm2' && e.taskId === t.id)).toBe(true);

    store.undo(); // comment
    expect(store.activity()).toHaveLength(3);
    store.undo(); // status
    expect(store.activity().map((e) => e.type)).toEqual(['field', 'assignee']);
    store.redo();
    expect(store.activity().map((e) => e.type)).toEqual(['field', 'assignee', 'status']);

    const created = store.createTask({
      title: 'Logged',
      description: '',
      status: 'todo',
      priority: 'low',
      projectId: null,
      tags: [],
      dueDate: null,
      estimateMinutes: null,
    });
    store.deleteTasks([created.id]);
    expect(
      store
        .activity()
        .slice(-2)
        .map((e) => [e.type, e.taskTitle]),
    ).toEqual([
      ['created', 'Logged'],
      ['deleted', 'Logged'],
    ]);
    // settings changes are not task changes
    const len = store.activity().length;
    store.updateSettings({ pageSize: 10 });
    expect(store.activity()).toHaveLength(len);
  });

  it('creates, renames and deletes saved views (undoable, not in the activity log)', () => {
    const v = store.createView('  Urgent bugs ', { priority: 'urgent', tag: 'bug' });
    expect(store.views()).toEqual([v]);
    expect(v.name).toBe('Urgent bugs');
    store.renameView(v.id, 'Hot bugs');
    expect(store.views()[0].name).toBe('Hot bugs');
    const canUndoBefore = store.canUndo();
    store.renameView(v.id, 'Hot bugs'); // no-op: nothing recorded
    expect(store.canUndo()).toBe(canUndoBefore);
    store.deleteView(v.id);
    expect(store.views()).toEqual([]);
    store.undo();
    expect(store.views()[0].name).toBe('Hot bugs');
    expect(store.activity()).toEqual([]);
  });

  it('timeline due-date change is a single undoable, logged edit', () => {
    const t = store.tasks().find((x) => x.dueDate)!;
    store.updateTask(t.id, { dueDate: '2030-01-02' });
    expect(store.activity().at(-1)).toMatchObject({ field: 'dueDate', to: '2030-01-02' });
    store.undo();
    expect(store.getTask(t.id)!.dueDate).toBe(t.dueDate);
  });

  it('creates notifications for the affected member and marks them read', () => {
    store.updateSettings({ currentUserId: 'm2' });
    const before = store.myNotifications().length;
    const t =
      store.tasks().find((x) => x.status !== 'done' && x.assigneeId !== 'm2' && !x.dueDate) ??
      store.tasks().find((x) => x.status !== 'done' && x.assigneeId !== 'm2')!;
    store.updateTask(t.id, { assigneeId: 'm2' });
    const mine = store.myNotifications();
    expect(mine.length).toBeGreaterThan(before);
    expect(mine[0]).toMatchObject({ type: 'assigned', taskId: t.id, read: false });
    const unread = store.unreadCount();
    store.markNotificationRead(mine[0].id);
    expect(store.unreadCount()).toBe(unread - 1);
    // mention of m2 by m1
    store.updateSettings({ currentUserId: 'm1' });
    store.addComment(t.id, 'ping @Sam Rivera');
    store.updateSettings({ currentUserId: 'm2' });
    expect(store.myNotifications()[0]).toMatchObject({ type: 'mentioned', actorId: 'm1' });
    store.markAllNotificationsRead();
    expect(store.unreadCount()).toBe(0);
    // notifications are a feed: undo does not remove them, and reading is not undoable
    const n = store.myNotifications().length;
    store.undo();
    expect(store.myNotifications()).toHaveLength(n);
  });

  it('sends due reminders on load, once per task per day', () => {
    const today = store.today();
    const t = store.tasks().find((x) => x.status !== 'done')!;
    store.updateTask(t.id, { dueDate: today, assigneeId: 'm4' });
    store.updateSettings({ currentUserId: 'm4' });
    const due = store.myNotifications().filter((n) => n.type === 'due' && n.taskId === t.id);
    expect(due).toHaveLength(1);
    store.updateTask(t.id, { title: 'Touch' }); // re-sync after a change: no duplicate
    expect(
      store.myNotifications().filter((n) => n.type === 'due' && n.taskId === t.id),
    ).toHaveLength(1);
  });

  it('edits a custom workflow; tasks follow the status category (undoable)', () => {
    const p = store.projects()[0];
    const tasks = () => store.tasks().filter((t) => t.projectId === p.id);
    store.customizeWorkflow(p.id);
    expect(
      store
        .projectMap()
        .get(p.id)!
        .workflow!.map((s) => s.id),
    ).toEqual(['todo', 'in_progress', 'done']);
    expect(
      store.addStatus(p.id, { name: 'Review', color: '#f59e0b', category: 'in_progress' }),
    ).toBe('');
    const review = store
      .workflowOf()(p.id)
      .find((s) => s.name === 'Review')!;
    const t = tasks().find((x) => x.status === 'in_progress')!;
    store.updateTask(t.id, { statusId: review.id });
    expect(store.getTask(t.id)).toMatchObject({ statusId: review.id, status: 'in_progress' });
    // making Review a "done" status completes its tasks
    expect(store.updateStatus(p.id, review.id, { category: 'done' })).toBe('');
    expect(store.getTask(t.id)!.status).toBe('done');
    expect(store.getTask(t.id)!.completedAt).not.toBeNull();
    store.undo();
    expect(store.getTask(t.id)!.status).toBe('in_progress');
    // the last status of a category cannot go
    expect(store.updateStatus(p.id, 'todo', { category: 'done' })).toMatch(/each category/);
    expect(store.deleteStatus(p.id, 'done', 'todo')).toMatch(/each category/);
    // deleting a status moves its tasks
    const moved = tasks()
      .filter((x) => x.statusId === 'in_progress')
      .map((x) => x.id);
    expect(store.deleteStatus(p.id, 'in_progress', review.id)).toBe('');
    expect(moved.every((id) => store.getTask(id)!.statusId === review.id)).toBe(true);
    // reorder + reset (tasks mapped back by category)
    store.moveStatus(p.id, review.id, -1);
    expect(
      store
        .workflowOf()(p.id)
        .map((s) => s.name),
    ).toEqual(['To do', 'Review', 'Done']);
    store.resetWorkflow(p.id);
    expect(moved.every((id) => store.getTask(id)!.statusId === 'in_progress')).toBe(true);
  });

  it('category actions map to the workflow; recurring copies start in its first to-do status', () => {
    const p = store.projects()[1];
    store.customizeWorkflow(p.id);
    store.addStatus(p.id, { name: 'Shipped', color: '#10b981', category: 'done' });
    store.moveStatus(p.id, store.workflowOf()(p.id).at(-1)!.id, -1); // Shipped before Done
    store.addStatus(p.id, { name: 'Backlog', color: '#64748b', category: 'todo' });
    const backlog = store
      .workflowOf()(p.id)
      .find((s) => s.name === 'Backlog')!;
    for (let i = 0; i < 4; i++) store.moveStatus(p.id, backlog.id, -1);
    const t = store.tasks().find((x) => x.projectId === p.id && x.status !== 'done')!;
    store.updateTask(t.id, { recurrence: 'weekly', blockedBy: [] });
    store.setStatus([t.id], 'done');
    expect(store.statusOf(store.getTask(t.id)!)!.name).toBe('Shipped');
    const copy = store
      .tasks()
      .find((x) => x.id !== t.id && x.title === t.title && x.status === 'todo')!;
    expect(copy.statusId).toBe(backlog.id);
  });

  it('sub-projects: re-parenting refuses cycles; deleting lifts or deletes them', () => {
    const [a, b, c] = store.projects();
    expect(store.setProjectParent(b.id, a.id)).toBe('');
    expect(store.setProjectParent(c.id, b.id)).toBe('');
    expect(store.setProjectParent(a.id, c.id)).toMatch(/under itself/);
    expect(store.projectSubtree().get(a.id)!.size).toBe(3);
    store.customizeWorkflow(a.id);
    store.addStatus(a.id, { name: 'QA', color: '#f59e0b', category: 'in_progress' });
    const qa = store
      .workflowOf()(a.id)
      .find((s) => s.name === 'QA')!;
    const bt = store.tasks().find((t) => t.projectId === b.id && t.status === 'in_progress')!;
    store.updateTask(bt.id, { statusId: qa.id });
    // lift: b moves to the top level and keeps a copy of a's workflow, so bt keeps "QA"
    store.deleteProject(a.id, 'unassign', 'lift');
    expect(store.projectMap().get(b.id)!.parentId).toBeNull();
    expect(store.getTask(bt.id)!.statusId).toBe(qa.id);
    expect(store.projectMap().get(c.id)!.parentId).toBe(b.id);
    store.undo();
    // delete: a, b and c go; their tasks are unassigned and fall back to the default workflow
    const subtreeTasks = store
      .tasks()
      .filter((t) => [a.id, b.id, c.id].includes(t.projectId ?? ''))
      .map((t) => t.id);
    store.deleteProject(a.id, 'unassign', 'delete');
    expect(store.projects().some((p) => [a.id, b.id, c.id].includes(p.id))).toBe(false);
    expect(subtreeTasks.every((id) => store.getTask(id)!.projectId === null)).toBe(true);
    expect(store.getTask(bt.id)!.statusId).toBe('in_progress');
  });

  it('does not record settings changes in undo history', () => {
    const before = store.canUndo();
    store.updateSettings({ pageSize: 50 });
    expect(store.settings().pageSize).toBe(50);
    expect(store.canUndo()).toBe(before);
  });
});

describe('StoreService with data saved before members existed', () => {
  it('loads it and fills in defaults', () => {
    const legacy = {
      tasks: [
        {
          id: 't1',
          title: 'Old task',
          description: '',
          status: 'todo',
          priority: 'low',
          projectId: null,
          tags: [],
          dueDate: null,
          estimateMinutes: null,
          timeSpentMinutes: 0,
          subtasks: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          completedAt: null,
          order: 0,
        },
      ],
      projects: [],
      settings: { theme: 'dark', pomodoroMinutes: 25, pageSize: 25 },
    };
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    TestBed.resetTestingModule();
    const store = TestBed.inject(StoreService);
    store.init(null);
    expect(store.tasks()).toHaveLength(1);
    expect(store.getTask('t1')).toMatchObject({ assigneeId: null, recurrence: 'none' });
    expect(store.members()).toEqual([]);
    expect(store.settings().theme).toBe('dark');
  });
});

describe('StoreService migration from taskpilot:v1', () => {
  it('loads v1 data from the old key and saves it as v2', () => {
    localStorage.clear();
    const v1 = {
      tasks: [
        {
          id: 't1',
          title: 'Old',
          description: '',
          status: 'in_progress',
          priority: 'low',
          projectId: 'p1',
          tags: [],
          dueDate: null,
          estimateMinutes: null,
          timeSpentMinutes: 0,
          subtasks: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          completedAt: null,
          order: 0,
        },
      ],
      projects: [{ id: 'p1', name: 'P', color: '#6366f1', createdAt: '2026-01-01T00:00:00.000Z' }],
      settings: { theme: 'light', pomodoroMinutes: 25, pageSize: 25 },
    };
    localStorage.setItem('taskpilot:v1', JSON.stringify(v1));
    TestBed.resetTestingModule();
    const store = TestBed.inject(StoreService);
    store.init(null);
    expect(store.getTask('t1')).toMatchObject({ statusId: 'in_progress', status: 'in_progress' });
    expect(store.projects()[0]).toMatchObject({ parentId: null, workflow: null });
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(STORAGE_KEY).toBe('taskpilot:v2');
    expect(saved.version).toBe(2);
    expect(saved.tasks[0].statusId).toBe('in_progress');
    expect(localStorage.getItem('taskpilot:v1')).not.toBeNull(); // kept as a backup
  });
});

describe('ToastService', () => {
  it('shows, runs action and dismisses toasts', () => {
    const svc = TestBed.inject(ToastService);
    let ran = false;
    const id = svc.show('Deleted', { actionLabel: 'Undo', action: () => (ran = true) });
    expect(svc.toasts()).toHaveLength(1);
    svc.runAction(svc.toasts()[0]);
    expect(ran).toBe(true);
    expect(svc.toasts().some((t) => t.id === id)).toBe(false);
  });
});
