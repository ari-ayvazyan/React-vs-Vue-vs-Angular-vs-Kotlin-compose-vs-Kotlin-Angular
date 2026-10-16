import { DOCUMENT, Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { ShortcutAction, ShortcutInterpreter } from './kt';
import { StoreService } from './store.service';
import { UiService } from './ui.service';

/** Global keyboard shortcuts; key-sequence interpretation happens in Kotlin. */
@Injectable({ providedIn: 'root' })
export class ShortcutsService {
  private readonly store = inject(StoreService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly interpreter = new ShortcutInterpreter();

  install(): void {
    if (!this.isBrowser) return;
    this.document.addEventListener('keydown', (e) => this.onKeydown(e));
  }

  undo(): void {
    const label = this.store.undo();
    if (label) this.ui.toast(`Undid: ${label}`);
  }

  redo(): void {
    const label = this.store.redo();
    if (label) this.ui.toast(`Redid: ${label}`);
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.isComposing) return;
    const action = this.interpreter.handle(
      e.key,
      e.ctrlKey || e.metaKey,
      e.shiftKey,
      e.altKey,
      isTyping(e.target),
      Date.now(),
    );
    if (action === ShortcutAction.NONE || action === ShortcutAction.PENDING) return;
    if (action === ShortcutAction.ESCAPE) {
      if (this.ui.closeTopmost()) e.preventDefault();
      return;
    }
    // While a dialog is open only Escape is handled globally.
    if (this.ui.taskModal() || this.ui.helpOpen()) return;
    e.preventDefault();
    if (action === ShortcutAction.NEW_TASK) this.ui.openTaskModal();
    else if (action === ShortcutAction.FOCUS_SEARCH) this.ui.focusSearch();
    else if (action === ShortcutAction.HELP) this.ui.helpOpen.set(true);
    else if (action === ShortcutAction.UNDO) this.undo();
    else if (action === ShortcutAction.REDO) this.redo();
    else if (action.startsWith(ShortcutAction.NAV_PREFIX)) {
      void this.router.navigateByUrl(action.slice(ShortcutAction.NAV_PREFIX.length));
    }
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type);
  }
  return target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
}
