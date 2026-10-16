<script setup lang="ts">
import type { BarRow } from '~/lib/chartTypes';

withDefaults(defineProps<{ rows: BarRow[]; label: string; emptyText?: string }>(), { emptyText: 'No projects yet.' });
</script>

<template>
  <div class="bars" role="list" :aria-label="label">
    <div
      v-for="r in rows"
      :key="r.key"
      class="row"
      role="listitem"
      :aria-label="r.ariaText ?? `${r.label}: ${r.percent}% complete (${r.detail})`"
      :title="r.ariaText ?? `${r.label}: ${r.percent}% complete (${r.detail})`"
    >
      <div class="meta">
        <NuxtLink v-if="r.to" :to="r.to" class="name">{{ r.label }}</NuxtLink>
        <span v-else class="name">{{ r.label }}</span>
        <span class="detail">{{ r.detail }}</span>
      </div>
      <div class="track-row">
        <svg class="track" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
          <rect x="0" y="0" width="100" height="10" rx="5" class="bg" />
          <rect x="0" y="0" :width="Math.max(r.percent, r.percent > 0 ? 2 : 0)" height="10" rx="5" :fill="r.color" />
        </svg>
        <span class="pct">{{ r.valueText ?? `${r.percent}%` }}</span>
      </div>
    </div>
    <p v-if="!rows.length" class="empty">{{ emptyText }}</p>
  </div>
</template>

<style scoped>
.bars {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}

.name {
  font-weight: 600;
  color: var(--text);
}

.detail {
  color: var(--text-subtle);
  font-size: 12px;
}

.track-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.track {
  flex: 1;
  height: 10px;
  display: block;
}

.bg {
  fill: var(--surface-2);
}

.pct {
  min-width: 40px;
  white-space: nowrap;
  text-align: right;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
</style>
