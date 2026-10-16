import { DOCUMENT, Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { StoreService } from './store.service';
import { Theme } from '../core/models';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly store = inject(StoreService);
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly systemDark = signal(false);

  readonly theme = computed<Theme>(() => this.store.settings().theme);
  readonly resolved = computed<'light' | 'dark'>(() => {
    const t = this.theme();
    return t === 'system' ? (this.systemDark() ? 'dark' : 'light') : t;
  });

  constructor() {
    if (!this.isBrowser) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    this.systemDark.set(mq.matches);
    mq.addEventListener('change', (e) => this.systemDark.set(e.matches));
    effect(() => {
      if (!this.store.ready()) return;
      const root = this.doc.documentElement;
      root.dataset['theme'] = this.resolved();
      root.style.colorScheme = this.resolved();
    });
  }

  set(theme: Theme): void {
    this.store.updateSettings({ theme });
  }

  /** Cycles light → dark → system. */
  cycle(): void {
    const order: Theme[] = ['light', 'dark', 'system'];
    this.set(order[(order.indexOf(this.theme()) + 1) % order.length]);
  }
}
