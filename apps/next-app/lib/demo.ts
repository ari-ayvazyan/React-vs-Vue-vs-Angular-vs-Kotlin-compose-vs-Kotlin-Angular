import { addDays, toDateKey } from './dates';
import { DEFAULT_SETTINGS, type AppState, type Member, type Priority, type Project, type Status, type Task } from './types';

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROJECT_NAMES = ['Website', 'Mobile App', 'Marketing', 'Infrastructure', 'Hiring', 'Personal'];
const PROJECT_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
export const DEMO_TAGS = ['bug', 'feature', 'chore', 'research', 'design', 'backend', 'frontend', 'urgent-fix', 'meeting', 'docs'];
const VERBS = ['Fix', 'Build', 'Review', 'Write', 'Design', 'Refactor', 'Test', 'Plan', 'Deploy', 'Research'];
const NOUNS = ['login flow', 'dashboard', 'API docs', 'onboarding', 'landing page', 'CI pipeline', 'invoice export', 'search', 'settings page', 'release notes'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
const ESTIMATES = [15, 30, 60, 120, 240];
const DAY_MS = 86_400_000;
const MEMBER_NAMES = ['Alex Kim', 'Sam Rivera', 'Jordan Lee', 'Taylor Brooks', 'Morgan Patel'];
const MEMBER_COLORS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444'];

/**
 * Deterministic demo data (seed 42). `now` is injectable for tests.
 * Assignees and recurrence come from a second, independent PRNG (seed 7) so the original
 * task fields stay byte-for-byte identical to the pre-members generator.
 */
export function generateDemoData(count: number, now: Date = new Date()): AppState {
  const r = mulberry32(42);
  const r2 = mulberry32(7);
  const nowMs = now.getTime();
  const today = toDateKey(now);
  const projects: Project[] = PROJECT_NAMES.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    color: PROJECT_COLORS[i],
    createdAt: new Date(nowMs - 90 * DAY_MS).toISOString(),
    parentId: null,
    workflow: null,
  }));
  const members: Member[] = MEMBER_NAMES.map((name, i) => ({ id: `m${i + 1}`, name, color: MEMBER_COLORS[i] }));
  const orderCounters: Record<Status, number> = { todo: 0, in_progress: 0, done: 0 };
  const tasks: Task[] = [];

  for (let i = 0; i < count; i++) {
    const title = `${VERBS[Math.floor(r() * VERBS.length)]} ${NOUNS[Math.floor(r() * NOUNS.length)]} #${i + 1}`;
    const sr = r();
    const status: Status = sr < 0.45 ? 'done' : sr < 0.65 ? 'in_progress' : 'todo';
    const priority = PRIORITIES[Math.floor(r() * 4)];
    const projectId = r() < 0.1 ? null : projects[Math.floor(r() * 6)].id;
    const n = Math.floor(r() * 4);
    const tags: string[] = [];
    for (let k = 0; k < n; k++) {
      const tag = DEMO_TAGS[Math.floor(r() * 10)];
      if (!tags.includes(tag)) tags.push(tag);
    }
    const dueDate = r() < 0.15 ? null : addDays(today, Math.floor(r() * 60) - 25);
    const createdMs = nowMs - Math.floor(r() * 60) * DAY_MS;
    const completedAt =
      status === 'done' ? new Date(Math.min(createdMs + Math.floor(r() * 10) * DAY_MS, nowMs)).toISOString() : null;
    const estimateMinutes = ESTIMATES[Math.floor(r() * 5)];
    const timeSpentMinutes = Math.floor(r() * 180);
    const ns = Math.floor(r() * 4);
    const subtasks = Array.from({ length: ns }, (_, j) => ({ id: `t${i + 1}-s${j + 1}`, title: `Step ${j + 1}`, done: r() < 0.5 }));
    const k = Math.floor(r2() * 6);
    const assigneeId = k === 5 ? null : members[k].id;
    const recurrence = r2() < 0.1 ? 'weekly' : 'none';

    tasks.push({
      id: `t${i + 1}`,
      title,
      description: `Demo task ${i + 1}`,
      // Default workflow: status ids equal the category names.
      statusId: status,
      category: status,
      priority,
      projectId,
      tags,
      dueDate,
      estimateMinutes,
      timeSpentMinutes,
      subtasks,
      createdAt: new Date(createdMs).toISOString(),
      completedAt,
      order: orderCounters[status]++,
      assigneeId,
      recurrence,
      blockedBy: [],
      comments: [],
    });
  }
  return { tasks, projects, members, activity: [], views: [], notifications: [], settings: { ...DEFAULT_SETTINGS } };
}
