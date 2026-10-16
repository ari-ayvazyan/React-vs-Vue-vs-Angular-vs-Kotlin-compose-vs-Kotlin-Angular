<script setup lang="ts">
import { formatDate, relativeDue } from '~/lib/dates';
import { useTaskStore } from '~/stores/tasks';
import type { Status } from '~/lib/types';

const props = defineProps<{ due: string | null; status: Status }>();
const store = useTaskStore();
const overdue = computed(() => props.status !== 'done' && !!props.due && props.due < store.today);
const isToday = computed(() => props.due === store.today);
</script>

<template>
  <span v-if="due" class="due" :class="{ overdue, today: isToday && status !== 'done' }" :title="due">
    <AppIcon :name="overdue ? 'alert' : 'calendar'" :size="13" />
    <span>{{ status === 'done' ? formatDate(due) : relativeDue(due, store.today) }}</span>
  </span>
  <span v-else class="due none">No date</span>
</template>

<style scoped>
.due {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--text-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.overdue {
  color: var(--danger);
  font-weight: 600;
}

.today {
  color: var(--warning);
  font-weight: 600;
}

:root[data-theme='dark'] .today {
  color: var(--p-high);
}

.none {
  color: var(--text-subtle);
}
</style>
