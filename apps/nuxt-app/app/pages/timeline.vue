<script setup lang="ts">
import type { Task } from '~/lib/types';
import type { TimelineTaskRow, Zoom } from '~/lib/timeline';
import { DAY_WIDTH, GROUP_HEIGHT, ROW_HEIGHT, ZOOMS, ZOOM_LABELS, axisTicks, barGeometry, buildTimeline, dependencyLinks, linkPath } from '~/lib/timeline';
import { daysBetween, formatDate, parseISODate } from '~/lib/dates';
import { isOverdue } from '~/lib/filters';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

useHead({ title: 'Timeline · TaskPilot' });

const store = useTaskStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const zoom = computed<Zoom>(() => (ZOOMS as readonly string[]).includes(route.query.zoom as string) ? (route.query.zoom as Zoom) : 'month');
const hideDone = computed(() => route.query.open === '1');
function setQuery(patch: Record<string, string | undefined>): void {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...route.query, ...patch })) if (typeof v === 'string' && v) q[k] = v;
  void router.replace({ path: '/timeline', query: q });
}

const collapsed = ref<Set<string>>(new Set());
function toggleGroup(key: string): void {
  const s = new Set(collapsed.value);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  collapsed.value = s;
}

const model = computed(() => buildTimeline(store.tasks, store.projects, { today: store.today, collapsed: collapsed.value, hideDone: hideDone.value }));
const groupKeys = computed(() => model.value.rows.filter((r) => r.kind === 'group').map((r) => r.key));
const allCollapsed = computed(() => groupKeys.value.length > 0 && groupKeys.value.every((k) => collapsed.value.has(k)));
function toggleAll(): void {
  collapsed.value = allCollapsed.value ? new Set() : new Set(groupKeys.value);
}

const dayW = computed(() => DAY_WIDTH[zoom.value]);
const chartWidth = computed(() => model.value.days * dayW.value);
const axis = computed(() => axisTicks(model.value.rangeStart, model.value.days, zoom.value));
const todayX = computed(() => daysBetween(model.value.rangeStart, store.today) * dayW.value);
/** Weekend columns, shaded in the week zoom only. */
const weekends = computed(() => {
  if (zoom.value !== 'week') return [];
  const first = parseISODate(model.value.rangeStart).getDay();
  const out: number[] = [];
  for (let i = 0; i < model.value.days; i++) if ([0, 6].includes((first + i) % 7)) out.push(i);
  return out;
});

const projectColor = (t: Task): string => (t.projectId ? (store.projectById.get(t.projectId)?.color ?? '#64748b') : '#64748b');

// ----- due-date changes (dragging/keyboard happen in TimelineBar) -----
const geo = (r: TimelineTaskRow): ReturnType<typeof barGeometry> => barGeometry(r.start, r.due, model.value.rangeStart, dayW.value);

function commitDue(id: string, due: string, previous: string): void {
  if (due === previous) return;
  const t = store.taskById.get(id);
  if (!t) return;
  store.updateTask(id, { dueDate: due });
  announce.value = `Due date of “${t.title}” set to ${formatDate(due, { month: 'long', day: 'numeric', year: 'numeric' })}.`;
  ui.toast(`Due date of “${t.title}” moved to ${formatDate(due)}`, { kind: 'success', duration: 4000, actionLabel: 'Undo', action: () => store.undo() });
}

const links = computed(() =>
  dependencyLinks(model.value.rows).map((l) => {
    const a = geo(l.from);
    const b = geo(l.to);
    const y1 = l.from.y + ROW_HEIGHT / 2;
    const y2 = l.to.y + ROW_HEIGHT / 2;
    return { key: `${l.from.task.id}>${l.to.task.id}`, d: linkPath(a.x + a.width, y1, b.x, y2), open: l.from.task.status !== 'done' };
  }),
);

const announce = ref('');
const scroller = ref<HTMLElement | null>(null);
/** Width of the sticky task-name column (narrower on phones). */
const narrow = ref(false);
const LABEL_W_WIDE = 260;
const LABEL_W_NARROW = 140;
const labelW = computed(() => (narrow.value ? LABEL_W_NARROW : LABEL_W_WIDE));
let stopMq: (() => void) | null = null;
onMounted(() => {
  const mq = window.matchMedia('(max-width: 767px)');
  const sync = (): void => {
    narrow.value = mq.matches;
  };
  sync();
  mq.addEventListener('change', sync);
  stopMq = () => mq.removeEventListener('change', sync);
});
onBeforeUnmount(() => stopMq?.());

/** Horizontal scroll position, so the month of the leftmost visible day can stay labelled in the header. */
const scrollLeft = ref(0);
let scrollFrame = 0;
function onScroll(): void {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    scrollLeft.value = scroller.value?.scrollLeft ?? 0;
  });
}
onBeforeUnmount(() => cancelAnimationFrame(scrollFrame));
const stickyMonth = computed(() => {
  const firstDay = Math.floor(scrollLeft.value / dayW.value);
  const months = axis.value.months;
  const i = months.findLastIndex((m) => m.day <= firstDay);
  const cur = months[i];
  if (!cur || cur.day * dayW.value >= scrollLeft.value) return null; // its own label is visible
  const next = months[i + 1];
  if (next && next.day * dayW.value - scrollLeft.value < 140) return null; // would collide with the next label
  return { x: scrollLeft.value + 6, label: cur.label };
});

function scrollToToday(): void {
  const el = scroller.value;
  if (el) el.scrollLeft = Math.max(0, todayX.value - (el.clientWidth - labelW.value) / 3);
}

watch(
  () => [store.ready, zoom.value] as const,
  async ([ready]) => {
    if (!ready) return;
    await nextTick();
    scrollToToday();
  },
  { immediate: true },
);

const UNDATED_STEP = 30;
const undatedLimit = ref(UNDATED_STEP);
</script>

<template>
  <div class="page tl-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">Timeline</h1>
        <p class="page-subtitle">
          <template v-if="store.ready">{{ model.datedCount.toLocaleString('en-US') }} scheduled · {{ model.undated.length.toLocaleString('en-US') }} without due date</template>
          <template v-else>Tasks from creation to due date</template>
        </p>
      </div>
      <div class="controls">
        <div class="seg" role="group" aria-label="Zoom">
          <button
            v-for="z in ZOOMS"
            :key="z"
            type="button"
            class="seg-btn"
            :class="{ on: zoom === z }"
            :aria-pressed="zoom === z"
            :data-testid="`timeline-zoom-${z}`"
            @click="setQuery({ zoom: z === 'month' ? undefined : z })"
          >
            {{ ZOOM_LABELS[z] }}
          </button>
        </div>
        <label class="check">
          <input type="checkbox" class="checkbox" :checked="hideDone" data-testid="timeline-hide-done" @change="setQuery({ open: ($event.target as HTMLInputElement).checked ? '1' : undefined })" >
          Hide done
        </label>
        <button type="button" class="btn btn-sm" @click="toggleAll">{{ allCollapsed ? 'Expand all' : 'Collapse all' }}</button>
        <button type="button" class="btn btn-sm" @click="scrollToToday">Today</button>
      </div>
    </div>

    <p class="sr-only" aria-live="polite">{{ announce }}</p>

    <PageLoading v-if="!store.ready" :rows="6" />
    <template v-else>
      <div class="card tl-card">
        <div v-if="model.rows.length" ref="scroller" class="scroller" data-testid="timeline" @scroll.passive="onScroll">
          <div class="canvas" :style="{ width: `${labelW + chartWidth}px`, '--label-w': `${labelW}px` }">
            <!-- header -->
            <div class="head">
              <div class="corner">Task</div>
              <svg class="axis" :width="chartWidth" height="48" aria-hidden="true">
                <g v-for="m in axis.months" :key="`m${m.day}`">
                  <line :x1="m.day * dayW" :x2="m.day * dayW" y1="0" y2="48" class="axis-month-line" />
                  <text :x="m.day * dayW + 6" y="17" class="axis-month">{{ m.label }}</text>
                </g>
                <text v-if="stickyMonth" :x="stickyMonth.x" y="17" class="axis-month">{{ stickyMonth.label }}</text>
                <text v-for="t in axis.ticks" :key="`t${t.day}`" :x="t.day * dayW + (zoom === 'week' ? dayW / 2 : 3)" y="40" class="axis-tick" :text-anchor="zoom === 'week' ? 'middle' : 'start'">{{ t.label }}</text>
                <line x1="0" :x2="chartWidth" y1="47.5" y2="47.5" class="axis-base" />
              </svg>
            </div>

            <!-- body -->
            <div class="body">
              <div class="labels" :style="{ height: `${model.height}px` }">
                <template v-for="r in model.rows" :key="r.kind === 'group' ? `g-${r.key}` : r.task.id">
                  <button
                    v-if="r.kind === 'group'"
                    type="button"
                    class="group-label"
                    :style="{ top: `${r.y}px`, height: `${GROUP_HEIGHT}px` }"
                    :aria-expanded="!r.collapsed"
                    data-testid="timeline-group"
                    @click="toggleGroup(r.key)"
                  >
                    <AppIcon :name="r.collapsed ? 'chevronRight' : 'chevronDown'" :size="14" />
                    <span class="dot" :style="{ background: r.color ?? 'var(--border-strong)' }" aria-hidden="true" />
                    <span class="g-name">{{ r.label }}</span>
                    <span class="g-count">{{ r.count }}</span>
                  </button>
                  <NuxtLink
                    v-else
                    :to="`/tasks/${r.task.id}`"
                    class="task-label"
                    :class="{ done: r.task.status === 'done' }"
                    :style="{ top: `${r.y}px`, height: `${ROW_HEIGHT}px` }"
                    :title="r.task.title"
                  >
                    {{ r.task.title }}
                  </NuxtLink>
                </template>
              </div>

              <svg class="chart" :width="chartWidth" :height="model.height" role="img" :aria-label="`Gantt chart of ${model.datedCount} tasks. Use the task list on the left to open tasks; due-date handles can be adjusted with the arrow keys.`">
                <defs>
                  <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L8,4 L0,8 z" class="arrow-head" />
                  </marker>
                  <marker id="tl-arrow-done" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L8,4 L0,8 z" class="arrow-head done" />
                  </marker>
                  <pattern id="tl-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" class="hatch-bg" />
                    <line x1="0" y1="0" x2="0" y2="6" class="hatch-line" />
                  </pattern>
                </defs>
                <rect v-for="d in weekends" :key="`w${d}`" :x="d * dayW" y="0" :width="dayW" :height="model.height" class="weekend" />
                <line v-for="m in axis.months" :key="`ml${m.day}`" :x1="m.day * dayW" :x2="m.day * dayW" y1="0" :y2="model.height" class="month-line" />
                <template v-for="r in model.rows" :key="r.kind === 'group' ? `gb-${r.key}` : `b-${r.task.id}`">
                  <rect v-if="r.kind === 'group'" x="0" :y="r.y" :width="chartWidth" :height="GROUP_HEIGHT" class="group-band" />
                  <TimelineBar
                    v-else
                    :task="r.task"
                    :y="r.y"
                    :start="r.start"
                    :due="r.due"
                    :range-start="model.rangeStart"
                    :day-width="dayW"
                    :color="projectColor(r.task)"
                    :late="isOverdue(r.task, store.today)"
                    :today="store.today"
                    @commit="commitDue(r.task.id, $event, r.due)"
                    @open="navigateTo(`/tasks/${r.task.id}`)"
                  />
                </template>
                <path v-for="l in links" :key="l.key" :d="l.d" class="link" :class="{ done: !l.open }" :marker-end="l.open ? 'url(#tl-arrow)' : 'url(#tl-arrow-done)'" data-testid="timeline-link" />
                <line :x1="todayX + dayW / 2" :x2="todayX + dayW / 2" y1="0" :y2="model.height" class="today" />
              </svg>
            </div>
          </div>
        </div>
        <p v-else class="empty">No tasks with a due date{{ hideDone ? ' (done tasks hidden)' : '' }}.</p>
      </div>

      <section v-if="model.undated.length" class="card undated" aria-labelledby="undated-title" data-testid="timeline-undated">
        <div class="card-header">
          <h2 id="undated-title" class="card-title">Without due date</h2>
          <span class="muted small">{{ model.undated.length }} task{{ model.undated.length === 1 ? '' : 's' }}</span>
        </div>
        <ul class="undated-list">
          <li v-for="t in model.undated.slice(0, undatedLimit)" :key="t.id">
            <NuxtLink :to="`/tasks/${t.id}`" class="u-item" :class="{ done: t.status === 'done' }">
              <span class="dot" :style="{ background: projectColor(t) }" aria-hidden="true" />
              <span class="u-title">{{ t.title }}</span>
              <PriorityBadge :priority="t.priority" />
            </NuxtLink>
          </li>
        </ul>
        <button v-if="model.undated.length > undatedLimit" type="button" class="btn btn-sm more" @click="undatedLimit += 100">
          Show {{ Math.min(100, model.undated.length - undatedLimit) }} more
        </button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.seg {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.seg-btn {
  border: 0;
  background: var(--surface);
  color: var(--text-muted);
  padding: 0 12px;
  height: 32px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

.seg-btn + .seg-btn {
  border-left: 1px solid var(--border-strong);
}

.seg-btn.on {
  background: var(--accent-soft);
  color: var(--accent-text);
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 550;
  color: var(--text-muted);
  cursor: pointer;
}

.tl-card {
  overflow: hidden;
}

.scroller {
  overflow: auto;
  max-height: calc(100vh - 210px);
  min-height: 240px;
  overscroll-behavior: contain;
}

.canvas {
  position: relative;
}

.head {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  background: var(--surface);
}

.corner {
  position: sticky;
  left: 0;
  z-index: 4;
  flex: none;
  width: var(--label-w);
  display: flex;
  align-items: flex-end;
  padding: 0 14px 8px;
  font-size: 12px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-subtle);
  background: var(--surface);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.axis {
  display: block;
  flex: none;
}

.axis-month {
  font-size: 12px;
  font-weight: 650;
  fill: var(--text);
}

.axis-tick {
  font-size: 11px;
  fill: var(--text-subtle);
  font-variant-numeric: tabular-nums;
}

.axis-month-line,
.month-line {
  stroke: var(--border);
}

.axis-base {
  stroke: var(--border);
}

.body {
  display: flex;
}

.labels {
  position: sticky;
  left: 0;
  z-index: 2;
  flex: none;
  width: var(--label-w);
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.group-label,
.task-label {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  white-space: nowrap;
  overflow: hidden;
}

.group-label {
  border: 0;
  background: var(--surface-2);
  color: var(--text);
  font-weight: 650;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.group-label:hover {
  background: var(--surface-hover);
}

.g-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.g-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-subtle);
  font-variant-numeric: tabular-nums;
}

.task-label {
  padding-left: 34px;
  font-size: 13px;
  color: var(--text);
  text-overflow: ellipsis;
  display: block;
  line-height: 30px;
}

.task-label:hover {
  background: var(--surface-hover);
  text-decoration: none;
}

.task-label.done {
  color: var(--text-subtle);
  text-decoration: line-through;
}

.chart {
  display: block;
  flex: none;
}

.weekend {
  fill: var(--surface-2);
  opacity: 0.6;
}

.group-band {
  fill: var(--surface-2);
}

.hatch-bg {
  fill: var(--danger-soft);
}

.hatch-line {
  stroke: var(--danger);
  stroke-width: 1.5;
  opacity: 0.5;
}

.link {
  fill: none;
  stroke: var(--warning);
  stroke-width: 1.5;
}

.link.done {
  stroke: var(--text-subtle);
  stroke-dasharray: 4 3;
}

.arrow-head {
  fill: var(--warning);
}

.arrow-head.done {
  fill: var(--text-subtle);
}

.today {
  stroke: var(--accent);
  stroke-width: 2;
  stroke-dasharray: 4 3;
  pointer-events: none;
}

.undated {
  margin-top: 16px;
}

.small {
  font-size: 12.5px;
}

.undated-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 2px 12px;
}

.undated-list > li {
  min-width: 0;
}

.u-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--text);
}

.u-item:hover {
  background: var(--surface-hover);
  text-decoration: none;
}

.u-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.u-item.done .u-title {
  color: var(--text-subtle);
  text-decoration: line-through;
}

.more {
  margin: 0 16px 14px;
}

@media (max-width: 767px) {
  .task-label {
    padding-left: 12px;
  }
}
</style>
