import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Status, WorkflowStatus, workflowFor, workflowUsage } from '../../core/kt';
import { StoreService } from '../../core/store.service';
import { UiService } from '../../core/ui.service';
import { Icon } from '../../shared/icon';

/**
 * Edits a project's workflow: rename, recolour, recategorise, reorder, add and delete statuses. All validation
 * (unique names, every category present) and task moves happen in Kotlin; editing an inherited workflow gives the
 * project its own copy.
 */
@Component({
  selector: 'app-workflow-editor',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workflow-editor.html',
})
export class WorkflowEditor {
  readonly projectId = input.required<string>();
  protected readonly store = inject(StoreService);
  private readonly ui = inject(UiService);
  protected readonly categories = Status.all;
  protected readonly categoryLabel = (c: string) => Status.label(c);

  protected readonly project = computed(() => this.store.projectMap().get(this.projectId()) ?? null);
  protected readonly statuses = computed(() => workflowFor(this.store.state(), this.projectId()));
  protected readonly inherited = computed(() => !this.project()?.workflow);
  protected readonly hasParent = computed(() => !!this.project()?.parentId);
  /** Tasks per status (this project + sub-projects sharing the workflow), counted in Kotlin. */
  protected readonly usage = computed(() => {
    const counts = workflowUsage(this.store.state(), this.projectId());
    return new Map(this.statuses().map((s, i) => [s.id, counts[i]]));
  });

  protected readonly error = signal('');
  protected readonly newName = signal('');
  protected readonly newCategory = signal<string>(Status.IN_PROGRESS);
  protected readonly newColor = signal('#a855f7');
  protected readonly deletingId = signal<string | null>(null);
  protected readonly moveTarget = signal('');

  protected rename(s: WorkflowStatus, input: HTMLInputElement): void {
    if (input.value.trim() === s.name) return;
    const err = this.store.updateStatus(this.projectId(), s.id, input.value, s.color, s.category);
    this.report(err);
    // A rejected rename leaves the state unchanged, so the bound value would not refresh: restore it.
    if (err) input.value = s.name;
  }

  protected recolor(s: WorkflowStatus, color: string): void {
    this.report(this.store.updateStatus(this.projectId(), s.id, s.name, color, s.category));
  }

  protected recategorize(s: WorkflowStatus, category: string): void {
    this.report(this.store.updateStatus(this.projectId(), s.id, s.name, s.color, category));
  }

  protected move(s: WorkflowStatus, delta: number): void {
    this.store.moveStatus(this.projectId(), s.id, delta);
  }

  protected add(e: Event): void {
    e.preventDefault();
    const err = this.store.addStatus(this.projectId(), this.newName(), this.newColor(), this.newCategory());
    this.report(err);
    if (!err) this.newName.set('');
  }

  protected askDelete(s: WorkflowStatus): void {
    this.error.set('');
    this.deletingId.set(s.id);
    const fallback = this.statuses().find((x) => x.id !== s.id && x.category === s.category) ?? this.statuses().find((x) => x.id !== s.id);
    this.moveTarget.set(fallback?.id ?? '');
  }

  protected confirmDelete(s: WorkflowStatus): void {
    const err = this.store.deleteStatus(this.projectId(), s.id, this.moveTarget());
    this.report(err);
    if (!err) {
      this.deletingId.set(null);
      this.ui.toast(`Deleted status “${s.name}”`, { actionLabel: 'Undo', action: () => this.store.undo() });
    }
  }

  protected reset(): void {
    this.store.resetWorkflow(this.projectId());
    this.error.set('');
  }

  private report(err: string): void {
    this.error.set(err);
  }
}
