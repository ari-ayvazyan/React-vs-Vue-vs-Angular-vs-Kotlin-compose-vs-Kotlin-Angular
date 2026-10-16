<script setup lang="ts">
import type { IconName } from '~/lib/icons';
import { useUiStore } from '~/stores/ui';
import { useTaskStore } from '~/stores/tasks';
import { parseTaskQuery } from '~/lib/filters';
import { boardQueryOf, findMatchingView } from '~/lib/views';
import { projectTree } from '~/lib/projects';

const ui = useUiStore();
const store = useTaskStore();
const route = useRoute();

const items: { to: string; label: string; icon: IconName; testid: string }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', testid: 'nav-dashboard' },
  { to: '/tasks', label: 'Tasks', icon: 'tasks', testid: 'nav-tasks' },
  { to: '/board', label: 'Board', icon: 'board', testid: 'nav-board' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar', testid: 'nav-calendar' },
  { to: '/timeline', label: 'Timeline', icon: 'timeline', testid: 'nav-timeline' },
  { to: '/projects', label: 'Projects', icon: 'projects', testid: 'nav-projects' },
  { to: '/reports', label: 'Reports', icon: 'report', testid: 'nav-reports' },
  { to: '/activity', label: 'Activity', icon: 'activity', testid: 'nav-activity' },
  { to: '/settings', label: 'Settings', icon: 'settings', testid: 'nav-settings' },
];

const isActive = (to: string): boolean => route.path === to || route.path.startsWith(`${to}/`);

/** Projects in tree order (sub-projects indented under their parent). */
const projectNodes = computed(() => projectTree(store.projects));

/** The saved view matching the current task-list query, highlighted in the list. */
const activeViewId = computed(() =>
  route.path === '/tasks' ? findMatchingView(store.views, parseTaskQuery(route.query as Record<string, string>))?.id : undefined,
);

watch(
  () => route.fullPath,
  () => (ui.drawerOpen = false),
);
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: ui.sidebarCollapsed, open: ui.drawerOpen }" aria-label="Primary" @keydown.esc="ui.drawerOpen = false">
    <div class="brand">
      <NuxtLink to="/dashboard" class="logo" aria-label="TaskPilot home">
        <span class="mark" aria-hidden="true">
          <AppIcon name="check" :size="16" />
        </span>
        <span class="brand-name">TaskPilot</span>
      </NuxtLink>
      <button type="button" class="btn btn-ghost btn-icon btn-sm close-drawer" aria-label="Close navigation" @click="ui.drawerOpen = false">
        <AppIcon name="x" :size="16" />
      </button>
    </div>
    <nav class="nav">
      <ul>
        <li v-for="item in items" :key="item.to">
          <NuxtLink
            :to="item.to"
            class="nav-link"
            :class="{ active: isActive(item.to) }"
            :data-testid="item.testid"
            :aria-current="isActive(item.to) ? 'page' : undefined"
            :title="ui.sidebarCollapsed ? item.label : undefined"
          >
            <AppIcon :name="item.icon" :size="18" />
            <span class="label">{{ item.label }}</span>
          </NuxtLink>
        </li>
      </ul>
    </nav>
    <div class="lists">
      <div v-if="store.ready && store.views.length" class="views" data-testid="sidebar-views">
        <p class="section-title">Views</p>
        <ul>
          <li v-for="v in store.views" :key="v.id" class="view-item">
            <NuxtLink
              :to="{ path: '/tasks', query: v.query }"
              class="proj-link"
              :class="{ active: activeViewId === v.id }"
              :aria-current="activeViewId === v.id ? 'page' : undefined"
              :title="v.name"
              data-testid="sidebar-view"
            >
              <AppIcon name="bookmark" :size="14" />
              <span class="label">{{ v.name }}</span>
            </NuxtLink>
            <NuxtLink :to="{ path: '/board', query: boardQueryOf(v.query) }" class="view-board" :aria-label="`Open view “${v.name}” on the board`" :title="`Open “${v.name}” on the board`">
              <AppIcon name="board" :size="13" />
            </NuxtLink>
          </li>
        </ul>
      </div>
      <div v-if="store.ready && store.projects.length" class="projects">
        <p class="section-title">Projects</p>
        <ul>
          <li v-for="n in projectNodes" :key="n.project.id">
            <NuxtLink :to="{ path: '/tasks', query: { project: n.project.id } }" class="proj-link" :style="{ '--depth': n.depth }" :title="n.path">
              <span class="dot" :style="{ background: n.project.color }" aria-hidden="true" />
              <span class="label">{{ n.project.name }}</span>
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>
    <div class="foot">
      <button type="button" class="nav-link help" @click="ui.helpOpen = true">
        <AppIcon name="keyboard" :size="18" />
        <span class="label">Shortcuts <kbd>?</kbd></span>
      </button>
      <button
        type="button"
        class="nav-link collapse-btn"
        :aria-label="ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-expanded="!ui.sidebarCollapsed"
        @click="ui.sidebarCollapsed = !ui.sidebarCollapsed"
      >
        <AppIcon :name="ui.sidebarCollapsed ? 'chevronRight' : 'chevronLeft'" :size="18" />
        <span class="label">Collapse</span>
      </button>
    </div>
  </aside>
  <div v-if="ui.drawerOpen" class="scrim" aria-hidden="true" @click="ui.drawerOpen = false" />
</template>

<style scoped>
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  width: var(--sidebar-w);
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 12px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  transition: width 0.18s ease;
  overflow: hidden;
  z-index: 50;
}

.collapsed {
  width: var(--sidebar-w-collapsed);
}

.brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 6px;
  margin-bottom: 10px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
  font-weight: 750;
  font-size: 16px;
  letter-spacing: -0.02em;
  text-decoration: none;
}

.logo:hover {
  text-decoration: none;
}

.mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  flex: none;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 38px;
  padding: 0 11px;
  border-radius: 8px;
  color: var(--text-muted);
  font-weight: 550;
  text-decoration: none;
  border: 0;
  background: none;
  cursor: pointer;
  white-space: nowrap;
}

.nav-link:hover {
  background: var(--surface-hover);
  color: var(--text);
  text-decoration: none;
}

.nav-link.active {
  background: var(--accent-soft);
  color: var(--accent-text);
}

.section-title {
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-subtle);
  padding: 14px 12px 6px;
  white-space: nowrap;
}

.lists {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.view-item {
  position: relative;
}

.proj-link.active {
  background: var(--accent-soft);
  color: var(--accent-text);
}

.view-item .proj-link {
  padding-right: 34px;
}

.view-board {
  position: absolute;
  right: 4px;
  top: 4px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--text-subtle);
  opacity: 0;
}

.view-item:hover .view-board,
.view-board:focus-visible {
  opacity: 1;
}

.view-board:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.collapsed .view-board {
  display: none;
}

.proj-link {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 32px;
  padding: 0 16px 0 calc(16px + var(--depth, 0) * 14px);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
  white-space: nowrap;
  text-decoration: none;
}

.proj-link:hover {
  background: var(--surface-hover);
  color: var(--text);
  text-decoration: none;
}

.foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapsed .label,
.collapsed .brand-name,
.collapsed .section-title {
  display: none;
}

.collapsed .proj-link {
  justify-content: center;
  padding: 0;
}

.close-drawer,
.scrim {
  display: none;
}

@media (max-width: 767px) {
  .sidebar,
  .sidebar.collapsed {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 272px;
    transform: translateX(-100%);
    visibility: hidden;
    transition:
      transform 0.2s ease,
      visibility 0s linear 0.2s;
    box-shadow: var(--shadow-lg);
    z-index: 90;
  }

  .sidebar.open {
    transform: translateX(0);
    visibility: visible;
    transition: transform 0.2s ease;
  }

  .sidebar .label,
  .sidebar .brand-name,
  .sidebar .section-title {
    display: initial;
  }

  .sidebar .proj-link {
    justify-content: flex-start;
    padding: 0 16px 0 calc(16px + var(--depth, 0) * 14px);
  }

  .close-drawer {
    display: inline-flex;
  }

  .collapse-btn {
    display: none;
  }

  .scrim {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(10, 14, 24, 0.45);
    z-index: 80;
  }
}
</style>
