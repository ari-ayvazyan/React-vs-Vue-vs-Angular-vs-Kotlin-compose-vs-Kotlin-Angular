import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  Limits,
  PROJECT_PALETTE,
  Project,
  projectProgress,
  projectTree,
  unassignedTaskCount,
  validateParent,
  validateProject,
} from '../../core/kt';
import { StoreService } from '../../core/store.service';
import { UiService } from '../../core/ui.service';
import { Autofocus } from '../../shared/autofocus';
import { Dialog } from '../../shared/dialog';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';
import { WorkflowEditor } from './workflow-editor';

/** Project tree with CRUD, sub-projects and per-project workflows (rules and tree layout live in Kotlin). */
@Component({
  selector: 'app-projects',
  imports: [RouterLink, Icon, Dialog, Skeleton, Autofocus, WorkflowEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects.html',
})
export class ProjectsPage {
  protected readonly store = inject(StoreService);
  private readonly ui = inject(UiService);
  protected readonly palette = PROJECT_PALETTE;
  protected readonly maxName = Limits.PROJECT_NAME_MAX;

  protected readonly rows = computed(() => {
    const state = this.store.state();
    return projectTree(state).map((node) => ({ node, progress: projectProgress(state, node.project.id)! }));
  });
  protected readonly unassigned = computed(() => unassignedTaskCount(this.store.state()));

  // create
  protected readonly newName = signal('');
  protected readonly newColor = signal(PROJECT_PALETTE[0]);
  protected readonly newParent = signal('');
  protected readonly createError = signal('');

  // edit
  protected readonly editingId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly editColor = signal('');
  protected readonly editParent = signal('');
  protected readonly editError = signal('');

  // workflow editor
  protected readonly workflowOpen = signal<string | null>(null);

  // delete
  protected readonly deleting = signal<Project | null>(null);
  protected readonly deleteMode = signal<'move' | 'delete'>('move');
  protected readonly subMode = signal<'up' | 'delete'>('up');
  protected readonly deletingChildren = computed(() => {
    const p = this.deleting();
    return p ? (this.rows().find((r) => r.node.project.id === p.id)?.node.childCount ?? 0) : 0;
  });
  protected readonly deletingCount = computed(() => {
    const p = this.deleting();
    if (!p) return 0;
    // Tasks of the project itself plus, when sub-projects are deleted too, of all descendants.
    return this.subMode() === 'delete'
      ? (projectProgress(this.store.state(), p.id)?.total ?? 0)
      : this.store.tasks().filter((t) => t.projectId === p.id).length;
  });

  protected create(e: Event): void {
    e.preventDefault();
    const err = validateProject(this.newName(), this.newColor()) || validateParent(this.store.state(), null, this.newParent());
    this.createError.set(err);
    if (err) return;
    this.store.createProject(this.newName(), this.newColor(), this.newParent());
    this.ui.toast(`Project “${this.newName().trim()}” created`, { tone: 'success' });
    this.newName.set('');
    this.newColor.set(PROJECT_PALETTE[this.store.projects().length % PROJECT_PALETTE.length]);
  }

  protected startEdit(p: Project): void {
    this.editingId.set(p.id);
    this.editName.set(p.name);
    this.editColor.set(p.color);
    this.editParent.set(p.parentId ?? '');
    this.editError.set('');
  }

  protected saveEdit(e: Event): void {
    e.preventDefault();
    const id = this.editingId();
    if (!id) return;
    const err = validateProject(this.editName(), this.editColor()) || validateParent(this.store.state(), id, this.editParent());
    this.editError.set(err);
    if (err) return;
    this.store.updateProject(id, this.editName(), this.editColor());
    const parentErr = this.store.setProjectParent(id, this.editParent());
    if (parentErr) {
      this.editError.set(parentErr);
      return;
    }
    this.editingId.set(null);
  }

  protected askDelete(p: Project): void {
    this.deleteMode.set('move');
    this.subMode.set('up');
    this.deleting.set(p);
  }

  protected confirmDelete(): void {
    const p = this.deleting();
    if (!p) return;
    this.store.deleteProject(p.id, this.deleteMode() === 'delete', this.subMode() === 'delete');
    this.deleting.set(null);
    this.ui.toast(`Deleted project “${p.name}”`, { actionLabel: 'Undo', action: () => this.store.undo() });
  }

  protected toggleWorkflow(id: string): void {
    this.workflowOpen.set(this.workflowOpen() === id ? null : id);
  }
}
