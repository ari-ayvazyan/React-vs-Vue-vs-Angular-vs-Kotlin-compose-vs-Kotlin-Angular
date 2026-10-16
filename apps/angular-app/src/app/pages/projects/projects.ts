import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StoreService, SubProjectMode } from '../../services/store.service';
import { ToastService } from '../../services/toast.service';
import { PROJECT_COLORS, Project } from '../../core/models';
import { projectProgress } from '../../core/stats';
import { childrenMap, projectPath, treeOrder } from '../../core/project-tree';
import { effectiveWorkflow } from '../../core/workflows';
import { Icon } from '../../components/icon';
import { Modal } from '../../components/modal';
import { WorkflowEditor } from '../../components/workflow-editor';

interface Row {
  project: Project;
  depth: number;
  hasChildren: boolean;
  total: number;
  done: number;
  percent: number;
  /** Own (direct) task count, when it differs from the rolled-up total. */
  own: number;
  workflowLabel: string;
}

@Component({
  selector: 'app-projects',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, Modal, WorkflowEditor],
  templateUrl: './projects.html',
  styleUrl: './projects.css',
})
export class ProjectsPage {
  protected readonly store = inject(StoreService);
  private readonly toast = inject(ToastService);

  protected readonly palette = PROJECT_COLORS;
  protected readonly newName = signal('');
  protected readonly newColor = signal(PROJECT_COLORS[0]);
  protected readonly newParent = signal('');
  protected readonly createError = signal('');

  protected readonly editingId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly editError = signal('');
  protected readonly colorFor = signal<string | null>(null);
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());

  protected readonly deleting = signal<Project | null>(null);
  protected readonly deleteMode = signal<'unassign' | 'delete'>('unassign');
  protected readonly childMode = signal<SubProjectMode>('lift');

  protected readonly workflowFor = signal<Project | null>(null);
  protected readonly moving = signal<Project | null>(null);
  protected readonly moveParent = signal('');
  protected readonly moveError = signal('');

  /** Tree rows (collapsed branches hidden); counts include all descendants. */
  protected readonly rows = computed<Row[]>(() => {
    const projects = this.store.projects();
    const tasks = this.store.tasks();
    const progress = new Map(
      projectProgress(tasks, projects, this.store.projectSubtree()).map((p) => [p.project.id, p]),
    );
    const own = new Map<string, number>();
    for (const t of tasks) if (t.projectId) own.set(t.projectId, (own.get(t.projectId) ?? 0) + 1);
    const children = childrenMap(projects);
    const map = this.store.projectMap();
    const collapsed = this.collapsed();
    const rows: Row[] = [];
    let hideBelow = Infinity;
    for (const { project, depth } of treeOrder(projects)) {
      if (depth > hideBelow) continue;
      hideBelow = collapsed.has(project.id) ? depth : Infinity;
      const p = progress.get(project.id)!;
      const src = effectiveWorkflow(project.id, map).sourceId;
      rows.push({
        project,
        depth,
        hasChildren: (children.get(project.id) ?? []).length > 0,
        total: p.total,
        done: p.done,
        percent: p.percent,
        own: own.get(project.id) ?? 0,
        workflowLabel:
          src === project.id
            ? `Custom workflow · ${project.workflow!.length} statuses`
            : src
              ? `Workflow of ${map.get(src)?.name ?? 'parent'}`
              : 'Default workflow',
      });
    }
    return rows;
  });
  protected readonly unassigned = computed(() => {
    const list = this.store.tasks().filter((t) => t.projectId === null);
    return { total: list.length, done: list.filter((t) => t.status === 'done').length };
  });
  protected readonly deletingInfo = computed(() => {
    const p = this.deleting();
    if (!p) return { own: 0, children: 0, descendants: 0, subtreeTasks: 0 };
    const subtree = this.store.projectSubtree().get(p.id) ?? new Set([p.id]);
    const tasks = this.store.tasks();
    return {
      own: tasks.filter((t) => t.projectId === p.id).length,
      children: this.store.projects().filter((x) => x.parentId === p.id).length,
      descendants: subtree.size - 1,
      subtreeTasks: tasks.filter((t) => t.projectId !== null && subtree.has(t.projectId)).length,
    };
  });
  /** Parent choices for the "Move" dialog: not the project itself or its descendants. */
  protected readonly moveOptions = computed(() => {
    const p = this.moving();
    if (!p) return [];
    const exclude = this.store.projectSubtree().get(p.id) ?? new Set([p.id]);
    return this.store.projectOptions().filter((o) => !exclude.has(o.id));
  });

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected path(id: string | null): string {
    return id ? projectPath(this.store.projects(), id) : '';
  }

  private validateName(name: string, exceptId: string | null, parentId: string | null): string {
    const n = name.trim();
    if (!n) return 'Project name is required.';
    if (n.length > 60) return 'Project name must be at most 60 characters.';
    // names are unique among siblings (the same name may exist under another parent)
    if (
      this.store
        .projects()
        .some(
          (p) =>
            p.id !== exceptId &&
            (p.parentId ?? null) === parentId &&
            p.name.toLowerCase() === n.toLowerCase(),
        )
    )
      return parentId
        ? 'A sub-project with this name already exists here.'
        : 'A project with this name already exists.';
    return '';
  }

  protected create(e: Event): void {
    e.preventDefault();
    const parentId = this.newParent() || null;
    const err = this.validateName(this.newName(), null, parentId);
    this.createError.set(err);
    if (err) return;
    const p = this.store.createProject(this.newName(), this.newColor(), parentId);
    this.toast.show(
      parentId
        ? `Sub-project “${p.name}” created in ${this.path(parentId)}`
        : `Project “${p.name}” created`,
      { kind: 'success' },
    );
    this.newName.set('');
    if (parentId) this.expand(parentId);
    const idx = (PROJECT_COLORS.indexOf(this.newColor()) + 1) % PROJECT_COLORS.length;
    this.newColor.set(PROJECT_COLORS[idx]);
  }

  protected toggle(id: string): void {
    const s = new Set(this.collapsed());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.collapsed.set(s);
  }

  private expand(id: string): void {
    if (!this.collapsed().has(id)) return;
    const s = new Set(this.collapsed());
    s.delete(id);
    this.collapsed.set(s);
  }

  protected startRename(p: Project): void {
    this.editingId.set(p.id);
    this.editName.set(p.name);
    this.editError.set('');
    setTimeout(() => document.getElementById(`rename-${p.id}`)?.focus());
  }

  protected saveRename(p: Project): void {
    if (this.editingId() !== p.id) return;
    const err = this.validateName(this.editName(), p.id, p.parentId);
    this.editError.set(err);
    if (err) return;
    if (this.editName().trim() !== p.name)
      this.store.updateProject(p.id, { name: this.editName().trim() });
    this.editingId.set(null);
  }

  protected cancelRename(): void {
    this.editingId.set(null);
    this.editError.set('');
  }

  protected recolor(p: Project, color: string): void {
    if (/^#[0-9a-fA-F]{6}$/.test(color) && color !== p.color)
      this.store.updateProject(p.id, { color });
  }

  protected askMove(p: Project): void {
    this.moving.set(p);
    this.moveParent.set(p.parentId ?? '');
    this.moveError.set('');
  }

  protected confirmMove(): void {
    const p = this.moving();
    if (!p) return;
    const parentId = this.moveParent() || null;
    if (parentId === p.parentId) {
      this.moving.set(null);
      return;
    }
    const clash = this.validateName(p.name, p.id, parentId);
    const err = clash || this.store.setProjectParent(p.id, parentId);
    this.moveError.set(err);
    if (err) return;
    this.moving.set(null);
    if (parentId) this.expand(parentId);
    this.toast.show(
      parentId
        ? `“${p.name}” moved into ${this.path(parentId)}`
        : `“${p.name}” is now a top-level project`,
      { actionLabel: 'Undo', action: () => this.store.undo() },
    );
  }

  protected askDelete(p: Project): void {
    this.deleteMode.set('unassign');
    this.childMode.set('lift');
    this.deleting.set(p);
  }

  protected confirmDelete(): void {
    const p = this.deleting();
    if (!p) return;
    this.store.deleteProject(p.id, this.deleteMode(), this.childMode());
    this.deleting.set(null);
    this.toast.show(`Project “${p.name}” deleted`, {
      actionLabel: 'Undo',
      action: () => this.store.undo(),
    });
  }
}
