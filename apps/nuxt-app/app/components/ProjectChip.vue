<script setup lang="ts">
import { useTaskStore } from '~/stores/tasks';

const props = defineProps<{ projectId: string | null }>();
const store = useTaskStore();
const project = computed(() => (props.projectId ? store.projectById.get(props.projectId) : undefined));
</script>

<template>
  <span v-if="project" class="chip" :title="project.name">
    <span class="dot" :style="{ background: project.color }" aria-hidden="true" />
    <span class="name">{{ project.name }}</span>
  </span>
  <span v-else class="chip none">No project</span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-muted);
  min-width: 0;
  max-width: 100%;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.none {
  color: var(--text-subtle);
  font-style: italic;
}
</style>
