import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { StoreService } from '../services/store.service';
import { STATUSES, STATUS_COLORS, STATUS_LABELS, Status, WorkflowStatus } from '../core/models';
import { STATUS_NAME_MAX, effectiveWorkflow } from '../core/workflows';
import { Icon } from './icon';

/**
 * Edits one project's workflow: statuses with name, colour and category; add, rename, recolour,
 * reorder and delete (asking where the tasks go). Inherited workflows are read-only until the
 * project customises them. Every change is one undoable store mutation.
 */
@Component({
  selector: 'app-workflow-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <p class="source muted" data-testid="workflow-source">
      @if (custom()) {
        This project has its own workflow.
        @if (childrenInheriting()) {
          Sub-projects without their own workflow use it too.
        }
      } @else if (source(); as src) {
        Inherited from <strong>{{ src }}</strong
        >.
      } @else {
        Uses the default workflow.
      }
    </p>

    <ol class="statuses" data-testid="workflow-statuses">
      @for (s of statuses(); track s.id; let i = $index; let last = $last) {
        <li class="status" data-testid="workflow-status">
          @if (custom()) {
            <label class="color" [title]="'Colour of ' + s.name">
              <span class="sr-only">Colour of {{ s.name }}</span>
              <input
                type="color"
                [value]="s.color"
                (change)="update(s, { color: value($event) }, $event)"
              />
              <span class="swatch-dot" [style.background]="s.color" aria-hidden="true"></span>
            </label>
            <label class="sr-only" [for]="uid + '-name-' + s.id">Name of status {{ i + 1 }}</label>
            <input
              [id]="uid + '-name-' + s.id"
              class="input input-sm name"
              [value]="s.name"
              [attr.maxlength]="nameMax"
              data-testid="workflow-status-name"
              (keydown.enter)="$any($event.target).blur()"
              (change)="update(s, { name: value($event) }, $event)"
            />
            <label class="sr-only" [for]="uid + '-cat-' + s.id">Category of {{ s.name }}</label>
            <select
              [id]="uid + '-cat-' + s.id"
              class="input input-sm cat"
              data-testid="workflow-status-category"
              (change)="update(s, { category: $any(value($event)) }, $event)"
            >
              @for (c of categories; track c) {
                <option [value]="c" [selected]="s.category === c">{{ categoryLabels[c] }}</option>
              }
            </select>
            <span class="count muted" [title]="count(s) + ' tasks'">{{ count(s) }}</span>
            <div class="row-actions">
              <button
                type="button"
                class="icon-btn sm"
                [disabled]="i === 0"
                [attr.aria-label]="'Move ' + s.name + ' up'"
                (click)="store.moveStatus(projectId(), s.id, -1)"
              >
                <app-icon name="chevronLeft" [size]="14" class="up" />
              </button>
              <button
                type="button"
                class="icon-btn sm"
                [disabled]="last"
                [attr.aria-label]="'Move ' + s.name + ' down'"
                (click)="store.moveStatus(projectId(), s.id, 1)"
              >
                <app-icon name="chevronRight" [size]="14" class="down" />
              </button>
              <button
                type="button"
                class="icon-btn sm danger"
                [attr.aria-label]="'Delete status ' + s.name"
                data-testid="workflow-status-delete"
                (click)="askDelete(s)"
              >
                <app-icon name="trash" [size]="14" />
              </button>
            </div>
          } @else {
            <span class="swatch-dot" [style.background]="s.color" aria-hidden="true"></span>
            <span class="name-ro">{{ s.name }}</span>
            <span class="badge" [class]="'badge badge-' + s.category">{{
              categoryLabels[s.category]
            }}</span>
            <span class="count muted">{{ count(s) }}</span>
          }
        </li>
        @if (deleting()?.id === s.id) {
          <li class="delete-row" data-testid="workflow-delete-confirm">
            <label [for]="uid + '-move-to'">
              Move its {{ count(s) }} task{{ count(s) === 1 ? '' : 's' }} to
            </label>
            <select
              [id]="uid + '-move-to'"
              class="input input-sm"
              data-testid="workflow-move-to"
              (change)="moveTo.set(value($event))"
            >
              @for (o of others(s); track o.id) {
                <option [value]="o.id" [selected]="moveTo() === o.id">
                  {{ o.name }} ({{ categoryLabels[o.category] }})
                </option>
              }
            </select>
            <button type="button" class="btn btn-sm btn-ghost" (click)="deleting.set(null)">
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-sm btn-danger"
              data-testid="workflow-delete-confirm-button"
              (click)="confirmDelete(s)"
            >
              Delete status
            </button>
          </li>
        }
      }
    </ol>

    @if (error()) {
      <p class="error" role="alert" data-testid="workflow-error">{{ error() }}</p>
    }

    @if (custom()) {
      <form class="add" (submit)="add($event)" novalidate>
        <label class="sr-only" [for]="uid + '-new'">New status name</label>
        <input
          [id]="uid + '-new'"
          class="input input-sm"
          placeholder="New status, e.g. Review"
          data-testid="workflow-new-name"
          [attr.maxlength]="nameMax"
          [value]="newName()"
          (input)="newName.set(value($event)); error.set('')"
        />
        <label class="sr-only" [for]="uid + '-new-cat'">Category</label>
        <select
          [id]="uid + '-new-cat'"
          class="input input-sm"
          data-testid="workflow-new-category"
          (change)="newCategory.set($any(value($event)))"
        >
          @for (c of categories; track c) {
            <option [value]="c" [selected]="newCategory() === c">{{ categoryLabels[c] }}</option>
          }
        </select>
        <button type="submit" class="btn btn-sm" data-testid="workflow-add">
          <app-icon name="plus" [size]="14" /> Add status
        </button>
      </form>
      <div class="foot">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          data-testid="workflow-reset"
          (click)="store.resetWorkflow(projectId())"
        >
          {{ parentLabel() ? 'Use the parent’s workflow again' : 'Reset to the default workflow' }}
        </button>
        <span class="muted hint">Tasks keep their category when statuses change.</span>
      </div>
    } @else {
      <button
        type="button"
        class="btn btn-sm btn-primary"
        data-testid="workflow-customize"
        (click)="store.customizeWorkflow(projectId())"
      >
        <app-icon name="edit" [size]="14" /> Customize for this project
      </button>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .source {
      margin: 0 0 12px;
      font-size: 0.86rem;
    }
    .statuses {
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }
    .status,
    .delete-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .status:first-child {
      border-top: 0;
    }
    .delete-row {
      background: var(--danger-soft);
      font-size: 0.85rem;
    }
    .delete-row select {
      width: auto;
    }
    .color {
      position: relative;
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      cursor: pointer;
    }
    .color input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .color:focus-within .swatch-dot {
      box-shadow: 0 0 0 3px var(--ring);
    }
    .swatch-dot {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .name {
      flex: 1 1 140px;
      min-width: 0;
    }
    .name-ro {
      flex: 1;
      font-weight: 550;
    }
    .cat {
      width: auto;
    }
    .count {
      min-width: 28px;
      text-align: right;
      font-size: 0.8rem;
      font-variant-numeric: tabular-nums;
    }
    .row-actions {
      display: flex;
      gap: 2px;
    }
    .up {
      transform: rotate(90deg);
    }
    .down {
      transform: rotate(90deg);
    }
    .add {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .add input {
      flex: 1 1 160px;
    }
    .add select {
      width: auto;
    }
    .foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
    }
    .hint {
      font-size: 0.8rem;
    }
    .error {
      margin: 0 0 12px;
    }
  `,
})
export class WorkflowEditor {
  protected readonly store = inject(StoreService);
  readonly projectId = input.required<string>();

  private static seq = 0;
  protected readonly uid = `wf${++WorkflowEditor.seq}`;
  protected readonly categories = STATUSES;
  protected readonly categoryLabels = STATUS_LABELS;
  protected readonly nameMax = STATUS_NAME_MAX;

  protected readonly newName = signal('');
  protected readonly newCategory = signal<Status>('in_progress');
  protected readonly error = signal('');
  protected readonly deleting = signal<WorkflowStatus | null>(null);
  protected readonly moveTo = signal('');

  private readonly project = computed(() => this.store.projectMap().get(this.projectId()));
  protected readonly custom = computed(() => !!this.project()?.workflow);
  protected readonly statuses = computed(() => this.store.workflowOf()(this.projectId()));
  /** Name of the project the workflow is inherited from, or null for the default workflow. */
  protected readonly source = computed(() => {
    const src = effectiveWorkflow(this.projectId(), this.store.projectMap()).sourceId;
    return src && src !== this.projectId()
      ? (this.store.projectMap().get(src)?.name ?? null)
      : null;
  });
  protected readonly parentLabel = computed(() => {
    const pid = this.project()?.parentId;
    return pid ? (this.store.projectMap().get(pid)?.name ?? null) : null;
  });
  protected readonly childrenInheriting = computed(() =>
    this.store.projects().some((p) => p.parentId === this.projectId() && !p.workflow),
  );

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected count(s: WorkflowStatus): number {
    return this.store.tasksInStatus(this.projectId(), s.id);
  }

  protected others(s: WorkflowStatus): WorkflowStatus[] {
    return this.statuses().filter((x) => x.id !== s.id);
  }

  protected update(s: WorkflowStatus, patch: Partial<Omit<WorkflowStatus, 'id'>>, e: Event): void {
    if (patch.name !== undefined && patch.name.trim() === s.name) return;
    const err = this.store.updateStatus(this.projectId(), s.id, patch);
    this.error.set(err);
    if (err) {
      // the state did not change, so put the control back to the stored value
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      el.value =
        patch.category !== undefined ? s.category : patch.name !== undefined ? s.name : s.color;
    }
  }

  protected add(e: Event): void {
    e.preventDefault();
    const name = this.newName().trim();
    if (!name) {
      this.error.set('Enter a name for the new status.');
      return;
    }
    const used = new Set(this.statuses().map((s) => s.color));
    const color = STATUS_COLORS.find((c) => !used.has(c)) ?? STATUS_COLORS[0];
    const err = this.store.addStatus(this.projectId(), {
      name,
      color,
      category: this.newCategory(),
    });
    this.error.set(err);
    if (!err) this.newName.set('');
  }

  protected askDelete(s: WorkflowStatus): void {
    this.error.set('');
    // prefer a status of the same category as the destination
    const others = this.others(s);
    const same = others.find((o) => o.category === s.category) ?? others[0];
    this.moveTo.set(same?.id ?? '');
    this.deleting.set(s);
  }

  protected confirmDelete(s: WorkflowStatus): void {
    const err = this.store.deleteStatus(this.projectId(), s.id, this.moveTo());
    this.error.set(err);
    if (!err) this.deleting.set(null);
  }
}
