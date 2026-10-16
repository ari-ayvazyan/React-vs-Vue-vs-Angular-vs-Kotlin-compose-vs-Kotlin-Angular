import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: traps Tab focus, focuses the first field on open and restores focus on close.
 * Render it inside an `@if` so its lifetime equals "open".
 */
@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dialog-backdrop" (click)="closed.emit()" aria-hidden="true"></div>
    <div
      class="dialog"
      [class.dialog-wide]="wide()"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="labelId()"
      [attr.data-testid]="testId() || null"
      (keydown)="onKeydown($event)"
    >
      <ng-content />
    </div>
  `,
  host: { class: 'dialog-host' },
})
export class Dialog implements OnDestroy {
  readonly labelId = input.required<string>();
  readonly testId = input('');
  readonly wide = input(false);
  readonly closed = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly previouslyFocused: HTMLElement | null =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

  constructor() {
    afterNextRender(() => {
      const root = this.dialogEl();
      const preferred = root?.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      (preferred ?? this.focusables()[0] ?? root)?.focus();
    });
  }

  ngOnDestroy(): void {
    const el = this.previouslyFocused;
    if (el && typeof el.focus === 'function' && el.isConnected) setTimeout(() => el.focus());
  }

  protected onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.closed.emit();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = this.focusables();
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !this.dialogEl()?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  private dialogEl(): HTMLElement | null {
    return this.host.nativeElement.querySelector('.dialog');
  }

  private focusables(): HTMLElement[] {
    const root = this.dialogEl();
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
  }
}
