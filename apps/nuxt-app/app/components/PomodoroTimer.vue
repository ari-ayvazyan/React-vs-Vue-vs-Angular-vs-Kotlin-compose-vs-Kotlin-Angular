<script setup lang="ts">
import { formatMinutes } from '~/lib/dates';
import { usePomodoroStore } from '~/stores/pomodoro';
import { useTaskStore } from '~/stores/tasks';

const props = defineProps<{ taskId: string }>();
const pomo = usePomodoroStore();
const store = useTaskStore();

const isThis = computed(() => pomo.taskId === props.taskId);
const otherTask = computed(() => (pomo.taskId && !isThis.value ? store.taskById.get(pomo.taskId) : undefined));
const task = computed(() => store.taskById.get(props.taskId));

const display = computed(() => {
  if (isThis.value) return pomo.display;
  return `${String(store.settings.pomodoroMinutes).padStart(2, '0')}:00`;
});
const progress = computed(() => (isThis.value ? pomo.progress : 0));
const running = computed(() => isThis.value && pomo.running);

const R = 54;
const C = 2 * Math.PI * R;
</script>

<template>
  <section class="card pomo" aria-labelledby="pomo-title">
    <div class="card-header">
      <h2 id="pomo-title" class="card-title">Pomodoro</h2>
      <span class="muted small">{{ store.settings.pomodoroMinutes }} min focus</span>
    </div>
    <div class="card-body body">
      <div class="dial" :class="{ running }">
        <svg viewBox="0 0 128 128" aria-hidden="true">
          <circle cx="64" cy="64" :r="R" class="track" />
          <circle
            cx="64"
            cy="64"
            :r="R"
            class="bar"
            :stroke-dasharray="C"
            :stroke-dashoffset="C * (1 - progress)"
            transform="rotate(-90 64 64)"
          />
        </svg>
        <div class="time" role="timer" aria-live="off" :aria-label="`${display} remaining`">{{ display }}</div>
      </div>
      <div class="controls">
        <button v-if="!running" type="button" class="btn btn-primary" @click="pomo.start(taskId)">
          <AppIcon name="play" :size="14" />
          {{ isThis && pomo.isActive ? 'Resume' : 'Start' }}
        </button>
        <button v-else type="button" class="btn btn-primary" @click="pomo.pause()">
          <AppIcon name="pause" :size="14" />
          Pause
        </button>
        <button type="button" class="btn" :disabled="!isThis" @click="pomo.reset()">
          <AppIcon name="reset" :size="14" />
          Reset
        </button>
      </div>
      <p v-if="otherTask" class="note" role="note">
        A timer is active on <NuxtLink :to="`/tasks/${otherTask.id}`">{{ otherTask.title }}</NuxtLink>. Starting here will stop it and log its time.
      </p>
      <p v-if="task" class="spent">
        Time tracked: <strong>{{ formatMinutes(task.timeSpentMinutes) }}</strong>
        <template v-if="task.estimateMinutes"> of {{ formatMinutes(task.estimateMinutes) }} estimated</template>
      </p>
    </div>
  </section>
</template>

<style scoped>
.small {
  font-size: 12.5px;
}

.body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.dial {
  position: relative;
  width: 168px;
  height: 168px;
}

.dial svg {
  width: 100%;
  height: 100%;
}

.track {
  fill: none;
  stroke: var(--surface-2);
  stroke-width: 9;
}

.bar {
  fill: none;
  stroke: var(--danger);
  stroke-width: 9;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.25s linear;
}

.time {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 34px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.running .time {
  color: var(--danger);
}

.controls {
  display: flex;
  gap: 8px;
}

.note {
  font-size: 12.5px;
  color: var(--text-muted);
  background: var(--warning-soft);
  padding: 8px 10px;
  border-radius: 8px;
  text-align: center;
}

.spent {
  font-size: 13px;
  color: var(--text-muted);
}
</style>
