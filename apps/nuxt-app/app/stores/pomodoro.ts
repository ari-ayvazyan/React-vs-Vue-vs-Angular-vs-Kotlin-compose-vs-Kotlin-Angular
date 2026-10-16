import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useTaskStore } from './tasks';
import { useUiStore } from './ui';

/**
 * Pomodoro timer. Lives in a store so it keeps running across route changes.
 * Elapsed wall-clock time is logged to the task's timeSpentMinutes on pause / finish / reset.
 */
export const usePomodoroStore = defineStore('pomodoro', () => {
  const taskId = ref<string | null>(null);
  const durationMs = ref(25 * 60000);
  const remainingMs = ref(25 * 60000);
  const running = ref(false);
  /** wall clock (ms) when the current run segment started */
  let segmentStart = 0;
  let remainingAtStart = 0;
  /** elapsed ms not yet written to the task (sub-minute remainder carried between pauses) */
  let unloggedMs = 0;
  let interval: ReturnType<typeof setInterval> | null = null;

  const isActive = computed(() => taskId.value !== null && (running.value || remainingMs.value < durationMs.value));
  const display = computed(() => {
    const total = Math.ceil(remainingMs.value / 1000);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  });
  const progress = computed(() => 1 - remainingMs.value / durationMs.value);

  function stopTicker(): void {
    if (interval) clearInterval(interval);
    interval = null;
  }

  /** Close the current run segment, adding its time to the unlogged bucket. */
  function closeSegment(): void {
    if (!running.value) return;
    const elapsed = Date.now() - segmentStart;
    unloggedMs += Math.min(elapsed, remainingAtStart);
    remainingMs.value = Math.max(0, remainingAtStart - elapsed);
    running.value = false;
    stopTicker();
  }

  /** Write whole minutes to the task. `final` rounds the remainder instead of carrying it. */
  function flush(final: boolean): void {
    if (!taskId.value) return;
    const minutes = final ? Math.round(unloggedMs / 60000) : Math.floor(unloggedMs / 60000);
    if (minutes > 0) useTaskStore().addTimeSpent(taskId.value, minutes);
    unloggedMs = final ? 0 : unloggedMs - minutes * 60000;
  }

  function tick(): void {
    if (!running.value) return;
    const left = remainingAtStart - (Date.now() - segmentStart);
    remainingMs.value = Math.max(0, left);
    if (left <= 0) finish();
  }

  function setup(id: string): void {
    if (taskId.value === id) return;
    if (taskId.value) reset();
    const minutes = useTaskStore().settings.pomodoroMinutes;
    taskId.value = id;
    durationMs.value = minutes * 60000;
    remainingMs.value = durationMs.value;
  }

  function start(id: string): void {
    setup(id);
    if (running.value) return;
    if (remainingMs.value <= 0) remainingMs.value = durationMs.value;
    running.value = true;
    segmentStart = Date.now();
    remainingAtStart = remainingMs.value;
    stopTicker();
    interval = setInterval(tick, 250);
  }

  function pause(): void {
    closeSegment();
    flush(false);
  }

  function finish(): void {
    closeSegment();
    flush(true);
    const id = taskId.value;
    remainingMs.value = durationMs.value;
    const title = id ? useTaskStore().taskById.get(id)?.title : undefined;
    useUiStore().toast(`Pomodoro finished${title ? ` for “${title}”` : ''}. Time logged.`, { kind: 'success' });
    taskId.value = null;
  }

  function reset(): void {
    closeSegment();
    flush(true);
    remainingMs.value = durationMs.value;
    taskId.value = null;
  }

  /** Called when the pomodoro length setting changes and no session is in progress. */
  function syncDuration(minutes: number): void {
    if (running.value || remainingMs.value < durationMs.value) return;
    durationMs.value = minutes * 60000;
    remainingMs.value = durationMs.value;
  }

  return { taskId, durationMs, remainingMs, running, isActive, display, progress, start, pause, reset, finish, syncDuration };
});
