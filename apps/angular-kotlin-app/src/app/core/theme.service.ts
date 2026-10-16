import { DOCUMENT, Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Theme } from './kt';
import { StoreService } from './store.service';

/** Applies the persisted theme preference to <html data-theme>. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly store = inject(StoreService);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly prefersDark = signal(false);

  readonly preference = computed(() => this.store.settings().theme);
  readonly resolved = computed(() => Theme.resolve(this.preference(), this.prefersDark()));

  constructor() {
    if (!this.isBrowser) return;
    const mq = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)');
    if (mq) {
      this.prefersDark.set(mq.matches);
      mq.addEventListener('change', (e) => this.prefersDark.set(e.matches));
    }
    effect(() => {
      if (!this.store.ready()) return;
      const root = this.document.documentElement;
      root.dataset['theme'] = this.resolved();
      root.style.colorScheme = this.resolved();
    });
  }

  toggle(): void {
    this.store.setTheme(Theme.toggle(this.preference(), this.prefersDark()));
  }
}
