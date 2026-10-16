<script setup lang="ts">
import { monthGrid, monthParam, parseMonthParam, tasksByDueDate } from '~/lib/calendar';
import { formatDate, parseISODate } from '~/lib/dates';
import { isOverdue, matchesAssignee } from '~/lib/filters';
import { PRIORITY_RANK } from '~/lib/types';
import type { Task } from '~/lib/types';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

useHead({ title: 'Calendar · TaskPilot' });

const store = useTaskStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX = 3;

const assigneeFilter = computed(() => (typeof route.query.assignee === 'string' ? route.query.assignee : ''));

/** Route query for the current filters plus an optional month ('' = current month). */
function calendarQuery(m: string, assignee = assigneeFilter.value): Record<string, string> {
  const q: Record<string, string> = {};
  if (m) q.m = m;
  if (assignee) q.assignee = assignee;
  return q;
}

function setAssignee(e: Event): void {
  void router.replace({ path: '/calendar', query: calendarQuery(typeof route.query.m === 'string' ? route.query.m : '', (e.target as HTMLSelectElement).value) });
}

const ym = computed(() => parseMonthParam(typeof route.query.m === 'string' ? route.query.m : undefined, parseISODate(store.today)));
const title = computed(() => new Date(ym.value.year, ym.value.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
const days = computed(() => monthGrid(ym.value.year, ym.value.month));
const byDate = computed(() => {
  const map = tasksByDueDate(assigneeFilter.value ? store.tasks.filter((t) => matchesAssignee(t, assigneeFilter.value)) : store.tasks);
  for (const list of map.values()) list.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
  return map;
});
const monthCount = computed(() => days.value.filter((d) => d.inMonth).reduce((n, d) => n + (byDate.value.get(d.date)?.length ?? 0), 0));

const expanded = ref<Set<string>>(new Set());
const selected = ref<string | null>(null);

function go(delta: number): void {
  const d = new Date(ym.value.year, ym.value.month + delta, 1);
  expanded.value = new Set();
  void router.push({ path: '/calendar', query: calendarQuery(monthParam(d.getFullYear(), d.getMonth())) });
}

function goToday(): void {
  expanded.value = new Set();
  selected.value = store.today;
  void router.push({ path: '/calendar', query: calendarQuery('') });
}

function toggleExpand(date: string): void {
  const s = new Set(expanded.value);
  if (s.has(date)) s.delete(date);
  else s.add(date);
  expanded.value = s;
}

const tasksFor = (date: string): Task[] => byDate.value.get(date) ?? [];
const visibleFor = (date: string): Task[] => (expanded.value.has(date) ? tasksFor(date) : tasksFor(date).slice(0, MAX));
const projectColor = (t: Task): string => (t.projectId ? (store.projectById.get(t.projectId)?.color ?? 'var(--border-strong)') : 'var(--border-strong)');

const selectedTasks = computed(() => (selected.value ? tasksFor(selected.value) : []));
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">Calendar</h1>
        <p class="page-subtitle" aria-live="polite">
          <template v-if="store.ready">{{ title }} · {{ monthCount }} task{{ monthCount === 1 ? '' : 's' }} due</template>
          <template v-else>Tasks by due date</template>
        </p>
      </div>
      <div class="controls">
        <div class="assignee-filter">
          <label for="cal-assignee" class="sr-only">Assignee</label>
          <select id="cal-assignee" class="select" :value="assigneeFilter" data-testid="calendar-filter-assignee" @change="setAssignee">
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            <option v-for="m in store.members" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>
        <div class="nav">
          <button type="button" class="btn btn-icon" aria-label="Previous month" @click="go(-1)">
            <AppIcon name="chevronLeft" />
          </button>
          <button type="button" class="btn" @click="goToday">Today</button>
          <button type="button" class="btn btn-icon" aria-label="Next month" @click="go(1)">
            <AppIcon name="chevronRight" />
          </button>
        </div>
      </div>
    </div>

    <PageLoading v-if="!store.ready" :rows="5" />
    <template v-else>
      <div class="card cal" role="region" :aria-label="`Calendar for ${title}`" data-testid="calendar-grid">
        <div class="weekdays" aria-hidden="true">
          <div v-for="w in WEEKDAYS" :key="w" class="wd">{{ w }}</div>
        </div>
        <div class="grid">
          <div
            v-for="d in days"
            :key="d.date"
            role="group"
            class="cell"
            :class="{ out: !d.inMonth, today: d.date === store.today, sel: d.date === selected }"
            :aria-label="`${formatDate(d.date, { weekday: 'long', month: 'long', day: 'numeric' })}${tasksFor(d.date).length ? `, ${tasksFor(d.date).length} tasks` : ''}`"
          >
            <div class="cell-head">
              <button type="button" class="daynum" :aria-label="`Show tasks for ${formatDate(d.date, { month: 'long', day: 'numeric' })}`" @click="selected = d.date">
                {{ d.day }}
              </button>
              <button type="button" class="add" :aria-label="`New task due ${formatDate(d.date, { month: 'long', day: 'numeric' })}`" @click="ui.openNewTask({ dueDate: d.date })">
                <AppIcon name="plus" :size="13" />
              </button>
            </div>
            <ul class="items">
              <li v-for="t in visibleFor(d.date)" :key="t.id">
                <NuxtLink
                  :to="`/tasks/${t.id}`"
                  class="item"
                  :class="{ done: t.status === 'done', late: isOverdue(t, store.today) }"
                  :style="{ '--pc': projectColor(t) }"
                  :title="t.title"
                >
                  <span class="item-text">{{ t.title }}</span>
                </NuxtLink>
              </li>
            </ul>
            <button v-if="tasksFor(d.date).length > MAX" type="button" class="more" :aria-expanded="expanded.has(d.date)" :aria-label="expanded.has(d.date) ? 'Show fewer tasks' : `Show ${tasksFor(d.date).length - MAX} more tasks`" @click="toggleExpand(d.date)">
              <template v-if="expanded.has(d.date)">Show less</template>
              <template v-else>+{{ tasksFor(d.date).length - MAX }}<span class="more-word"> more</span></template>
            </button>
          </div>
        </div>
      </div>

      <section v-if="selected" class="card agenda" aria-live="polite">
        <div class="card-header">
          <h2 class="card-title">{{ formatDate(selected, { weekday: 'long', month: 'long', day: 'numeric' }) }}</h2>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Close day details" @click="selected = null">
            <AppIcon name="x" :size="15" />
          </button>
        </div>
        <ul v-if="selectedTasks.length" class="agenda-list">
          <li v-for="t in selectedTasks" :key="t.id">
            <NuxtLink :to="`/tasks/${t.id}`" class="agenda-item">
              <span class="dot" :style="{ background: projectColor(t) }" />
              <span class="agenda-title" :class="{ done: t.status === 'done' }">{{ t.title }}</span>
              <RecurrenceIcon :recurrence="t.recurrence" />
              <MemberAvatar :member-id="t.assigneeId" :size="22" />
              <PriorityBadge :priority="t.priority" />
            </NuxtLink>
          </li>
        </ul>
        <p v-else class="empty">Nothing due this day.</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.assignee-filter .select {
  width: 180px;
}

.nav {
  display: flex;
  gap: 6px;
}

.cal {
  overflow: hidden;
}

.weekdays,
.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.wd {
  padding: 10px 10px;
  font-size: 12px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-subtle);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}

.cell {
  min-height: 118px;
  padding: 6px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cell:nth-child(7n) {
  border-right: 0;
}

.cell.out {
  background: color-mix(in srgb, var(--surface-2) 55%, transparent);
}

.cell.out .daynum {
  color: var(--text-subtle);
}

.cell.sel {
  box-shadow: inset 0 0 0 2px var(--accent);
}

.cell-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.daynum {
  display: grid;
  place-items: center;
  min-width: 26px;
  height: 26px;
  padding: 0 4px;
  border-radius: 13px;
  border: 0;
  background: none;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}

.daynum:hover {
  background: var(--surface-hover);
}

.today .daynum {
  background: var(--accent);
  color: var(--on-accent);
}

.add {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 0;
  background: none;
  color: var(--text-subtle);
  cursor: pointer;
  opacity: 0;
}

.cell:hover .add,
.add:focus-visible {
  opacity: 1;
}

.add:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  background: color-mix(in srgb, var(--pc) 14%, var(--surface));
  border-left: 3px solid var(--pc);
  text-decoration: none;
  min-width: 0;
}

.item:hover {
  text-decoration: none;
  background: color-mix(in srgb, var(--pc) 24%, var(--surface));
}

.item-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item.done .item-text {
  text-decoration: line-through;
  color: var(--text-muted);
}

.item.late .item-text {
  color: var(--danger);
  font-weight: 600;
}

.more {
  align-self: flex-start;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 5px;
  cursor: pointer;
}

.more:hover {
  background: var(--accent-soft);
}

.agenda {
  margin-top: 16px;
}

.agenda-list {
  list-style: none;
  margin: 0;
  padding: 8px;
}

.agenda-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--text);
}

.agenda-item:hover {
  background: var(--surface-hover);
  text-decoration: none;
}

.agenda-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agenda-title.done {
  text-decoration: line-through;
  color: var(--text-muted);
}

@media (max-width: 767px) {
  .wd {
    padding: 8px 2px;
    text-align: center;
    font-size: 10.5px;
  }

  .cell {
    min-height: 64px;
    padding: 3px;
  }

  .cell-head {
    justify-content: center;
  }

  .add {
    display: none;
  }

  .items {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    gap: 3px;
  }

  .item {
    width: 7px;
    height: 7px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--pc);
  }

  .item-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }

  .more-word {
    display: none;
  }

  .more {
    align-self: center;
    font-size: 10.5px;
    padding: 0 2px;
  }
}
</style>
