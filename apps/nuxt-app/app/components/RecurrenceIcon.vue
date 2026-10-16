<script setup lang="ts">
import type { Recurrence } from '~/lib/types';

const props = withDefaults(defineProps<{ recurrence: Recurrence; size?: number; showLabel?: boolean }>(), { size: 13, showLabel: false });
const label = computed(() => `Repeats ${props.recurrence}`);
</script>

<template>
  <span v-if="recurrence !== 'none'" class="rec" role="img" :aria-label="label" :title="label" data-testid="recurrence-icon">
    <AppIcon name="repeat" :size="size" />
    <span v-if="showLabel" class="txt" aria-hidden="true">{{ recurrence }}</span>
  </span>
</template>

<style scoped>
.rec {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--accent-text);
  font-size: 12px;
  font-weight: 600;
}

.txt {
  text-transform: capitalize;
}
</style>
