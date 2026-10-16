import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StoreService } from '../services/store.service';
import { STATUS_LABELS, Task } from '../core/models';
import { blockedByTask } from '../core/dependencies';
import { matchesSearch } from '../core/filters';
import { Icon } from './icon';

const MAX_OPTIONS = 8;

/** "Blocked by" list + searchable combobox to add blockers, and the read-only "Blocking" list. */
@Component({
  selector: 'app-dependency-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <h3 class="sub-title">Blocked by</h3>
    <ul class="deps" data-testid="blocker-list">
      @for (b of blockers(); track b.id) {
        <li [class.done]="b.status === 'done'" data-testid="blocker-item">
          <span class="badge" [class]="'badge badge-' + b.status">{{
            statusLabels[b.status]
          }}</span>
          <a [routerLink]="['/tasks', b.id]" class="dep-title">{{ b.title }}</a>
          <button
            type="button"
            class="icon-btn sm"
            [attr.aria-label]="'Remove blocker ' + b.title"
            (click)="store.removeBlocker(task().id, b.id)"
          >
            <app-icon name="close" [size]="14" />
          </button>
        </li>
      } @empty {
        <li class="muted empty-deps">Nothing blocks this task.</li>
      }
    </ul>

    <div class="picker">
      <label class="sr-only" [for]="inputId">Add a blocking task</label>
      <div class="search-input">
        <app-icon name="search" [size]="15" />
        <input
          [id]="inputId"
          type="text"
          role="combobox"
          autocomplete="off"
          placeholder="Add blocker: search tasks…"
          data-testid="blocker-search"
          aria-autocomplete="list"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="listId"
          [attr.aria-activedescendant]="open() && options().length ? optionId(active()) : null"
          [attr.aria-invalid]="!!error()"
          [attr.aria-describedby]="error() ? errorId : null"
          [value]="query()"
          (input)="onInput($event)"
          (focus)="open.set(true)"
          (blur)="open.set(false)"
          (keydown)="onKey($event)"
        />
      </div>
      @if (open() && query().trim()) {
        <ul class="options" role="listbox" [id]="listId" aria-label="Matching tasks">
          @for (o of options(); track o.id; let i = $index) {
            <li
              role="option"
              [id]="optionId(i)"
              [attr.aria-selected]="i === active()"
              [class.active]="i === active()"
              data-testid="blocker-option"
              (mousedown)="$event.preventDefault()"
              tabindex="-1"
              (click)="choose(o)"
              (keydown.enter)="choose(o)"
              (mouseenter)="active.set(i)"
            >
              <span class="badge" [class]="'badge badge-' + o.status">{{
                statusLabels[o.status]
              }}</span>
              <span class="opt-title">{{ o.title }}</span>
            </li>
          } @empty {
            <li class="muted no-match" role="presentation">No matching tasks</li>
          }
        </ul>
      }
      @if (error()) {
        <p class="error" [id]="errorId" role="alert" data-testid="blocker-error">{{ error() }}</p>
      }
    </div>

    @if (blocking().length) {
      <h3 class="sub-title">Blocking</h3>
      <ul class="deps" data-testid="blocking-list">
        @for (b of blocking(); track b.id) {
          <li [class.done]="b.status === 'done'">
            <span class="badge" [class]="'badge badge-' + b.status">{{
              statusLabels[b.status]
            }}</span>
            <a [routerLink]="['/tasks', b.id]" class="dep-title">{{ b.title }}</a>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .sub-title {
      margin: 0 0 8px;
      font-size: 0.78rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }
    .sub-title:not(:first-child) {
      margin-top: 18px;
    }
    .deps {
      list-style: none;
      margin: 0 0 10px;
      padding: 0;
    }
    .deps li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.9rem;
      min-width: 0;
    }
    .deps li:last-child {
      border-bottom: 0;
    }
    .dep-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text);
      text-decoration: none;
    }
    .dep-title:hover {
      color: var(--primary);
      text-decoration: underline;
    }
    li.done .dep-title {
      color: var(--text-muted);
      text-decoration: line-through;
    }
    .empty-deps {
      font-size: 0.86rem;
    }
    .picker {
      position: relative;
    }
    .search-input {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 38px;
      padding: 0 10px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--text-muted);
    }
    .search-input:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--ring);
    }
    .search-input input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 0.9rem;
    }
    .options {
      position: absolute;
      z-index: 30;
      left: 0;
      right: 0;
      top: 42px;
      margin: 0;
      padding: 4px;
      list-style: none;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-lg);
      max-height: 300px;
      overflow-y: auto;
    }
    .options li[role='option'] {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.88rem;
    }
    .options li.active {
      background: var(--primary-soft);
    }
    .opt-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .no-match {
      padding: 8px;
      font-size: 0.86rem;
    }
    .error {
      margin: 6px 0 0;
    }
  `,
})
export class DependencyPicker {
  protected readonly store = inject(StoreService);
  readonly task = input.required<Task>();

  private static seq = 0;
  private readonly uid = `dp${++DependencyPicker.seq}`;
  protected readonly inputId = `${this.uid}-input`;
  protected readonly listId = `${this.uid}-list`;
  protected readonly errorId = `${this.uid}-err`;
  protected readonly statusLabels = STATUS_LABELS;

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly error = signal('');

  protected readonly blockers = computed(() => {
    const map = this.store.taskMap();
    return this.task()
      .blockedBy.map((id) => map.get(id))
      .filter((t): t is Task => !!t);
  });
  protected readonly blocking = computed(() => blockedByTask(this.task().id, this.store.tasks()));

  /** Open tasks first, then by title; excludes the task itself and existing blockers. */
  protected readonly options = computed(() => {
    const q = this.query().trim();
    if (!q) return [];
    const t = this.task();
    const exclude = new Set([t.id, ...t.blockedBy]);
    return this.store
      .tasks()
      .filter((x) => !exclude.has(x.id) && matchesSearch(x, q))
      .sort(
        (a, b) =>
          Number(a.status === 'done') - Number(b.status === 'done') ||
          a.title.localeCompare(b.title, undefined, { numeric: true }),
      )
      .slice(0, MAX_OPTIONS);
  });

  protected optionId(i: number): string {
    return `${this.uid}-opt-${i}`;
  }

  protected onInput(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
    this.active.set(0);
    this.open.set(true);
    this.error.set('');
  }

  protected onKey(e: KeyboardEvent): void {
    const n = this.options().length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.open.set(true);
        if (n) this.active.set((this.active() + 1) % n);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (n) this.active.set((this.active() - 1 + n) % n);
        break;
      case 'Enter': {
        e.preventDefault();
        const o = this.options()[this.active()];
        if (o && this.open()) this.choose(o);
        break;
      }
      case 'Escape':
        if (this.open() && this.query()) {
          e.stopPropagation();
          this.open.set(false);
        }
        break;
    }
  }

  protected choose(o: Task): void {
    const res = this.store.addBlocker(this.task().id, o.id);
    if (res.ok) {
      this.query.set('');
      this.error.set('');
      this.active.set(0);
    } else {
      this.error.set(res.error);
      this.open.set(false);
    }
  }
}
