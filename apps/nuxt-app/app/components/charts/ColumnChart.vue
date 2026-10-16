<script setup lang="ts">
import type { ColumnDatum } from '~/lib/chartTypes';

const props = withDefaults(defineProps<{ columns: ColumnDatum[]; label: string; unit: string; decimals?: number }>(), { decimals: 1 });

/** Width tracks the container so text renders at true pixel size (same approach as LineChart). */
const W = ref(480);
const H = 240;
const PAD = { top: 22, right: 8, bottom: 44, left: 36 };
const wrap = ref<HTMLElement | null>(null);
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (!wrap.value) return;
  W.value = Math.max(220, Math.round(wrap.value.clientWidth));
  ro = new ResizeObserver(([entry]) => {
    if (entry) W.value = Math.max(220, Math.round(entry.contentRect.width));
  });
  ro.observe(wrap.value);
});
onBeforeUnmount(() => ro?.disconnect());

const innerW = computed(() => W.value - PAD.left - PAD.right);
const innerH = H - PAD.top - PAD.bottom;
const maxV = computed(() => Math.max(0, ...props.columns.map((c) => c.value ?? 0)));
/** "nice" tick step: 1, 2 or 5 × 10^n giving at most ~5 ticks */
const step = computed(() => {
  const raw = Math.max(maxV.value, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
});
const top = computed(() => Math.max(step.value, Math.ceil(maxV.value / step.value) * step.value));
const ticks = computed(() => Array.from({ length: Math.round(top.value / step.value) + 1 }, (_, i) => i * step.value));
const y = (v: number): number => PAD.top + innerH - (v / top.value) * innerH;
const slot = computed(() => innerW.value / Math.max(1, props.columns.length));
const barW = computed(() => Math.min(56, slot.value * 0.56));
const fmt = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: props.decimals });
const tickFmt = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
const describe = (c: ColumnDatum): string => `${c.label}: ${c.value === null ? 'no data' : `${fmt(c.value)} ${props.unit}`} (${c.detail})`;
</script>

<template>
  <div ref="wrap" class="cols">
    <svg :width="W" :height="H" role="img" :aria-label="`${label}. ${columns.map(describe).join('; ')}.`">
      <g aria-hidden="true">
        <g v-for="t in ticks" :key="t">
          <line :x1="PAD.left" :x2="W - PAD.right" :y1="y(t)" :y2="y(t)" class="grid" />
          <text :x="PAD.left - 6" :y="y(t) + 4" text-anchor="end" class="tick">{{ tickFmt(t) }}</text>
        </g>
        <g v-for="(c, i) in columns" :key="c.key" class="col">
          <title>{{ describe(c) }}</title>
          <!-- full-height hit area for the tooltip -->
          <rect :x="PAD.left + i * slot" :y="PAD.top" :width="slot" :height="innerH" class="hit" />
          <rect
            v-if="c.value !== null"
            :x="PAD.left + i * slot + (slot - barW) / 2"
            :y="y(c.value)"
            :width="barW"
            :height="Math.max(c.value > 0 ? 2 : 0, PAD.top + innerH - y(c.value))"
            rx="4"
            :fill="c.color"
            class="bar"
          />
          <text :x="PAD.left + i * slot + slot / 2" :y="c.value === null ? PAD.top + innerH - 6 : y(c.value) - 6" text-anchor="middle" class="val">
            {{ c.value === null ? '–' : fmt(c.value) }}
          </text>
          <text :x="PAD.left + i * slot + slot / 2" :y="H - PAD.bottom + 18" text-anchor="middle" class="lbl">{{ c.label }}</text>
          <text :x="PAD.left + i * slot + slot / 2" :y="H - PAD.bottom + 34" text-anchor="middle" class="sub">{{ c.detail }}</text>
        </g>
        <line :x1="PAD.left" :x2="W - PAD.right" :y1="PAD.top + innerH + 0.5" :y2="PAD.top + innerH + 0.5" class="base" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.cols {
  width: 100%;
}

.cols > svg {
  display: block;
}

.grid {
  stroke: var(--border);
  stroke-dasharray: 2 3;
}

.base {
  stroke: var(--border-strong);
}

.tick,
.sub {
  font-size: 11px;
  fill: var(--text-subtle);
}

.lbl {
  font-size: 12.5px;
  font-weight: 600;
  fill: var(--text);
}

.val {
  font-size: 12.5px;
  font-weight: 650;
  fill: var(--text);
  font-variant-numeric: tabular-nums;
}

.hit {
  fill: transparent;
}

.col:hover .hit {
  fill: var(--surface-hover);
  opacity: 0.6;
}
</style>
