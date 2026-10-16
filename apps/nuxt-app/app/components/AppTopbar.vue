<script setup lang="ts">
import type { ThemeSetting } from '~/lib/types';
import type { IconName } from '~/lib/icons';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

const store = useTaskStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const search = ref(typeof route.query.q === 'string' && route.path === '/tasks' ? route.query.q : '');
watch(
  () => [route.path, route.query.q] as const,
  ([path, q]) => {
    if (path === '/tasks') search.value = typeof q === 'string' ? q : '';
  },
);

function submitSearch(): void {
  const q = search.value.trim();
  const query: Record<string, string> = q ? { q } : {};
  if (route.path === '/tasks') {
    const rest = { ...route.query } as Record<string, string>;
    delete rest.page;
    if (q) rest.q = q;
    else delete rest.q;
    void router.push({ path: '/tasks', query: rest });
  } else {
    void router.push({ path: '/tasks', query });
  }
}

const THEME_ORDER: ThemeSetting[] = ['light', 'dark', 'system'];
const THEME_META: Record<ThemeSetting, { icon: IconName; label: string }> = {
  light: { icon: 'sun', label: 'Light' },
  dark: { icon: 'moon', label: 'Dark' },
  system: { icon: 'monitor', label: 'System' },
};
const theme = computed(() => THEME_META[store.settings.theme]);

function cycleTheme(): void {
  const i = THEME_ORDER.indexOf(store.settings.theme);
  const next = THEME_ORDER[(i + 1) % THEME_ORDER.length] as ThemeSetting;
  store.updateSettings({ theme: next });
  ui.toast(`Theme: ${THEME_META[next].label}`, { duration: 1500 });
}

function doUndo(): void {
  ui.toast(store.undo() ? 'Undone' : 'Nothing to undo', { duration: 2000 });
}

function doRedo(): void {
  ui.toast(store.redo() ? 'Redone' : 'Nothing to redo', { duration: 2000 });
}
</script>

<template>
  <header class="topbar">
    <button
      type="button"
      class="btn btn-ghost btn-icon menu"
      aria-label="Open navigation"
      :aria-expanded="ui.drawerOpen"
      @click="ui.drawerOpen = true"
    >
      <AppIcon name="menu" />
    </button>

    <form class="search" role="search" @submit.prevent="submitSearch">
      <label for="global-search" class="sr-only">Search tasks</label>
      <AppIcon name="search" :size="16" class="search-icon" />
      <input
        id="global-search"
        v-model="search"
        type="search"
        class="search-input"
        placeholder="Search tasks…"
        data-testid="global-search"
        autocomplete="off"
        enterkeyhint="search"
      >
      <kbd class="search-kbd" aria-hidden="true">/</kbd>
    </form>

    <div class="actions">
      <PomodoroMini />
      <div class="history">
        <button type="button" class="btn btn-ghost btn-icon" :disabled="!store.canUndo" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" @click="doUndo">
          <AppIcon name="undo" />
        </button>
        <button type="button" class="btn btn-ghost btn-icon" :disabled="!store.canRedo" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" @click="doRedo">
          <AppIcon name="redo" />
        </button>
      </div>
      <NotificationBell />
      <button
        type="button"
        class="btn btn-ghost btn-icon"
        data-testid="theme-toggle"
        :aria-label="`Theme: ${theme.label}. Click to change.`"
        :title="`Theme: ${theme.label}`"
        @click="cycleTheme"
      >
        <AppIcon :name="theme.icon" />
      </button>
      <button type="button" class="btn btn-primary new-btn" data-testid="new-task-button" aria-keyshortcuts="n" @click="ui.openNewTask()">
        <AppIcon name="plus" :size="16" />
        <span class="new-label">New task</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--topbar-h);
  padding: 0 20px;
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  backdrop-filter: saturate(1.4) blur(10px);
  border-bottom: 1px solid var(--border);
}

.menu {
  display: none;
}

.search {
  position: relative;
  flex: 1;
  max-width: 460px;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 11px;
  color: var(--text-subtle);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 36px;
  padding: 0 34px 0 34px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

.search-kbd {
  position: absolute;
  right: 9px;
  pointer-events: none;
}

.search-input:focus + .search-kbd {
  display: none;
}

.actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.history {
  display: flex;
}

@media (max-width: 767px) {
  .topbar {
    padding: 0 10px;
    gap: 6px;
  }

  .menu {
    display: inline-flex;
  }

  .search-kbd,
  .history {
    display: none;
  }

  .new-btn {
    width: 36px;
    padding: 0;
  }

  .new-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }
}
</style>
