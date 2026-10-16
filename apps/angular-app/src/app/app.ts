import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  IsActiveMatchOptions,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter, take } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Icon } from './components/icon';
import { TaskModal } from './components/task-modal';
import { HelpModal } from './components/help-modal';
import { Toasts } from './components/toasts';
import { NotificationBell } from './components/notification-bell';
import { StoreService } from './services/store.service';
import { UiService } from './services/ui.service';
import { ThemeService } from './services/theme.service';
import { ToastService } from './services/toast.service';
import { PomodoroService } from './services/pomodoro.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  testId: string;
}

const UI_KEY = 'taskpilot:ui';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    Icon,
    TaskModal,
    HelpModal,
    Toasts,
    NotificationBell,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class App {
  protected readonly store = inject(StoreService);
  protected readonly ui = inject(UiService);
  protected readonly theme = inject(ThemeService);
  protected readonly pomodoro = inject(PomodoroService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('globalSearch');

  protected readonly nav: NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', testId: 'nav-dashboard' },
    { path: '/tasks', label: 'Tasks', icon: 'tasks', testId: 'nav-tasks' },
    { path: '/board', label: 'Board', icon: 'board', testId: 'nav-board' },
    { path: '/calendar', label: 'Calendar', icon: 'calendar', testId: 'nav-calendar' },
    { path: '/projects', label: 'Projects', icon: 'projects', testId: 'nav-projects' },
    { path: '/timeline', label: 'Timeline', icon: 'timeline', testId: 'nav-timeline' },
    { path: '/reports', label: 'Reports', icon: 'reports', testId: 'nav-reports' },
    { path: '/activity', label: 'Activity', icon: 'activity', testId: 'nav-activity' },
    { path: '/settings', label: 'Settings', icon: 'settings', testId: 'nav-settings' },
  ];

  /** A saved view is "active" only when the list URL has exactly its params. */
  protected readonly viewActiveOptions: IsActiveMatchOptions = {
    paths: 'exact',
    queryParams: 'exact',
    fragment: 'ignored',
    matrixParams: 'ignored',
  };

  protected readonly search = signal('');
  protected readonly themeIcon = computed(
    () => ({ light: 'sun', dark: 'moon', system: 'system' })[this.theme.theme()],
  );
  protected readonly themeLabel = computed(() => `Theme: ${this.theme.theme()} (click to change)`);
  protected readonly openCount = computed(
    () => this.store.tasks().filter((t) => t.status !== 'done').length,
  );
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingG = 0;

  constructor() {
    afterNextRender(() => {
      const params = new URLSearchParams(window.location.search);
      const seedRaw = params.get('seed');
      const seed =
        seedRaw !== null && /^\d+$/.test(seedRaw) ? Math.min(parseInt(seedRaw, 10), 100_000) : null;
      this.store.init(seed);
      if (seedRaw !== null) {
        // Strip ?seed once the initial navigation has settled (router.url is still '/' before that,
        // and navigating early would cancel the initial navigation).
        const strip = () => {
          const tree = this.router.parseUrl(this.router.url);
          delete tree.queryParams['seed'];
          void this.router.navigateByUrl(tree, { replaceUrl: true });
        };
        if (this.router.navigated && this.router.url !== '/') strip();
        else
          this.router.events
            .pipe(
              filter((e): e is NavigationEnd => e instanceof NavigationEnd),
              take(1),
            )
            .subscribe(strip);
      }
      try {
        this.ui.sidebarCollapsed.set(localStorage.getItem(UI_KEY) === 'collapsed');
      } catch {
        /* ignore */
      }
    });
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => {
        this.ui.drawerOpen.set(false);
        const url = new URL(e.urlAfterRedirects, 'http://x');
        if (url.pathname === '/tasks') this.search.set(url.searchParams.get('q') ?? '');
      });
  }

  protected toggleSidebar(): void {
    const next = !this.ui.sidebarCollapsed();
    this.ui.sidebarCollapsed.set(next);
    try {
      localStorage.setItem(UI_KEY, next ? 'collapsed' : 'expanded');
    } catch {
      /* ignore */
    }
  }

  protected onSearchInput(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.goSearch(true), 200);
  }

  protected goSearch(debounced = false): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const q = this.search().trim();
    const onTasks = this.router.url.split('?')[0] === '/tasks';
    if (debounced && !onTasks && !q) return;
    const current = onTasks ? this.router.parseUrl(this.router.url).queryParams : {};
    void this.router.navigate(['/tasks'], {
      queryParams: { ...current, q: q || null, page: null },
      replaceUrl: onTasks && debounced,
    });
  }

  protected undo(): void {
    if (this.store.undo()) this.toast.show('Undone', { duration: 2000 });
  }

  protected redo(): void {
    if (this.store.redo()) this.toast.show('Redone', { duration: 2000 });
  }

  protected onKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const mod = e.ctrlKey || e.metaKey;

    if (mod && !e.altKey && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && !e.altKey && e.key.toLowerCase() === 'y' && !typing) {
      e.preventDefault();
      this.redo();
      return;
    }
    if (typing || mod || e.altKey) return;
    if (e.key === 'Escape' && this.ui.drawerOpen()) {
      this.ui.drawerOpen.set(false);
      return;
    }
    if (this.ui.anyModalOpen) return;

    const now = Date.now();
    if (this.pendingG && now - this.pendingG < 1200) {
      this.pendingG = 0;
      const dest = {
        d: '/dashboard',
        t: '/tasks',
        b: '/board',
        c: '/calendar',
        p: '/projects',
        a: '/activity',
        l: '/timeline',
        r: '/reports',
        s: '/settings',
      }[e.key];
      if (dest) {
        e.preventDefault();
        void this.router.navigateByUrl(dest);
      }
      return;
    }
    switch (e.key) {
      case 'g':
        this.pendingG = now;
        break;
      case 'n':
        e.preventDefault();
        this.ui.openNewTask();
        break;
      case '/':
        e.preventDefault();
        this.focusSearch();
        break;
      case '?':
        e.preventDefault();
        this.ui.helpOpen.set(true);
        break;
    }
  }

  private focusSearch(): void {
    const page = this.doc.querySelector<HTMLInputElement>('[data-testid="task-list-search"]');
    const el = page ?? this.searchInput().nativeElement;
    el.focus();
    el.select();
  }
}
