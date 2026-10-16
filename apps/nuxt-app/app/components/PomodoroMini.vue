<script setup lang="ts">
import { usePomodoroStore } from '~/stores/pomodoro';
import { useTaskStore } from '~/stores/tasks';

const pomo = usePomodoroStore();
const store = useTaskStore();
const task = computed(() => (pomo.taskId ? store.taskById.get(pomo.taskId) : undefined));
</script>

<template>
  <NuxtLink
    v-if="pomo.isActive && task"
    :to="`/tasks/${task.id}`"
    class="mini"
    :class="{ paused: !pomo.running }"
    :title="`Pomodoro: ${task.title}`"
    :aria-label="`Pomodoro ${pomo.running ? 'running' : 'paused'}, ${pomo.display} left on ${task.title}`"
  >
    <span class="pulse" aria-hidden="true" />
    <span class="time">{{ pomo.display }}</span>
    <span class="name">{{ task.title }}</span>
  </NuxtLink>
</template>

<style scoped>
.mini {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--danger-soft);
  color: var(--danger);
  font-weight: 650;
  font-size: 13px;
  max-width: 260px;
  text-decoration: none;
}

.mini:hover {
  text-decoration: none;
  filter: brightness(0.97);
}

.paused {
  background: var(--surface-2);
  color: var(--text-muted);
}

.pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 1.4s ease-in-out infinite;
}

.paused .pulse {
  animation: none;
}

.time {
  font-variant-numeric: tabular-nums;
}

.name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

@media (max-width: 767px) {
  .name {
    display: none;
  }
}
</style>
