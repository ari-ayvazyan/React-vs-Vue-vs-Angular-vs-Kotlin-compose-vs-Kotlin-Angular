<script setup lang="ts">
import type { BarRow, ColumnDatum } from '~/lib/chartTypes';
import { PRIORITIES, PRIORITY_LABELS } from '~/lib/types';
import { burndown, cycleTimeByPriority, workloadByAssignee } from '~/lib/stats';
import { useTaskStore } from '~/stores/tasks';

useHead({ title: 'Reports · TaskPilot' });

const store = useTaskStore();
const route = useRoute();
const router = useRouter();

// ----- burndown (project in the URL: ?project=) -----
const project = computed(() => {
  const p = typeof route.query.project === 'string' ? route.query.project : '';
  return p === 'none' || store.projectById.has(p) ? p : '';
});
const projectName = computed(() => (project.value === 'none' ? 'No project' : project.value ? (store.projectById.get(project.value)?.name ?? '') : 'All projects'));
function setProject(e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  void router.replace({ path: '/reports', query: v ? { project: v } : {} });
}
// a project includes its sub-projects
const series = computed(() => burndown(store.tasks, store.today, project.value, 30, store.projectScope));
const first = computed(() => series.value[0]?.count ?? 0);
const last = computed(() => series.value[series.value.length - 1]?.count ?? 0);
const change = computed(() => last.value - first.value);
const burndownSummary = computed(
  () => `Open tasks per day in ${projectName.value}, last 30 days: ${first.value} at the start, ${last.value} today (${change.value > 0 ? '+' : ''}${change.value}).`,
);

// ----- workload -----
const workload = computed(() => workloadByAssignee(store.members, store.tasks).filter((w) => w.member || w.open > 0));
const hours = (min: number): string => `${(Math.round((min / 60) * 10) / 10).toLocaleString('en-US')} h`;
const workloadBars = computed<BarRow[]>(() => {
  const max = Math.max(1, ...workload.value.map((w) => w.minutes));
  return workload.value.map((w) => {
    const name = w.member?.name ?? 'Unassigned';
    const detail = `${w.open} open${w.unestimated ? ` · ${w.unestimated} without estimate` : ''}`;
    return {
      key: w.member?.id ?? 'none',
      label: name,
      percent: Math.round((w.minutes / max) * 100),
      color: w.member?.color ?? 'var(--text-subtle)',
      detail,
      valueText: hours(w.minutes),
      ariaText: `${name}: ${hours(w.minutes)} estimated across ${detail}`,
      to: `/tasks?assignee=${w.member?.id ?? 'none'}&status=todo,in_progress`,
    };
  });
});
const totalMinutes = computed(() => workload.value.reduce((n, w) => n + w.minutes, 0));

// ----- cycle time -----
const PRIORITY_COLORS = { low: 'var(--p-low)', medium: 'var(--p-medium)', high: 'var(--p-high)', urgent: 'var(--p-urgent)' } as const;
const cycle = computed(() => cycleTimeByPriority(store.tasks));
const cycleColumns = computed<ColumnDatum[]>(() =>
  PRIORITIES.map((p) => ({
    key: p,
    label: PRIORITY_LABELS[p],
    value: cycle.value[p].avgDays,
    color: PRIORITY_COLORS[p],
    detail: `${cycle.value[p].count} done`,
  })),
);
const overallCycle = computed(() => {
  let sum = 0;
  let n = 0;
  for (const p of PRIORITIES) {
    const c = cycle.value[p];
    if (c.avgDays !== null) {
      sum += c.avgDays * c.count;
      n += c.count;
    }
  }
  return n ? Math.round((sum / n) * 10) / 10 : null;
});
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">Reports</h1>
        <p class="page-subtitle">Progress, workload and cycle time.</p>
      </div>
    </div>

    <PageLoading v-if="!store.ready" :rows="6" />
    <div v-else class="grid">
      <section class="card span-2" aria-labelledby="r-burndown">
        <div class="card-header">
          <div>
            <h2 id="r-burndown" class="card-title">Burndown</h2>
            <p class="muted small">Open tasks at the end of each day, last 30 days</p>
          </div>
          <div class="field proj">
            <label for="burndown-project" class="sr-only">Project</label>
            <select id="burndown-project" class="select" :value="project" data-testid="burndown-project" @change="setProject">
              <option value="">All projects</option>
              <option v-for="p in store.projectOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
              <option value="none">No project</option>
            </select>
          </div>
        </div>
        <div class="card-body" data-testid="chart-burndown">
          <div class="stats">
            <span><strong>{{ last }}</strong> open now</span>
            <span><strong>{{ first }}</strong> 30 days ago</span>
            <span :class="change > 0 ? 'up' : change < 0 ? 'down' : ''"><strong>{{ change > 0 ? '+' : '' }}{{ change }}</strong> change</span>
          </div>
          <ChartsLineChart :data="series" :label="`Open tasks per day – ${projectName}`" value-label="open" :summary-text="burndownSummary" />
        </div>
      </section>

      <section class="card" aria-labelledby="r-workload">
        <div class="card-header">
          <div>
            <h2 id="r-workload" class="card-title">Workload per assignee</h2>
            <p class="muted small">Estimated hours of open tasks · {{ hours(totalMinutes) }} total</p>
          </div>
        </div>
        <div class="card-body" data-testid="chart-workload">
          <ChartsBarChart :rows="workloadBars" label="Estimated hours of open tasks per assignee" empty-text="No open tasks." />
        </div>
      </section>

      <section class="card" aria-labelledby="r-cycle">
        <div class="card-header">
          <div>
            <h2 id="r-cycle" class="card-title">Average cycle time</h2>
            <p class="muted small">Days from created to completed, by priority<template v-if="overallCycle !== null"> · {{ overallCycle }} days overall</template></p>
          </div>
        </div>
        <div class="card-body" data-testid="chart-cycle-time">
          <ChartsColumnChart :columns="cycleColumns" label="Average cycle time in days by priority" unit="days" />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.span-2 {
  grid-column: 1 / -1;
}

.small {
  font-size: 12.5px;
  margin: 2px 0 0;
}

.proj {
  width: 200px;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  margin-bottom: 8px;
  color: var(--text-muted);
  font-size: 13px;
}

.stats strong {
  color: var(--text);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.stats .up strong {
  color: var(--danger);
}

.stats .down strong {
  color: var(--success);
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 767px) {
  .proj {
    width: 150px;
  }
}
</style>
