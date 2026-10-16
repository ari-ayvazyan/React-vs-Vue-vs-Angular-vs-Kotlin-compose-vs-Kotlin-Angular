<script setup lang="ts">
import type { DayCount } from '~/lib/stats';
import { formatDate } from '~/lib/dates';

const props = withDefaults(
  defineProps<{
    data: DayCount[];
    label: string;
    /** word after the value in the tooltip */
    valueLabel?: string;
    /** accessible summary; defaults to a "completed per day" description */
    summaryText?: string;
  }>(),
  { valueLabel: 'completed', summaryText: undefined },
);

/** Width tracks the container (ResizeObserver) so text renders at true pixel size. */
const W = ref(640);
const H = 260;
const PAD = { top: 14, right: 14, bottom: 30, left: 34 };
const innerW = computed(() => W.value - PAD.left - PAD.right);
const innerH = H - PAD.top - PAD.bottom;
const wrap = ref<HTMLElement | null>(null);
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (!wrap.value) return;
  W.value = Math.max(240, Math.round(wrap.value.clientWidth));
  ro = new ResizeObserver(([entry]) => {
    if (entry) W.value = Math.max(240, Math.round(entry.contentRect.width));
  });
  ro.observe(wrap.value);
});
onBeforeUnmount(() => ro?.disconnect());

const hover = ref<number | null>(null);

const step = computed(() => {
  const m = Math.max(1, ...props.data.map((d) => d.count));
  return m <= 4 ? 1 : m <= 10 ? 2 : m <= 25 ? 5 : m <= 50 ? 10 : Math.ceil(m / 50) * 10;
});
const maxY = computed(() => Math.ceil(Math.max(1, ...props.data.map((d) => d.count)) / step.value) * step.value);
const yTicks = computed(() => Array.from({ length: maxY.value / step.value + 1 }, (_, i) => i * step.value));

const x = (i: number): number => PAD.left + (props.data.length <= 1 ? innerW.value / 2 : (i / (props.data.length - 1)) * innerW.value);
const y = (v: number): number => PAD.top + innerH - (v / maxY.value) * innerH;

const points = computed(() => props.data.map((d, i) => [x(i), y(d.count)] as const));

/** Smooth-ish monotone path using cardinal-like midpoints (no overshoot below 0). */
const linePath = computed(() => {
  const p = points.value;
  if (!p.length) return '';
  let d = `M${p[0]![0]},${p[0]![1]}`;
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1]!;
    const [x1, y1] = p[i]!;
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  return d;
});

const areaPath = computed(() => {
  const p = points.value;
  if (!p.length) return '';
  const base = PAD.top + innerH;
  return `${linePath.value} L${p[p.length - 1]![0]},${base} L${p[0]![0]},${base} Z`;
});

const xLabels = computed(() => {
  const every = W.value < 420 ? 10 : 5;
  const last = props.data.length - 1;
  return props.data.map((d, i) => ({ i, d })).filter(({ i }) => (i % every === 0 && last - i >= every / 2) || i === last);
});

const total = computed(() => props.data.reduce((s, d) => s + d.count, 0));
const summary = computed(() => props.summaryText ?? `${props.label}: ${total.value} tasks completed in the last ${props.data.length} days, peak ${Math.max(0, ...props.data.map((d) => d.count))} per day.`);

const svgEl = ref<SVGSVGElement | null>(null);

function onMove(e: PointerEvent): void {
  const svg = svgEl.value;
  if (!svg || !props.data.length) return;
  const rect = svg.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * W.value;
  const i = Math.round(((px - PAD.left) / innerW.value) * (props.data.length - 1));
  hover.value = Math.max(0, Math.min(props.data.length - 1, i));
}

function onKey(e: KeyboardEvent): void {
  if (!props.data.length) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const cur = hover.value ?? props.data.length - 1;
    hover.value = Math.max(0, Math.min(props.data.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
  }
}

const tip = computed(() => {
  if (hover.value === null) return null;
  const d = props.data[hover.value];
  if (!d) return null;
  const [px, py] = points.value[hover.value]!;
  return { left: (px / W.value) * 100, top: (py / H) * 100, date: formatDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' }), count: d.count };
});
</script>

<template>
  <div ref="wrap" class="chart">
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-label="summary"
      tabindex="0"
      @pointermove="onMove"
      @pointerleave="hover = null"
      @keydown="onKey"
      @blur="hover = null"
    >
      <defs>
        <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.32" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
        </linearGradient>
      </defs>
      <g class="grid">
        <g v-for="t in yTicks" :key="t">
          <line :x1="PAD.left" :x2="W - PAD.right" :y1="y(t)" :y2="y(t)" />
          <text :x="PAD.left - 8" :y="y(t)" text-anchor="end" dominant-baseline="middle" class="axis">{{ t }}</text>
        </g>
      </g>
      <text
        v-for="l in xLabels"
        :key="l.i"
        :x="x(l.i)"
        :y="H - 8"
        :text-anchor="l.i === 0 ? 'start' : l.i === data.length - 1 ? 'end' : 'middle'"
        class="axis"
      >
        {{ formatDate(l.d.date) }}
      </text>
      <path :d="areaPath" fill="url(#area-fill)" />
      <path :d="linePath" class="line" fill="none" />
      <g v-if="tip && hover !== null">
        <line :x1="points[hover]![0]" :x2="points[hover]![0]" :y1="PAD.top" :y2="PAD.top + innerH" class="cursor" />
        <circle :cx="points[hover]![0]" :cy="points[hover]![1]" r="4.5" class="pt" />
      </g>
    </svg>
    <div v-if="tip" class="tip" :style="{ left: `${tip.left}%`, top: `${tip.top}%` }" aria-hidden="true">
      <strong>{{ tip.count }}</strong> {{ valueLabel }}
      <span>{{ tip.date }}</span>
    </div>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  width: 100%;
}

.chart > svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  border-radius: 6px;
  cursor: crosshair;
}

.grid line {
  stroke: var(--border);
  stroke-dasharray: 3 4;
  vector-effect: non-scaling-stroke;
}

.axis {
  font-size: 11px;
  fill: var(--text-subtle);
}

.line {
  stroke: var(--accent);
  stroke-width: 2.5;
  vector-effect: non-scaling-stroke;
}

.cursor {
  stroke: var(--border-strong);
  vector-effect: non-scaling-stroke;
}

.pt {
  fill: var(--surface);
  stroke: var(--accent);
  stroke-width: 2.5;
  vector-effect: non-scaling-stroke;
}

.tip {
  position: absolute;
  transform: translate(-50%, calc(-100% - 12px));
  background: var(--text);
  color: var(--bg);
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: var(--shadow-lg);
  display: flex;
  gap: 4px;
  flex-direction: column;
  align-items: center;
  line-height: 1.2;
}

.tip span {
  opacity: 0.75;
  font-size: 11px;
}
</style>
