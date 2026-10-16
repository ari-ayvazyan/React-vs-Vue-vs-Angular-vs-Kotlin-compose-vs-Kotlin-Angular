import { watch } from 'vue';
import { useTaskStore } from '~/stores/tasks';
import { usePomodoroStore } from '~/stores/pomodoro';
import type { ThemeSetting } from '~/lib/types';

/**
 * Client-only bootstrapping. Data lives in localStorage, so it is loaded only AFTER hydration has
 * finished; server HTML and the first client render therefore match (both render the "loading" state).
 */
export default defineNuxtPlugin((nuxtApp) => {
  const store = useTaskStore();
  const router = useRouter();

  const applyTheme = (theme: ThemeSetting): void => {
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  };

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const save = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    store.persist();
  };

  const init = async (): Promise<void> => {
    const route = router.currentRoute.value;
    const seedRaw = route.query.seed;
    const seedCount = typeof seedRaw === 'string' && /^\d+$/.test(seedRaw) ? Math.min(Number(seedRaw), 100000) : undefined;
    store.load(seedCount);
    if (seedRaw !== undefined) {
      if (seedCount !== undefined) save();
      const query = { ...route.query };
      delete query.seed;
      await router.replace({ path: route.path, query, hash: route.hash });
    }
    applyTheme(store.settings.theme);
    watch(
      () => store.settings.theme,
      (t) => applyTheme(t),
    );
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.settings.theme));
    // Watch exactly what gets persisted, so any new top-level state is saved automatically.
    watch(() => store.serialize(), () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 300);
    });
    window.addEventListener('pagehide', () => {
      if (saveTimer) save();
    });
    const pomodoro = usePomodoroStore();
    watch(
      () => store.settings.pomodoroMinutes,
      (m) => pomodoro.syncDuration(m),
    );
    setInterval(() => store.refreshToday(), 60000);
    // Due/overdue reminders: once per task per day, re-checked when tasks, the current user or the day change.
    watch([() => store.tasks, () => store.settings.currentUserId, () => store.today], () => store.checkDueReminders(), { immediate: true });
  };

  nuxtApp.hooks.hookOnce('app:suspense:resolve', () => {
    void init();
  });
});
