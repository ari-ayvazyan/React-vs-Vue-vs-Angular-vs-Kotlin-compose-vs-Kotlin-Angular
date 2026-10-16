<script setup lang="ts">
import { PRIORITIES, PRIORITY_LABELS } from '~/lib/types';
import type { BarRow, DonutSlice } from '~/lib/chartTypes';
import { completedPerDay, computeKpis, openByAssignee, openByPriority, overdueTasks, productivityStreak, projectProgress, upcomingDeadlines } from '~/lib/stats';
import { useTaskStore } from '~/stores/tasks';

useHead({ title: 'Dashboard · TaskPilot' });
const store = useTaskStore();
const NuxtLinkComp = resolveComponent('NuxtLink');

const kpis = computed(() => computeKpis(store.tasks, store.today));
const perDay = computed(() => completedPerDay(store.tasks, store.today, 30));
const streak = computed(() => productivityStreak(store.tasks, store.today));
const upcoming = computed(() => upcomingDeadlines(store.tasks, store.today, 7, 8));
const overdue = computed(() => overdueTasks(store.tasks, store.today, 8));

const PRIORITY_COLORS = { low: 'var(--p-low)', medium: 'var(--p-medium)', high: 'var(--p-high)', urgent: 'var(--p-urgent)' } as const;
const donut = computed<DonutSlice[]>(() => {
  const counts = openByPriority(store.tasks);
  return [...PRIORITIES].reverse().map((p) => ({ key: p, label: PRIORITY_LABELS[p], value: counts[p], color: PRIORITY_COLORS[p] }));
});

const bars = computed<BarRow[]>(() =>
  projectProgress(store.projects, store.tasks)
    .sort((a, b) => b.percent - a.percent || b.total - a.total)
    .map((p) => ({
      key: p.project.id,
      label: p.project.name,
      percent: p.percent,
      color: p.project.color,
      detail: `${p.done}/${p.total} done`,
      to: `/tasks?project=${p.project.id}`,
    })),
);

/** Open tasks per member (member order) plus "Unassigned"; bar length is relative to the busiest row. */
const assigneeBars = computed<BarRow[]>(() => {
  const loads = openByAssignee(store.members, store.tasks);
  const max = Math.max(1, ...loads.map((l) => l.open));
  const totalOpen = loads.reduce((n, l) => n + l.open, 0);
  return loads
    .filter((l) => l.member || l.open > 0)
    .map(({ member, open }) => {
      const label = member ? member.name : 'Unassigned';
      const share = `${totalOpen ? Math.round((open / totalOpen) * 100) : 0}% of open`;
      return {
        key: member?.id ?? 'none',
        label,
        percent: Math.round((open / max) * 100),
        color: member ? member.color : 'var(--text-subtle)',
        detail: share,
        valueText: open.toLocaleString('en-US'),
        ariaText: `${label}: ${open} open task${open === 1 ? '' : 's'} (${share})`,
        to: `/tasks?assignee=${member?.id ?? 'none'}&status=todo,in_progress`,
      };
    });
});

const tiles = computed(() => [
  { id: 'kpi-total', label: 'Total tasks', value: kpis.value.total.toLocaleString('en-US'), hint: `${store.projects.length} projects`, tone: 'accent' },
  { id: 'kpi-open', label: 'Open tasks', value: kpis.value.open.toLocaleString('en-US'), hint: 'To do + in progress', tone: 'blue' },
  { id: 'kpi-overdue', label: 'Overdue', value: kpis.value.overdue.toLocaleString('en-US'), hint: 'Past due, not done', tone: 'red', to: '/tasks?due=overdue&sort=due&dir=asc' },
  { id: 'kpi-completed-7d', label: 'Completed · 7 days', value: kpis.value.completed7d.toLocaleString('en-US'), hint: `${streak.value}-day streak`, tone: 'green' },
  { id: 'kpi-completion-rate', label: 'Completion rate', value: `${kpis.value.completionRate}%`, hint: 'Done / all tasks', tone: 'violet' },
  { id: 'kpi-hours', label: 'Hours tracked', value: kpis.value.hoursTracked.toLocaleString('en-US'), hint: 'Across all tasks', tone: 'amber' },
]);
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Your workload at a glance.</p>
      </div>
      <div v-if="store.ready" class="streak" :class="{ on: streak > 0 }" :title="'Consecutive days with at least one completed task'">
        <AppIcon name="flame" :size="18" />
        <span><strong>{{ streak }}</strong> day{{ streak === 1 ? '' : 's' }} productivity streak</span>
      </div>
    </div>

    <PageLoading v-if="!store.ready" />
    <template v-else>
      <section class="kpis" aria-label="Key figures">
        <component
          :is="t.to ? NuxtLinkComp : 'div'"
          v-for="t in tiles"
          :key="t.id"
          :to="t.to"
          class="card kpi"
          :class="`tone-${t.tone}`"
        >
          <span class="kpi-label">{{ t.label }}</span>
          <span class="kpi-value" :data-testid="t.id">{{ t.value }}</span>
          <span class="kpi-hint">{{ t.hint }}</span>
        </component>
      </section>

      <section class="grid">
        <div class="card span-2">
          <div class="card-header">
            <h2 class="card-title">Completed per day</h2>
            <span class="muted small">Last 30 days</span>
          </div>
          <div class="card-body" data-testid="chart-completed">
            <ChartsLineChart :data="perDay" label="Tasks completed per day" />
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Open tasks by priority</h2>
          </div>
          <div class="card-body" data-testid="chart-priority">
            <ChartsDonutChart :slices="donut" center-label="open tasks" />
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Project completion</h2>
            <NuxtLink to="/projects" class="small">Manage</NuxtLink>
          </div>
          <div class="card-body" data-testid="chart-projects">
            <ChartsBarChart :rows="bars" label="Completion percentage per project" />
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Open tasks per assignee</h2>
            <NuxtLink to="/settings#team" class="small">Manage</NuxtLink>
          </div>
          <div class="card-body" data-testid="chart-assignees">
            <ChartsBarChart :rows="assigneeBars" label="Open tasks per assignee" empty-text="No open tasks." />
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Upcoming deadlines</h2>
            <span class="muted small">Next 7 days</span>
          </div>
          <ul v-if="upcoming.length" class="tlist">
            <li v-for="t in upcoming" :key="t.id">
              <NuxtLink :to="`/tasks/${t.id}`" class="titem">
                <span class="tname">{{ t.title }}</span>
                <span class="tmeta">
                  <PriorityBadge :priority="t.priority" />
                  <DueLabel :due="t.dueDate" :status="t.status" />
                </span>
              </NuxtLink>
            </li>
          </ul>
          <p v-else class="empty">Nothing due in the next week.</p>
        </div>

        <div class="card span-all">
          <div class="card-header">
            <h2 class="card-title">Overdue</h2>
            <NuxtLink v-if="kpis.overdue" to="/tasks?due=overdue&sort=due&dir=asc" class="small">View all {{ kpis.overdue }}</NuxtLink>
          </div>
          <ul v-if="overdue.length" class="tlist tlist-cols">
            <li v-for="t in overdue" :key="t.id">
              <NuxtLink :to="`/tasks/${t.id}`" class="titem">
                <span class="tname">{{ t.title }}</span>
                <span class="tmeta">
                  <PriorityBadge :priority="t.priority" />
                  <DueLabel :due="t.dueDate" :status="t.status" />
                </span>
              </NuxtLink>
            </li>
          </ul>
          <p v-else class="empty">No overdue tasks. Nice work!</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.small {
  font-size: 12.5px;
}

.streak {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.streak.on {
  background: var(--warning-soft);
  border-color: transparent;
  color: var(--warning);
}

:root[data-theme='dark'] .streak.on {
  color: var(--p-high);
}

.kpis {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.kpi {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 16px 14px;
  color: var(--text);
  text-decoration: none;
  overflow: hidden;
}

.kpi::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--tone);
}

a.kpi:hover {
  text-decoration: none;
  border-color: var(--border-strong);
}

.tone-accent {
  --tone: #6366f1;
}

.tone-blue {
  --tone: #3b82f6;
}

.tone-red {
  --tone: #ef4444;
}

.tone-green {
  --tone: #10b981;
}

.tone-violet {
  --tone: #8b5cf6;
}

.tone-amber {
  --tone: #f59e0b;
}

.kpi-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-muted);
}

.kpi-value {
  font-size: 28px;
  font-weight: 750;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}

.kpi-hint {
  font-size: 12px;
  color: var(--text-subtle);
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.span-2 {
  grid-column: span 2;
}

/* full-width row: keeps the grid free of holes now that there are 7 cards */
.span-all {
  grid-column: 1 / -1;
}

.tlist-cols {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  column-gap: 8px;
}

.tlist-cols > li {
  min-width: 0;
}

.tlist {
  list-style: none;
  margin: 0;
  padding: 8px;
}

.titem {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--text);
  text-decoration: none;
}

.titem:hover {
  background: var(--surface-hover);
  text-decoration: none;
}

.tname {
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tmeta {
  display: flex;
  align-items: center;
  gap: 10px;
}

@media (max-width: 1200px) {
  .kpis {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 767px) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .kpi-value {
    font-size: 23px;
  }

  .grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .span-2 {
    grid-column: auto;
  }
}
</style>
