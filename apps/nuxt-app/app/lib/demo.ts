import type { AppState, Member, Priority, Project, Recurrence, Status, Subtask, Task } from './types';
import { DEFAULT_SETTINGS } from './types';
import { addDays, startOfDay, toISODate } from './dates';

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_PROJECTS: ReadonlyArray<readonly [string, string]> = [
  ['Website', '#6366f1'],
  ['Mobile App', '#ec4899'],
  ['Marketing', '#f59e0b'],
  ['Infrastructure', '#10b981'],
  ['Hiring', '#3b82f6'],
  ['Personal', '#8b5cf6'],
];
export const DEMO_MEMBERS: ReadonlyArray<readonly [string, string]> = [
  ['Alex Kim', '#0ea5e9'],
  ['Sam Rivera', '#f97316'],
  ['Jordan Lee', '#22c55e'],
  ['Taylor Brooks', '#a855f7'],
  ['Morgan Patel', '#ef4444'],
];
export const TAGS = ['bug', 'feature', 'chore', 'research', 'design', 'backend', 'frontend', 'urgent-fix', 'meeting', 'docs'];
const VERBS = ['Fix', 'Build', 'Review', 'Write', 'Design', 'Refactor', 'Test', 'Plan', 'Deploy', 'Research'];
const NOUNS = ['login flow', 'dashboard', 'API docs', 'onboarding', 'landing page', 'CI pipeline', 'invoice export', 'search', 'settings page', 'release notes'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
const ESTIMATES = [15, 30, 60, 120, 240];
const DAY = 86400000;

/**
 * Assignees and recurrence come from a *separate* PRNG (seed 7) so the seed-42 stream, and with it every
 * pre-existing field of the generated tasks, stays exactly as it was before members existed.
 * Per task, in order: k = floor(r()*6) (5 → unassigned, else member k), then r() < 0.1 → weekly.
 */
function assignDemoMembers(tasks: Task[], members: readonly Member[]): void {
  const r = mulberry32(7);
  for (const t of tasks) {
    const k = Math.floor(r() * 6);
    t.assigneeId = k === 5 ? null : (members[k] as Member).id;
    t.recurrence = (r() < 0.1 ? 'weekly' : 'none') satisfies Recurrence;
  }
}

/** Deterministic demo data (seed 42). `now` is injectable for tests. */
export function generateDemoData(count: number, now: Date = new Date()): AppState {
  const r = mulberry32(42);
  const today = startOfDay(now);
  const nowMs = now.getTime();
  const nowISO = now.toISOString();
  const projects: Project[] = DEMO_PROJECTS.map(([name, color], i) => ({ id: `p${i + 1}`, name, color, createdAt: nowISO, parentId: null, workflow: null }));
  const tasks: Task[] = [];
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)] as T;

  for (let i = 0; i < count; i++) {
    const title = `${pick(VERBS)} ${pick(NOUNS)} #${i + 1}`;
    const sr = r();
    const status: Status = sr < 0.45 ? 'done' : sr < 0.65 ? 'in_progress' : 'todo';
    const priority = PRIORITIES[Math.floor(r() * 4)] as Priority;
    const projectId = r() < 0.1 ? null : (projects[Math.floor(r() * 6)] as Project).id;
    const n = Math.floor(r() * 4);
    const tags: string[] = [];
    for (let k = 0; k < n; k++) {
      const t = TAGS[Math.floor(r() * 10)] as string;
      if (!tags.includes(t)) tags.push(t);
    }
    const dueDate = r() < 0.15 ? null : toISODate(addDays(today, Math.floor(r() * 60) - 25));
    const createdMs = nowMs - Math.floor(r() * 60) * DAY;
    let completedAt: string | null = null;
    if (status === 'done') {
      completedAt = new Date(Math.min(createdMs + Math.floor(r() * 10) * DAY, nowMs)).toISOString();
    }
    const estimateMinutes = ESTIMATES[Math.floor(r() * 5)] as number;
    const timeSpentMinutes = Math.floor(r() * 180);
    const sc = Math.floor(r() * 4);
    const subtasks: Subtask[] = [];
    for (let k = 0; k < sc; k++) subtasks.push({ id: `t${i + 1}-s${k + 1}`, title: `Step ${k + 1}`, done: r() < 0.5 });
    tasks.push({
      id: `t${i + 1}`,
      title,
      description: `Demo task ${i + 1}`,
      // default workflow: status ids equal the categories
      statusId: status,
      status,
      priority,
      projectId,
      tags,
      dueDate,
      estimateMinutes,
      timeSpentMinutes,
      subtasks,
      createdAt: new Date(createdMs).toISOString(),
      completedAt,
      order: i,
      assigneeId: null,
      recurrence: 'none',
      blockedBy: [],
      comments: [],
    });
  }
  const members: Member[] = DEMO_MEMBERS.map(([name, color], i) => ({ id: `m${i + 1}`, name, color }));
  assignDemoMembers(tasks, members);
  return { tasks, projects, members, activity: [], views: [], notifications: [], settings: { ...DEFAULT_SETTINGS } };
}
