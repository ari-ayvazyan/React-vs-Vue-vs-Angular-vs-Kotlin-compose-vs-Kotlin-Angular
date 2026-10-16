<script setup lang="ts">
import type { Task } from '~/lib/types';
import { ROW_HEIGHT, barGeometry, dueAfterDrag } from '~/lib/timeline';
import { addDaysISO, daysBetween, formatDate } from '~/lib/dates';

/**
 * One Gantt bar with its due-date handle. The drag preview lives in this component, so moving the pointer
 * re-renders only this bar – not the whole chart (which has ~850 rows with ?seed=1000).
 */
const props = defineProps<{
  task: Task;
  y: number;
  start: string;
  due: string;
  rangeStart: string;
  dayWidth: number;
  color: string;
  late: boolean;
  today: string;
}>();
const emit = defineEmits<{ commit: [due: string]; open: [] }>();

const drag = ref<{ startX: number; due: string } | null>(null);
const shownDue = computed(() => drag.value?.due ?? props.due);
const g = computed(() => barGeometry(props.start, shownDue.value, props.rangeStart, props.dayWidth));
const tip = computed(
  () => `${props.task.title}\nCreated ${formatDate(props.start)} · due ${formatDate(shownDue.value)}${g.value.inverted ? ' (due before it was created)' : ''}`,
);
let moved = false;

function onDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  (e.currentTarget as Element).setPointerCapture(e.pointerId);
  moved = false;
  drag.value = { startX: e.clientX, due: props.due };
}

function onMove(e: PointerEvent): void {
  const d = drag.value;
  if (!d) return;
  const due = dueAfterDrag(props.due, e.clientX - d.startX, props.dayWidth);
  if (due !== d.due) drag.value = { ...d, due };
}

function onUp(): void {
  const d = drag.value;
  if (!d) return;
  drag.value = null;
  if (d.due !== props.due) {
    moved = true;
    emit('commit', d.due);
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && drag.value) {
    e.stopPropagation();
    drag.value = null;
    return;
  }
  const delta = { ArrowRight: 1, ArrowLeft: -1, PageUp: 7, PageDown: -7 }[e.key];
  if (!delta) return;
  e.preventDefault();
  emit('commit', addDaysISO(props.due, delta));
}

function onBarClick(): void {
  if (moved) {
    moved = false;
    return;
  }
  emit('open');
}
</script>

<template>
  <g class="bar-row" :class="{ done: task.status === 'done', late, dragging: !!drag }" data-testid="timeline-bar" :data-task-id="task.id">
    <title>{{ tip }}</title>
    <rect
      :x="g.x"
      :y="y + 7"
      :width="g.width"
      :height="ROW_HEIGHT - 14"
      rx="4"
      class="bar"
      :class="{ inverted: g.inverted }"
      :style="{ fill: g.inverted ? 'url(#tl-hatch)' : color }"
      @click="onBarClick"
    />
    <rect
      :x="g.dueX - 5"
      :y="y + 4"
      width="10"
      :height="ROW_HEIGHT - 8"
      rx="3"
      class="handle"
      tabindex="0"
      role="slider"
      :aria-label="`Due date of ${task.title}`"
      :aria-valuetext="formatDate(shownDue, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })"
      :aria-valuenow="daysBetween(today, shownDue)"
      data-testid="timeline-due-handle"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="drag = null"
      @keydown="onKey"
    />
  </g>
</template>

<style scoped>
.bar {
  cursor: pointer;
}

.bar-row.done .bar {
  opacity: 0.4;
}

.bar-row.late .bar {
  stroke: var(--danger);
  stroke-width: 1.5;
}

.bar.inverted {
  stroke: var(--danger);
  stroke-width: 1;
  stroke-dasharray: 3 2;
}

.handle {
  fill: var(--surface);
  stroke: var(--text-muted);
  stroke-width: 1.5;
  cursor: ew-resize;
  opacity: 0;
  transition: opacity 0.1s;
  touch-action: none;
}

.bar-row:hover .handle,
.bar-row.dragging .handle,
.handle:focus {
  opacity: 1;
}

.handle:focus-visible {
  outline: none;
  stroke: var(--focus);
  stroke-width: 2.5;
}

.bar-row.dragging .bar {
  opacity: 0.85;
  stroke: var(--focus);
  stroke-width: 2;
}
</style>
