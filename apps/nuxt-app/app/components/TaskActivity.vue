<script setup lang="ts">
import type { ActivityEntry } from '~/lib/types';
import { useTaskStore } from '~/stores/tasks';

const props = defineProps<{ taskId: string }>();
const store = useTaskStore();
const lookups = useActivityLookups();
const STEP = 15;
const limit = ref(STEP);
watch(
  () => props.taskId,
  () => (limit.value = STEP),
);

/** Newest first. */
const entries = computed(() => {
  const out: ActivityEntry[] = [];
  for (let i = store.activity.length - 1; i >= 0; i--) {
    const e = store.activity[i] as ActivityEntry;
    if (e.taskId === props.taskId) out.push(e);
  }
  return out;
});
</script>

<template>
  <section class="card" aria-labelledby="activity-title" data-testid="task-activity">
    <div class="card-header">
      <h2 id="activity-title" class="card-title">Activity</h2>
      <NuxtLink to="/activity" class="small">All activity</NuxtLink>
    </div>
    <div class="card-body">
      <ol v-if="entries.length" class="timeline">
        <li v-for="e in entries.slice(0, limit)" :key="e.id">
          <ActivityItem :entry="e" :lookups="lookups" />
        </li>
      </ol>
      <p v-else class="muted none">No recorded changes yet. Edits, comments and status changes will show up here.</p>
      <button v-if="entries.length > limit" type="button" class="btn btn-sm more" @click="limit += 50">
        Show {{ Math.min(50, entries.length - limit) }} more
      </button>
    </div>
  </section>
</template>

<style scoped>
.small {
  font-size: 12.5px;
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: relative;
}

.timeline::before {
  content: '';
  position: absolute;
  left: 11.5px;
  top: 6px;
  bottom: 6px;
  width: 1px;
  background: var(--border);
}

.timeline > li {
  position: relative;
}

.none {
  margin: 0;
}

.more {
  margin-top: 12px;
}
</style>
