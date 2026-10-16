import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { SavedView, TaskQueries, activeView, validateViewName } from './core/kt';
import { PomodoroService } from './core/pomodoro.service';
import { ShortcutsService } from './core/shortcuts.service';
import { StoreService } from './core/store.service';
import { ThemeService } from './core/theme.service';
import { UiService } from './core/ui.service';
import { HelpModal } from './layout/help-modal';
import { NotificationsBell } from './layout/notifications-bell';
import { TaskModal } from './layout/task-modal';
import { Toasts } from './layout/toasts';
import { Autofocus } from './shared/autofocus';
import { Icon } from './shared/icon';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  testId: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, TaskModal, HelpModal, Toasts, Autofocus, NotificationsBell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
})
export class App {
  protected readonly store = inject(StoreService);
  protected readonly ui = inject(UiService);
  protected readonly theme = inject(ThemeService);
  protected readonly pomodoro = inject(PomodoroService);
  private readonly shortcuts = inject(ShortcutsService);
  private readonly router = inject(Router);

  protected readonly nav: NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', testId: 'nav-dashboard' },
    { path: '/tasks', label: 'Tasks', icon: 'tasks', testId: 'nav-tasks' },
    { path: '/board', label: 'Board', icon: 'board', testId: 'nav-board' },
    { path: '/calendar', label: 'Calendar', icon: 'calendar', testId: 'nav-calendar' },
    { path: '/projects', label: 'Projects', icon: 'projects', testId: 'nav-projects' },
    { path: '/timeline', label: 'Timeline', icon: 'timeline', testId: 'nav-timeline' },
    { path: '/reports', label: 'Reports', icon: 'chart', testId: 'nav-reports' },
    { path: '/activity', label: 'Activity', icon: 'activity', testId: 'nav-activity' },
    { path: '/settings', label: 'Settings', icon: 'settings', testId: 'nav-settings' },
  ];

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  protected readonly globalSearch = signal('');

  // ---- saved views in the sidebar ----
  protected readonly activeViewId = computed(() => {
    const url = this.url();
    if (url.split('?')[0] !== '/tasks') return null;
    return activeView(this.store.views(), url.includes('?') ? url.slice(url.indexOf('?')) : '')?.id ?? null;
  });
  protected readonly renamingView = signal<string | null>(null);
  protected readonly renameError = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Before data is loaded (SSR / hydration) the icon must not depend on client-only state. */
  protected readonly themeIcon = computed(() =>
    this.store.ready() ? (this.theme.resolved() === 'dark' ? 'sun' : 'moon') : 'moon',
  );
  protected readonly themeLabel = computed(() =>
    this.store.ready() && this.theme.resolved() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
  );

  constructor() {
    this.shortcuts.install();

    afterNextRender(() => {
      const seeded = this.store.initialize(window.location.search);
      if (seeded >= 0) {
        // Drop only the `seed` param, staying on the current route. `router.url` may still be "/" here
        // (initial navigation can finish after the first render), so derive the target from location.
        const url = new URL(window.location.href);
        url.searchParams.delete('seed');
        void this.router.navigateByUrl(url.pathname + url.search + url.hash, { replaceUrl: true });
        this.ui.toast(`Loaded ${seeded} demo tasks`, { tone: 'success' });
      }
      // Keep "today" correct when the app stays open past midnight.
      setInterval(() => this.store.refreshToday(), 60_000);
    });

    // Keep the top-bar search in sync with the task list's `q` param.
    effect(() => {
      const url = this.url();
      if (!this.store.ready() || !url.startsWith('/tasks')) return;
      const path = url.split('?')[0];
      if (path !== '/tasks') return;
      const q = TaskQueries.parse(url.includes('?') ? url.slice(url.indexOf('?')) : '').search;
      untracked(() => {
        if (this.searchInput()?.nativeElement !== document.activeElement) this.globalSearch.set(q);
      });
    });

    effect(() => {
      if (this.ui.searchFocusRequest() > 0) {
        untracked(() => {
          const el = this.searchInput()?.nativeElement;
          el?.focus();
          el?.select();
        });
      }
    });

    // Close the mobile drawer after navigating.
    effect(() => {
      this.url();
      untracked(() => this.ui.drawerOpen.set(false));
    });
  }

  protected onGlobalSearch(value: string): void {
    this.globalSearch.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.applyGlobalSearch(), 200);
  }

  protected applyGlobalSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    const url = this.router.url;
    const onTasks = url.split('?')[0] === '/tasks';
    const base = onTasks ? TaskQueries.parse(url.includes('?') ? url.slice(url.indexOf('?')) : '') : TaskQueries.DEFAULT;
    const qs = base.withSearch(this.globalSearch().trim()).toQueryString();
    void this.router.navigateByUrl('/tasks' + (qs ? '?' + qs : ''), { replaceUrl: onTasks });
  }

  protected viewParams(v: SavedView): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(v.query));
  }

  protected boardParams(v: SavedView): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(v.boardQueryString()));
  }

  protected startRename(v: SavedView): void {
    this.renameError.set('');
    this.renamingView.set(v.id);
  }

  protected finishRename(v: SavedView, name: string): void {
    if (this.renamingView() !== v.id) return;
    if (name.trim() === v.name) {
      this.renamingView.set(null);
      return;
    }
    if (this.store.renameView(v.id, name)) {
      this.renamingView.set(null);
    } else {
      this.renameError.set(validateViewName(this.store.views(), name, v.id));
    }
  }

  protected deleteView(v: SavedView): void {
    this.store.deleteView(v.id);
    this.ui.toast(`Deleted view “${v.name}”`, { actionLabel: 'Undo', action: () => this.store.undo() });
  }

  protected undo(): void {
    this.shortcuts.undo();
  }

  protected redo(): void {
    this.shortcuts.redo();
  }
}
