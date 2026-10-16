<script setup lang="ts">
import type { Task } from '~/lib/types';
import { openBlockers } from '~/lib/dependencies';
import { useTaskStore } from '~/stores/tasks';

const props = withDefaults(defineProps<{ task: Task; compact?: boolean }>(), { compact: false });
const store = useTaskStore();
const label = computed(() => {
  const names = openBlockers(props.task, store.taskById).map((b) => `“${b.title}”`);
  return `Blocked by ${names.join(', ')}`;
});
</script>

<template>
  <span class="blocked" :class="{ compact }" role="img" :aria-label="label" :title="label" data-testid="blocked-indicator">
    <AppIcon name="lock" :size="11" />
    <span v-if="!compact" aria-hidden="true">Blocked</span>
  </span>
</template>

<style scoped>
.blocked {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 11.5px;
  font-weight: 650;
}

.compact {
  padding: 0 5px;
}
</style>
