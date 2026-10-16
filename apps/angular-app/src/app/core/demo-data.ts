import {
  AppState,
  DEFAULT_SETTINGS,
  Member,
  Priority,
  Project,
  SCHEMA_VERSION,
  Status,
  Subtask,
  Task,
} from './models';
import { addDays, toDateKey } from './dates';

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROJECT_NAMES = [
  'Website',
  'Mobile App',
  'Marketing',
  'Infrastructure',
  'Hiring',
  'Personal',
];
const PROJECT_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
export const TAGS = [
  'bug',
  'feature',
  'chore',
  'research',
  'design',
  'backend',
  'frontend',
  'urgent-fix',
  'meeting',
  'docs',
];
const VERBS = [
  'Fix',
  'Build',
  'Review',
  'Write',
  'Design',
  'Refactor',
  'Test',
  'Plan',
  'Deploy',
  'Research',
];
const NOUNS = [
  'login flow',
  'dashboard',
  'API docs',
  'onboarding',
  'landing page',
  'CI pipeline',
  'invoice export',
  'search',
  'settings page',
  'release notes',
];
export const DEMO_MEMBERS: readonly Member[] = [
  { id: 'm1', name: 'Alex Kim', color: '#0ea5e9' },
  { id: 'm2', name: 'Sam Rivera', color: '#f97316' },
  { id: 'm3', name: 'Jordan Lee', color: '#22c55e' },
  { id: 'm4', name: 'Taylor Brooks', color: '#a855f7' },
  { id: 'm5', name: 'Morgan Patel', color: '#ef4444' },
];
/** Seed of the second PRNG. Kept separate so the original (seed 42) sequence is untouched. */
const MEMBER_SEED = 7;
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
const ESTIMATES = [15, 30, 60, 120, 240];

/**
 * Deterministic demo data. The original fields come from `mulberry32(42)` exactly as before;
 * assignee and recurrence are drawn afterwards from a second PRNG (`mulberry32(7)`), two draws
 * per task in order, so adding them did not change any pre-existing value.
 * `now` is injectable for tests.
 */
export function generateDemoData(count: number, now: Date = new Date()): AppState {
  const r = mulberry32(42);
  const nowMs = now.getTime();
  const projects: Project[] = PROJECT_NAMES.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    color: PROJECT_COLORS[i],
    createdAt: addDays(now, -90).toISOString(),
    parentId: null,
    workflow: null,
  }));
  const orderCounters: Record<Status, number> = { todo: 0, in_progress: 0, done: 0 };
  const tasks: Task[] = [];
  for (let i = 0; i < count; i++) {
    const title = `${VERBS[Math.floor(r() * VERBS.length)]} ${NOUNS[Math.floor(r() * NOUNS.length)]} #${i + 1}`;
    const s = r();
    const status: Status = s < 0.45 ? 'done' : s < 0.65 ? 'in_progress' : 'todo';
    const priority = PRIORITIES[Math.floor(r() * 4)];
    const projectId = r() < 0.1 ? null : projects[Math.floor(r() * 6)].id;
    const n = Math.floor(r() * 4);
    const tags: string[] = [];
    for (let k = 0; k < n; k++) {
      const tag = TAGS[Math.floor(r() * 10)];
      if (!tags.includes(tag)) tags.push(tag);
    }
    const dueDate = r() < 0.15 ? null : toDateKey(addDays(now, Math.floor(r() * 60) - 25));
    const created = addDays(now, -Math.floor(r() * 60));
    let completedAt: string | null = null;
    if (status === 'done') {
      const c = addDays(created, Math.floor(r() * 10));
      completedAt = new Date(Math.min(c.getTime(), nowMs)).toISOString();
    }
    const estimateMinutes = ESTIMATES[Math.floor(r() * 5)];
    const timeSpentMinutes = Math.floor(r() * 180);
    const subCount = Math.floor(r() * 4);
    const subtasks: Subtask[] = [];
    for (let k = 0; k < subCount; k++) {
      subtasks.push({ id: `t${i + 1}-s${k + 1}`, title: `Step ${k + 1}`, done: r() < 0.5 });
    }
    tasks.push({
      id: `t${i + 1}`,
      title,
      description: `Demo task ${i + 1}`,
      // the default workflow's status ids equal the category names
      statusId: status,
      status,
      priority,
      projectId,
      assigneeId: null,
      recurrence: 'none',
      tags,
      dueDate,
      estimateMinutes,
      timeSpentMinutes,
      subtasks,
      blockedBy: [],
      comments: [],
      createdAt: created.toISOString(),
      completedAt,
      order: orderCounters[status]++,
    });
  }
  const members = DEMO_MEMBERS.map((m) => ({ ...m }));
  const r2 = mulberry32(MEMBER_SEED);
  for (const task of tasks) {
    const k = Math.floor(r2() * 6);
    task.assigneeId = k === 5 ? null : members[k].id;
    task.recurrence = r2() < 0.1 ? 'weekly' : 'none';
  }
  return {
    version: SCHEMA_VERSION,
    tasks,
    projects,
    members,
    activity: [],
    views: [],
    notifications: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}
