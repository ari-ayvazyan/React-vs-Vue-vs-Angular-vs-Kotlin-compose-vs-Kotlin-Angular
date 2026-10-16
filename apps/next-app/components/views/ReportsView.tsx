'use client';

import { useMemo, useState } from 'react';
import { NO_PROJECT } from '@/lib/filters';
import { burndown, cycleTimeByPriority, workload } from '@/lib/reports';
import { projectTree, treeLabel } from '@/lib/workflow';
import { PageSkeleton } from '../bits';
import { AreaChart, CycleTimeBars, MemberBars } from '../charts';
import { useAppState, useToday } from '../store-hooks';
import styles from './reports.module.css';

const DAYS = 30;

export function ReportsView() {
  const state = useAppState();
  const today = useToday();
  /** '' = all projects */
  const [project, setProject] = useState('');

  const tasks = state?.tasks;
  const members = state?.members;
  const projects = state?.projects;
  const series = useMemo(() => (tasks && today ? burndown(tasks, project || null, today, DAYS, projects) : []), [tasks, project, today, projects]);
  const tree = useMemo(() => projectTree(projects ?? []), [projects]);
  const load = useMemo(() => (tasks && members ? workload(tasks, members) : []), [tasks, members]);
  const cycle = useMemo(() => (tasks ? cycleTimeByPriority(tasks) : []), [tasks]);

  if (!state || !today) return <PageSkeleton title="Reports" rows={3} />;

  const projectName = project === '' ? 'All projects' : project === NO_PROJECT ? 'No project' : (state.projects.find((p) => p.id === project)?.name ?? 'Unknown project');
  const first = series[0]?.value ?? 0;
  const last = series.at(-1)?.value ?? 0;
  const change = last - first;
  const totalHours = Math.round(load.reduce((s, r) => s + r.hours, 0) * 10) / 10;
  const unestimated = load.reduce((s, r) => s + r.unestimated, 0);
  const completed = cycle.reduce((s, r) => s + r.count, 0);

  return (
    <div className={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Progress, workload and speed, computed from your tasks.</p>
        </div>
      </div>

      <section className={`card ${styles.panel}`} aria-labelledby="burndown-title" data-testid="report-burndown">
        <div className={styles.panelHead}>
          <div>
            <h2 id="burndown-title" className="section-title">
              Burndown · {projectName}
            </h2>
            <p className="muted">
              Open tasks at the end of each day (sub-projects included), last {DAYS} days · {last} open now ({change === 0 ? 'no change' : `${change > 0 ? '+' : '−'}${Math.abs(change)}`} since{' '}
              {DAYS} days ago)
            </p>
          </div>
          <div className="field">
            <label htmlFor="burndown-project" className="sr-only">
              Project
            </label>
            <select id="burndown-project" className="select" value={project} onChange={(e) => setProject(e.target.value)} data-testid="burndown-project">
              <option value="">All projects</option>
              {tree.map((row) => (
                <option key={row.project.id} value={row.project.id}>
                  {treeLabel(row)}
                </option>
              ))}
              <option value={NO_PROJECT}>No project</option>
            </select>
          </div>
        </div>
        <AreaChart data={series} unit="open" label={`Open tasks per day for ${projectName}, last ${DAYS} days: ${first} → ${last}.`} testId="chart-burndown" />
      </section>

      <div className={styles.grid}>
        <section className={`card ${styles.panel}`} aria-labelledby="workload-title" data-testid="report-workload">
          <div className={styles.panelHead}>
            <div>
              <h2 id="workload-title" className="section-title">
                Workload per assignee
              </h2>
              <p className="muted">
                Estimated hours of open tasks · {totalHours} h total
                {unestimated > 0 && ` · ${unestimated} open task${unestimated === 1 ? '' : 's'} without an estimate not counted`}
              </p>
            </div>
          </div>
          <MemberBars
            testId="chart-workload"
            label={`Estimated open work per assignee, ${totalHours} hours in total`}
            empty="No team members yet. Add some in Settings."
            rows={load.map((r) => {
              const name = r.member ? r.member.name : 'Unassigned';
              return {
                member: r.member,
                value: r.hours,
                valueLabel: `${r.hours} h`,
                label: `${name}: ${r.hours} hours across ${r.open} open tasks`,
                tip: `${r.hours} h estimated`,
                tipSub: `${name} · ${r.open} open${r.unestimated ? ` · ${r.unestimated} without estimate` : ''}`,
              };
            })}
          />
        </section>

        <section className={`card ${styles.panel}`} aria-labelledby="cycle-title" data-testid="report-cycle-time">
          <div className={styles.panelHead}>
            <div>
              <h2 id="cycle-title" className="section-title">
                Average cycle time by priority
              </h2>
              <p className="muted">Days from creation to completion · {completed} completed tasks</p>
            </div>
          </div>
          <CycleTimeBars rows={cycle} testId="chart-cycle-time" />
        </section>
      </div>
    </div>
  );
}
