'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { parseSeed } from '@/lib/store';
import { boardSearch, normalizeSearch, viewQuery } from '@/lib/views';
import type { ThemeSetting } from '@/lib/types';
import {
  IconActivity,
  IconBoard,
  IconBookmark,
  IconChart,
  IconTimeline,
  IconCalendar,
  IconChevronLeft,
  IconClock,
  IconDashboard,
  IconFolder,
  IconKeyboard,
  IconList,
  IconLogo,
  IconMenu,
  IconMonitor,
  IconMoon,
  IconPause,
  IconPlus,
  IconRedo,
  IconSearch,
  IconSettings,
  IconSun,
  IconUndo,
  IconX,
} from './icons';
import { NotificationsBell } from './Notifications';
import { formatClock, usePomodoro } from './pomodoro';
import { getStore, useStoreSnapshot } from './store-hooks';
import { useToast } from './toast';
import { useUI } from './ui';
import styles from './shell.module.css';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', id: 'dashboard', Icon: IconDashboard },
  { href: '/tasks', label: 'Tasks', id: 'tasks', Icon: IconList },
  { href: '/board', label: 'Board', id: 'board', Icon: IconBoard },
  { href: '/calendar', label: 'Calendar', id: 'calendar', Icon: IconCalendar },
  { href: '/timeline', label: 'Timeline', id: 'timeline', Icon: IconTimeline },
  { href: '/reports', label: 'Reports', id: 'reports', Icon: IconChart },
  { href: '/projects', label: 'Projects', id: 'projects', Icon: IconFolder },
  { href: '/activity', label: 'Activity', id: 'activity', Icon: IconActivity },
  { href: '/settings', label: 'Settings', id: 'settings', Icon: IconSettings },
] as const;

// ---------------------------------------------------------------------------
// Sidebar collapsed preference (per browser; applied pre-paint by the inline script in layout.tsx)

const UI_KEY = 'taskpilot:ui';
const sidebarListeners = new Set<() => void>();
const subscribeSidebar = (l: () => void) => {
  sidebarListeners.add(l);
  return () => sidebarListeners.delete(l);
};
const getSidebarCollapsed = () => document.documentElement.dataset.sidebar === 'collapsed';
function setSidebarCollapsed(collapsed: boolean) {
  if (collapsed) document.documentElement.dataset.sidebar = 'collapsed';
  else delete document.documentElement.dataset.sidebar;
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ sidebarCollapsed: collapsed }));
  } catch {
    // ignore
  }
  sidebarListeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------

/** Saved task-list views. `search` is the current query string when on /tasks (null otherwise / unknown). */
function ViewsNav({ search, onNavigate }: { search: string | null; onNavigate?: () => void }) {
  const views = useStoreSnapshot()?.state.views ?? [];
  const current = search === null ? null : normalizeSearch(search);
  return (
    <div className={styles.views} aria-labelledby="nav-views-title">
      <h2 id="nav-views-title" className={styles.viewsTitle}>
        <span className={styles.navLabel}>Views</span>
      </h2>
      {views.length ? (
        <ul className={styles.navList} data-testid="nav-views">
          {views.map((v) => {
            const isActive = current === v.search;
            return (
              <li key={v.id} className={styles.viewItem}>
                <Link
                  href={`/tasks${v.search}`}
                  className={`${styles.navLink} ${isActive ? styles.navActive : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={onNavigate}
                  title={v.name}
                  data-testid="nav-view"
                >
                  <IconBookmark size={17} />
                  <span className={`${styles.navLabel} ${styles.viewLabel}`}>{v.name}</span>
                </Link>
                <Link
                  href={`/board${boardSearch(viewQuery(v))}`}
                  className={styles.viewBoard}
                  onClick={onNavigate}
                  aria-label={`Open “${v.name}” on the board`}
                  title="Open on board"
                  data-testid="nav-view-board"
                >
                  <IconBoard size={15} />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={`${styles.navLabel} ${styles.viewsEmpty}`}>Use “Save view” on the task list to pin filters here.</p>
      )}
    </div>
  );
}

function NavList({ active, onNavigate }: { active: string | null; onNavigate?: () => void }) {
  return (
    <ul className={styles.navList}>
      {NAV.map(({ href, label, id, Icon }) => {
        const isActive = active !== null && (active === href || active.startsWith(`${href}/`));
        return (
          <li key={id}>
            <Link
              href={href}
              className={`${styles.navLink} ${isActive ? styles.navActive : ''}`}
              aria-current={isActive ? 'page' : undefined}
              data-testid={`nav-${id}`}
              onClick={onNavigate}
              title={label}
            >
              <Icon size={19} />
              <span className={styles.navLabel}>{label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ActiveNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <>
      <NavList active={pathname} onNavigate={onNavigate} />
      <ViewsNav search={pathname === '/tasks' ? `?${params.toString()}` : null} onNavigate={onNavigate} />
    </>
  );
}

/** Applies `?seed=N` on any route, then strips the parameter. */
function SeedHandler() {
  const params = useSearchParams();
  const seed = params.get('seed');
  useEffect(() => {
    if (seed === null) return;
    const store = getStore();
    store.getSnapshot();
    const n = parseSeed(seed);
    if (n !== null) {
      if (store.initialSeed === n) store.initialSeed = null; // already applied while loading
      else store.seed(n);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('seed');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [seed]);
  return null;
}

/** Keeps <html data-theme> in sync with the persisted setting (and the OS when "system"). */
function ThemeSync({ theme }: { theme: ThemeSetting | undefined }) {
  useEffect(() => {
    if (!theme) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
    };
    apply();
    if (theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  return null;
}

const THEME_LABEL: Record<ThemeSetting, string> = { light: 'Light', dark: 'Dark', system: 'System' };

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type);
  }
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function focusSearch() {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>('[data-testid="task-list-search"], [data-testid="global-search"]'),
  ).filter((el) => el.offsetParent !== null);
  candidates[0]?.focus();
  candidates[0]?.select();
}

function SearchBox() {
  const router = useRouter();
  const [value, setValue] = useState('');
  return (
    <form
      role="search"
      className={styles.search}
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        router.push(q ? `/tasks?q=${encodeURIComponent(q)}` : '/tasks');
        setValue('');
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <IconSearch size={16} className={styles.searchIcon} />
      <label htmlFor="global-search" className="sr-only">
        Search tasks
      </label>
      <input
        id="global-search"
        type="search"
        className={styles.searchInput}
        placeholder="Search tasks…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        data-testid="global-search"
        autoComplete="off"
        enterKeyHint="search"
      />
      <kbd className={`kbd ${styles.searchKbd}`} aria-hidden="true">
        /
      </kbd>
    </form>
  );
}

function PomodoroIndicator() {
  const pomo = usePomodoro();
  const snap = useStoreSnapshot();
  if (!pomo.active || !pomo.taskId) return null;
  const task = snap?.state.tasks.find((t) => t.id === pomo.taskId);
  return (
    <Link
      href={`/tasks/${pomo.taskId}`}
      className={`${styles.pomo} ${pomo.running ? styles.pomoRunning : ''}`}
      aria-label={`Pomodoro ${pomo.running ? 'running' : 'paused'}: ${formatClock(pomo.remainingMs)} left${task ? ` on ${task.title}` : ''}`}
      title={task?.title}
    >
      {pomo.running ? <IconClock size={15} /> : <IconPause size={13} />}
      <span className={styles.pomoTime}>{formatClock(pomo.remainingMs)}</span>
      {task && <span className={styles.pomoTitle}>{task.title}</span>}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { openTaskModal, openShortcuts } = useUI();
  const toast = useToast();
  const snap = useStoreSnapshot();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarCollapsed, () => false);
  const pendingG = useRef<number | null>(null);
  const theme = snap?.state.settings.theme;

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
        if (isTyping(e.target)) return; // keep native text undo inside fields
        e.preventDefault();
        const redo = e.key === 'y' || e.shiftKey;
        const store = getStore();
        const ok = redo ? store.redo() : store.undo();
        toast(ok ? (redo ? 'Redone' : 'Undone') : redo ? 'Nothing to redo' : 'Nothing to undo', { duration: 2000 });
        return;
      }
      if (mod || e.altKey || isTyping(e.target) || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;

      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const dest = { d: '/dashboard', t: '/tasks', b: '/board', c: '/calendar', a: '/activity', l: '/timeline', r: '/reports' }[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          router.push(dest);
          return;
        }
      }
      switch (e.key) {
        case 'n':
        case 'N':
          if (e.shiftKey) return;
          e.preventDefault();
          openTaskModal();
          break;
        case '/':
          e.preventDefault();
          focusSearch();
          break;
        case '?':
          e.preventDefault();
          openShortcuts();
          break;
        case 'g':
          pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200);
          break;
        case 'Escape':
          setDrawerOpen(false);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, openTaskModal, openShortcuts, toast]);

  const closeDrawer = () => setDrawerOpen(false);
  /** Flips the *effective* theme (light <-> dark); "system" can be chosen again in Settings. */
  const toggleTheme = () => {
    if (!theme) return;
    const effective = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    getStore().updateSettings({ theme: effective === 'dark' ? 'light' : 'dark' });
  };
  const ThemeIcon = theme === 'dark' ? IconMoon : theme === 'light' ? IconSun : IconMonitor;

  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <ThemeSync theme={theme} />
      <Suspense fallback={null}>
        <SeedHandler />
      </Suspense>

      <aside
        id="sidebar"
        className={`${styles.sidebar} ${drawerOpen ? styles.drawerOpen : ''}`}
        aria-label="Primary"
      >
        <div className={styles.brand}>
          <Link href="/dashboard" className={styles.brandLink} onClick={closeDrawer} aria-label="TaskPilot home">
            <span className={styles.logo}>
              <IconLogo size={16} />
            </span>
            <span className={styles.brandName}>TaskPilot</span>
          </Link>
          <button type="button" className={`icon-btn ${styles.drawerClose}`} onClick={closeDrawer} aria-label="Close navigation">
            <IconX />
          </button>
        </div>
        <nav className={styles.nav} aria-label="Main navigation">
          <Suspense
            fallback={
              <>
                <NavList active={null} onNavigate={closeDrawer} />
                <ViewsNav search={null} onNavigate={closeDrawer} />
              </>
            }
          >
            <ActiveNav onNavigate={closeDrawer} />
          </Suspense>
        </nav>
        <div className={styles.sidebarFooter}>
          <button
            type="button"
            className={styles.collapseBtn}
            onClick={() => setSidebarCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls="sidebar"
          >
            <IconChevronLeft size={17} className={styles.collapseIcon} />
            <span className={styles.navLabel}>Collapse</span>
          </button>
        </div>
      </aside>
      {drawerOpen && <button type="button" className={styles.scrim} aria-label="Close navigation" onClick={closeDrawer} tabIndex={-1} />}

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={`icon-btn ${styles.menuBtn}`}
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="sidebar"
          >
            <IconMenu />
          </button>
          <SearchBox />
          <div className={styles.topActions}>
            <PomodoroIndicator />
            <NotificationsBell />
            <button
              type="button"
              className={`icon-btn ${styles.hideMobile}`}
              onClick={() => getStore().undo()}
              disabled={!snap?.canUndo}
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
            >
              <IconUndo />
            </button>
            <button
              type="button"
              className={`icon-btn ${styles.hideMobile}`}
              onClick={() => getStore().redo()}
              disabled={!snap?.canRedo}
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
            >
              <IconRedo />
            </button>
            <button type="button" className={`icon-btn ${styles.hideMobile}`} onClick={openShortcuts} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
              <IconKeyboard />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              data-testid="theme-toggle"
              aria-label={theme ? `Theme: ${THEME_LABEL[theme]}. Toggle light or dark` : 'Toggle theme'}
              title={theme ? `Theme: ${THEME_LABEL[theme]} (click to toggle)` : 'Theme'}
            >
              <ThemeIcon />
            </button>
            <button
              type="button"
              className={`btn btn-primary ${styles.newBtn}`}
              onClick={() => openTaskModal()}
              data-testid="new-task-button"
              aria-label="New task"
              title="New task (N)"
              disabled={!snap}
            >
              <IconPlus size={17} />
              <span className={styles.newLabel}>New task</span>
            </button>
          </div>
        </header>
        <main id="main" className={styles.content} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
