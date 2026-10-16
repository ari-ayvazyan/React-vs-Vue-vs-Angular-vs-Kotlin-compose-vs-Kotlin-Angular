'use client';

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { formatShort, relativeDue } from '@/lib/dates';
import {
  completedPerDay,
  computeKpis,
  openByPriority,
  openPerAssignee,
  overdueTasks,
  productivityStreak,
  projectProgress,
  upcomingDeadlines,
} from '@/lib/stats';
import type { Project, Task } from '@/lib/types';
import { projectTree } from '@/lib/workflow';
import { PageSkeleton, PriorityBadge } from '../bits';
import { AssigneeBars, CompletedAreaChart, PriorityDonut, ProjectBars } from '../charts';
import { IconAlert, IconCalendar, IconCheck, IconClock, IconFlame, IconList } from '../icons';
import { useAppState, useToday } from '../store-hooks';
import styles from './dashboard.module.css';

function Kpi({ label, value, testId, icon, tone, sub }: { label: string; value: ReactNode; testId: string; icon: ReactNode; tone: string; sub?: string }) {
  return (
    <div className={`card ${styles.kpi}`}>
      <div className={styles.kpiTop}>
        <span className={styles.kpiLabel}>{label}</span>
        <span className={`${styles.kpiIcon} ${styles[tone]}`} aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className={styles.kpiValue} data-testid={testId}>
        {value}
      </p>
      {sub && <p className={styles.kpiSub}>{sub}</p>}
    </div>
  );
}

function TaskMiniList({ tasks, projects, today, empty }: { tasks: Task[]; projects: Map<string, Project>; today: string; empty: string }) {
  if (!tasks.length) return <p className={styles.emptyList}>{empty}</p>;
  return (
    <ul className={styles.miniList}>
      {tasks.map((t) => {
        const p = t.projectId ? projects.get(t.projectId) : undefined;
        const overdue = t.dueDate! < today;
        return (
          <li key={t.id}>
            <Link href={`/tasks/${t.id}`} className={styles.miniItem}>
              <span className="dot" style={{ background: p?.color ?? 'var(--border-strong)' }} aria-hidden="true" />
              <span className={styles.miniTitle}>{t.title}</span>
              <PriorityBadge priority={t.priority} />
              <time dateTime={t.dueDate!} className={`${styles.miniDue} ${overdue ? 'overdue-text' : ''}`}>
                {relativeDue(t.dueDate!, today)}
              </time>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function DashboardView() {
  const state = useAppState();
  const today = useToday();
  const tasks = state?.tasks;
  const projects = state?.projects;
  const members = state?.members;

  const data = useMemo(() => {
    if (!tasks || !projects || !members || !today) return null;
    return {
      kpis: computeKpis(tasks, today),
      series: completedPerDay(tasks, today, 30),
      byPriority: openByPriority(tasks),
      // Tree order; each project's numbers include its sub-projects.
      progress: (() => {
        const rows = new Map(projectProgress(tasks, projects).map((r) => [r.project.id, r]));
        return projectTree(projects).map(({ project, depth }) => ({ ...rows.get(project.id)!, depth }));
      })(),
      byAssignee: openPerAssignee(tasks, members),
      streak: productivityStreak(tasks, today),
      upcoming: upcomingDeadlines(tasks, today, 7, 8),
      overdue: overdueTasks(tasks, today),
      projectMap: new Map(projects.map((p) => [p.id, p])),
    };
  }, [tasks, projects, members, today]);

  if (!data) return <PageSkeleton title="Dashboard" />;
  const { kpis } = data;

  return (
    <div className={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Your progress at a glance · {formatShort(today)}</p>
        </div>
        <div className={styles.streak} title="Consecutive days with at least one completed task">
          <span className={styles.streakIcon} aria-hidden="true">
            <IconFlame size={18} />
          </span>
          <div>
            <strong>
              {data.streak} day{data.streak === 1 ? '' : 's'}
            </strong>
            <span>productivity streak</span>
          </div>
        </div>
      </div>

      <section className={styles.kpis} aria-label="Key metrics">
        <Kpi label="Total tasks" value={kpis.total} testId="kpi-total" icon={<IconList size={16} />} tone="indigo" />
        <Kpi label="Open" value={kpis.open} testId="kpi-open" icon={<IconCalendar size={16} />} tone="blue" />
        <Kpi label="Overdue" value={kpis.overdue} testId="kpi-overdue" icon={<IconAlert size={16} />} tone="red" />
        <Kpi label="Completed · 7d" value={kpis.completed7d} testId="kpi-completed-7d" icon={<IconCheck size={16} />} tone="green" />
        <Kpi label="Completion rate" value={`${kpis.completionRate}%`} testId="kpi-completion-rate" icon={<IconCheck size={16} />} tone="violet" />
        <Kpi label="Hours tracked" value={kpis.hoursTracked.toLocaleString('en-US')} testId="kpi-hours" icon={<IconClock size={16} />} tone="amber" sub="h total" />
      </section>

      <div className={styles.grid}>
        <section className={`card ${styles.panel} ${styles.wide}`} data-testid="chart-completed" aria-labelledby="chart-completed-title">
          <div className={styles.panelHead}>
            <h2 id="chart-completed-title" className="section-title">
              Completed per day
            </h2>
            <span className="muted">Last 30 days · {data.series.reduce((s, d) => s + d.count, 0)} tasks</span>
          </div>
          <CompletedAreaChart data={data.series} />
        </section>

        <section className={`card ${styles.panel}`} data-testid="chart-priority" aria-labelledby="chart-priority-title">
          <div className={styles.panelHead}>
            <h2 id="chart-priority-title" className="section-title">
              Open tasks by priority
            </h2>
          </div>
          <PriorityDonut counts={data.byPriority} />
        </section>

        <section className={`card ${styles.panel}`} data-testid="chart-projects" aria-labelledby="chart-projects-title">
          <div className={styles.panelHead}>
            <h2 id="chart-projects-title" className="section-title">
              Project completion
            </h2>
            <Link href="/projects" className="link">
              Manage
            </Link>
          </div>
          <ProjectBars rows={data.progress} />
        </section>

        <section className={`card ${styles.panel}`} data-testid="chart-assignees" aria-labelledby="chart-assignees-title">
          <div className={styles.panelHead}>
            <h2 id="chart-assignees-title" className="section-title">
              Open tasks per assignee
            </h2>
            <Link href="/settings#members" className="link">
              Manage
            </Link>
          </div>
          <AssigneeBars rows={data.byAssignee} />
        </section>

        <section className={`card ${styles.panel}`} aria-labelledby="upcoming-title">
          <div className={styles.panelHead}>
            <h2 id="upcoming-title" className="section-title">
              Upcoming deadlines
            </h2>
            <span className="muted">Next 7 days</span>
          </div>
          <TaskMiniList tasks={data.upcoming} projects={data.projectMap} today={today} empty="Nothing due in the next 7 days." />
        </section>

        <section className={`card ${styles.panel}`} aria-labelledby="overdue-title">
          <div className={styles.panelHead}>
            <h2 id="overdue-title" className="section-title">
              Overdue <span className={styles.count}>{data.overdue.length}</span>
            </h2>
            {data.overdue.length > 8 && (
              <Link href="/tasks?due=overdue" className="link">
                View all
              </Link>
            )}
          </div>
          <TaskMiniList tasks={data.overdue.slice(0, 8)} projects={data.projectMap} today={today} empty="No overdue tasks. Nice work!" />
        </section>
      </div>
    </div>
  );
}
