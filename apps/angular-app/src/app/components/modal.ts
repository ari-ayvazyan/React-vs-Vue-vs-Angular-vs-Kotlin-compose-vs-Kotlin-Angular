import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Icon } from './icon';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Stack so only the top-most modal reacts to Esc. */
const stack: Modal[] = [];

@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '(document:keydown)': 'onKeydown($event)' },
  template: `
    <div class="modal-backdrop" (click)="closed.emit()" aria-hidden="true"></div>
    <div
      #panel
      class="modal-panel"
      [class.wide]="wide()"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      [attr.data-testid]="testId() || null"
    >
      <header class="modal-header">
        <h2 [id]="titleId">{{ heading() }}</h2>
        <button type="button" class="icon-btn" (click)="closed.emit()" aria-label="Close dialog">
          <app-icon name="close" />
        </button>
      </header>
      <div class="modal-body"><ng-content /></div>
    </div>
  `,
  styleUrl: './modal.css',
})
export class Modal implements OnDestroy {
  readonly heading = input.required<string>();
  readonly testId = input<string>('');
  readonly wide = input(false);
  readonly closed = output<void>();

  private static seq = 0;
  protected readonly titleId = `modal-title-${++Modal.seq}`;
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly previouslyFocused: HTMLElement | null = null;

  constructor() {
    if (this.isBrowser) {
      this.previouslyFocused = this.doc.activeElement as HTMLElement | null;
      stack.push(this);
      this.doc.body.classList.add('modal-open');
    }
    afterNextRender(() => {
      const el = this.panel().nativeElement;
      const target =
        el.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ??
        this.focusables()[1] ??
        el;
      target.focus();
    });
  }

  private focusables(): HTMLElement[] {
    return Array.from(this.panel().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (e) => !e.hasAttribute('disabled') && e.offsetParent !== null,
    );
  }

  protected onKeydown(e: KeyboardEvent): void {
    if (stack[stack.length - 1] !== this) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.closed.emit();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = this.focusables();
    if (!items.length) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    const active = this.doc.activeElement;
    const inside = this.panel().nativeElement.contains(active);
    if (e.shiftKey && (active === firstEl || !inside)) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && (active === lastEl || !inside)) {
      e.preventDefault();
      firstEl.focus();
    }
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;
    const i = stack.indexOf(this);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length) this.doc.body.classList.remove('modal-open');
    const prev = this.previouslyFocused;
    if (prev && this.doc.contains(prev)) setTimeout(() => prev.focus());
  }
}
