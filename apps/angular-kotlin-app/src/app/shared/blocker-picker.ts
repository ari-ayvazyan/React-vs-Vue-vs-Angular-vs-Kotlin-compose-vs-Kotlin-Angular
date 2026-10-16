import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { blockerCandidates } from '../core/kt';
import { StoreService } from '../core/store.service';

let nextId = 0;

/**
 * Searchable combobox for adding a blocker; candidates (cycle-free) and validation come from Kotlin.
 * Keyboard users drive the options from the input (arrow keys + Enter, `aria-activedescendant`), so options
 * only need a pointer handler; mousedown keeps focus in the input.
 */
@Component({
  selector: 'app-blocker-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="picker" (focusout)="onFocusOut($event)">
      <label class="sr-only" [for]="id + '-input'">Add a blocking task</label>
      <input
        [id]="id + '-input'"
        data-testid="blocker-search"
        role="combobox"
        autocomplete="off"
        placeholder="Add blocker: search tasks…"
        aria-autocomplete="list"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="id + '-list'"
        [attr.aria-activedescendant]="open() && candidates().length ? id + '-opt-' + active() : null"
        [attr.aria-describedby]="error() ? id + '-err' : null"
        [value]="search()"
        (input)="onInput($any($event.target).value)"
        (focus)="open.set(true)"
        (keydown)="onKeydown($event)"
      />
      @if (open()) {
        <ul class="picker-list" role="listbox" [id]="id + '-list'" aria-label="Tasks that can block this one">
          @for (t of candidates(); track t.id; let i = $index) {
            <li
              role="option"
              [id]="id + '-opt-' + i"
              class="picker-option"
              data-testid="blocker-option"
              [class.active]="i === active()"
              [attr.aria-selected]="i === active()"
              (mousedown)="$event.preventDefault(); choose(t.id)"
            >
              <span class="status-dot" [style.--status-color]="store.statusOf(t).color" aria-hidden="true"></span>
              <span class="picker-title">{{ t.title }}</span>
              <span class="muted small">{{ store.statusOf(t).name }}</span>
            </li>
          } @empty {
            <li class="picker-empty muted small" role="presentation">No matching tasks (tasks that would create a cycle are hidden).</li>
          }
        </ul>
      }
      @if (error()) {
        <p class="field-error" [id]="id + '-err'" role="alert" data-testid="blocker-error">{{ error() }}</p>
      }
    </div>
  `,
})
export class BlockerPicker {
  readonly taskId = input.required<string>();
  protected readonly store = inject(StoreService);
  protected readonly id = `bp${nextId++}`;
  protected readonly search = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly error = signal('');
  protected readonly candidates = computed(() => blockerCandidates(this.store.state(), this.taskId(), this.search(), 8));

  protected onInput(value: string): void {
    this.search.set(value);
    this.active.set(0);
    this.open.set(true);
    this.error.set('');
  }

  protected onKeydown(e: KeyboardEvent): void {
    const n = this.candidates().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.open.set(true);
      if (n) this.active.set((this.active() + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const t = this.candidates()[this.active()];
      if (t) this.choose(t.id);
    } else if (e.key === 'Escape' && this.open()) {
      e.stopPropagation();
      this.open.set(false);
    }
  }

  protected onFocusOut(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (!next || !(e.currentTarget as HTMLElement).contains(next)) this.open.set(false);
  }

  /** Public so the detail page can re-use it; returns the error message ("" on success). */
  choose(blockerId: string): string {
    const err = this.store.addBlocker(this.taskId(), blockerId);
    this.error.set(err);
    if (!err) {
      this.search.set('');
      this.active.set(0);
    }
    return err;
  }
}
