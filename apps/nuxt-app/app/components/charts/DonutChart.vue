<script setup lang="ts">
import type { DonutSlice } from '~/lib/chartTypes';

const props = defineProps<{ slices: DonutSlice[]; centerLabel: string }>();

const R = 70;
const STROKE = 22;
const C = 2 * Math.PI * R;
const active = ref<string | null>(null);

const total = computed(() => props.slices.reduce((s, x) => s + x.value, 0));

const arcs = computed(() => {
  let offset = 0;
  const gap = props.slices.filter((s) => s.value > 0).length > 1 ? 2 : 0;
  return props.slices.map((s) => {
    const len = total.value ? (s.value / total.value) * C : 0;
    const arc = { ...s, dash: `${Math.max(0, len - gap)} ${C}`, offset: -offset, pct: total.value ? Math.round((s.value / total.value) * 100) : 0 };
    offset += len;
    return arc;
  });
});

const center = computed(() => {
  const a = arcs.value.find((x) => x.key === active.value);
  return a ? { value: a.value, label: a.label } : { value: total.value, label: props.centerLabel };
});

const summary = computed(() => `${props.centerLabel}: ${props.slices.map((s) => `${s.label} ${s.value}`).join(', ')}.`);
</script>

<template>
  <div class="donut">
    <svg viewBox="0 0 200 200" role="img" :aria-label="summary">
      <circle cx="100" cy="100" :r="R" fill="none" class="track" :stroke-width="STROKE" />
      <g transform="rotate(-90 100 100)">
        <circle
          v-for="a in arcs"
          :key="a.key"
          cx="100"
          cy="100"
          :r="R"
          fill="none"
          :stroke="a.color"
          :stroke-width="active === a.key ? STROKE + 6 : STROKE"
          :stroke-dasharray="a.dash"
          :stroke-dashoffset="a.offset"
          class="arc"
          :class="{ dim: active && active !== a.key }"
          @pointerenter="active = a.key"
          @pointerleave="active = null"
        />
      </g>
      <text x="100" y="96" text-anchor="middle" class="big">{{ center.value }}</text>
      <text x="100" y="118" text-anchor="middle" class="small">{{ center.label }}</text>
    </svg>
    <ul class="legend">
      <li
        v-for="a in arcs"
        :key="a.key"
        :class="{ dim: active && active !== a.key }"
        @pointerenter="active = a.key"
        @pointerleave="active = null"
      >
        <span class="sw" :style="{ background: a.color }" aria-hidden="true" />
        <span class="lname">{{ a.label }}</span>
        <span class="lval">{{ a.value }}</span>
        <span class="lpct">{{ a.pct }}%</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.donut {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  justify-content: center;
}

.donut > svg {
  width: 180px;
  height: 180px;
  flex: none;
}

.track {
  stroke: var(--surface-2);
}

.arc {
  transition:
    stroke-width 0.15s,
    opacity 0.15s;
  cursor: pointer;
}

.dim {
  opacity: 0.35;
}

.big {
  font-size: 30px;
  font-weight: 750;
  fill: var(--text);
}

.small {
  font-size: 11.5px;
  fill: var(--text-muted);
}

.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
  min-width: 160px;
  flex: 1;
}

.legend li {
  display: grid;
  grid-template-columns: 12px 1fr auto 40px;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 6px;
  transition: opacity 0.15s;
}

.legend li:hover {
  background: var(--surface-2);
}

.sw {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.lval {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.lpct {
  color: var(--text-subtle);
  font-size: 12px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
