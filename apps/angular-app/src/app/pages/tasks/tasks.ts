import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { StoreService } from '../../services/store.service';
import { UiService } from '../../services/ui.service';
import { ToastService } from '../../services/toast.service';
import {
  DEFAULT_QUERY,
  DueFilter,
  SortField,
  TaskQuery,
  filterTasks,
  isOverdue,
  paginate,
  parseQuery,
  serializeQuery,
  sortTasks,
} from '../../core/filters';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  Priority,
  RECURRENCE_LABELS,
  STATUSES,
  STATUS_LABELS,
  SavedView,
  Status,
  Task,
} from '../../core/models';
import { relativeDue, toDateKey } from '../../core/dates';
import { tasksToCsv } from '../../core/csv';
import { projectPath } from '../../core/project-tree';
import { downloadFile } from '../../utils/download';
import { openBlockers } from '../../core/dependencies';
import { Icon } from '../../components/icon';
import { Avatar } from '../../components/avatar';
import { Modal } from '../../components/modal';
import { boardParams, findView, validateViewName, viewParams } from '../../core/views';

@Component({
  selector: 'app-tasks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, Avatar, Modal],
  templateUrl: './tasks.html',
  styleUrl: './tasks.css',
})
export class TasksPage implements OnDestroy {
  protected readonly store = inject(StoreService);
  protected readonly ui = inject(UiService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly statuses = STATUSES;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly priorities = PRIORITIES;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly recurrenceLabels = RECURRENCE_LABELS;
  protected readonly dueOptions: { value: DueFilter; label: string }[] = [
    { value: 'all', label: 'Any due date' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'today', label: 'Due today' },
    { value: 'week', label: 'Due this week' },
    { value: 'none', label: 'No due date' },
  ];
  protected readonly sortOptions: { value: SortField; label: string }[] = [
    { value: 'created', label: 'Created' },
    { value: 'due', label: 'Due date' },
    { value: 'priority', label: 'Priority' },
    { value: 'title', label: 'Title' },
  ];

  protected readonly query = toSignal(this.route.queryParams.pipe(map((p) => parseQuery(p))), {
    initialValue: parseQuery(this.route.snapshot.queryParams),
  });

  /** Local search box value; synced to URL after 200ms debounce. */
  protected readonly searchText = signal(this.query().q);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly filtersOpen = signal(false);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly bulkProject = signal('');

  protected readonly filtered = computed(() => {
    const q = this.query();
    return sortTasks(
      filterTasks(this.store.tasks(), q, this.store.today(), this.store.projectSubtree()),
      q.sort,
      q.dir,
    );
  });
  protected readonly pageData = computed(() =>
    paginate(this.filtered(), this.query().page, this.store.settings().pageSize),
  );
  protected readonly rangeLabel = computed(() => {
    const total = this.filtered().length;
    if (!total) return '0 tasks';
    const size = this.store.settings().pageSize;
    const p = this.pageData().page;
    return `${(p - 1) * size + 1}–${Math.min(p * size, total)} of ${total}`;
  });
  protected readonly activeFilterCount = computed(() => {
    const q = this.query();
    return (
      q.status.length +
      q.priority.length +
      (q.project ? 1 : 0) +
      (q.assignee ? 1 : 0) +
      (q.tag ? 1 : 0) +
      (q.due !== 'all' ? 1 : 0)
    );
  });
  /** The saved view whose settings equal the current URL (page ignored), if any. */
  protected readonly activeView = computed(() => findView(this.store.views(), this.query()));
  protected readonly activeViewBoardParams = computed(() => {
    const v = this.activeView();
    return v ? boardParams(v.params) : {};
  });
  /** Save/rename dialog state. */
  protected readonly viewDialog = signal<{
    mode: 'create' | 'rename';
    view: SavedView | null;
    name: string;
    error: string;
  } | null>(null);

  protected readonly pageIds = computed(() => this.pageData().items.map((t) => t.id));
  protected readonly allOnPageSelected = computed(() => {
    const ids = this.pageIds();
    const sel = this.selected();
    return ids.length > 0 && ids.every((id) => sel.has(id));
  });
  protected readonly someOnPageSelected = computed(() => {
    const sel = this.selected();
    return !this.allOnPageSelected() && this.pageIds().some((id) => sel.has(id));
  });

  constructor() {
    // keep the input in sync when the URL changes from outside (back button, top-bar search)
    effect(() => {
      const q = this.query().q;
      untracked(() => {
        if (!this.searchTimer) this.searchText.set(q);
      });
    });
    // drop selections that no longer exist
    effect(() => {
      const map = this.store.taskMap();
      untracked(() => {
        const sel = this.selected();
        if ([...sel].some((id) => !map.has(id)))
          this.selected.set(new Set([...sel].filter((id) => map.has(id))));
      });
    });
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  private update(
    patch: Partial<TaskQuery>,
    opts: { replace?: boolean; keepPage?: boolean } = {},
  ): void {
    const next: TaskQuery = { ...this.query(), ...patch };
    if (!opts.keepPage && !('page' in patch)) next.page = 1;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: serializeQuery(next),
      replaceUrl: opts.replace,
    });
  }

  protected onSearch(value: string): void {
    this.searchText.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.update({ q: value.trim() }, { replace: true });
    }, 200);
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected toggleStatus(s: Status): void {
    const cur = this.query().status;
    this.update({ status: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] });
  }

  protected togglePriority(p: Priority): void {
    const cur = this.query().priority;
    this.update({ priority: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] });
  }

  protected setProject(project: string): void {
    this.update({ project });
  }
  protected setAssignee(assignee: string): void {
    this.update({ assignee });
  }
  protected setTag(tag: string): void {
    this.update({ tag });
  }
  protected setDue(due: string): void {
    this.update({ due: due as DueFilter });
  }
  protected setSort(sort: string): void {
    this.update({ sort: sort as SortField }, { keepPage: true });
  }
  protected toggleDir(): void {
    this.update({ dir: this.query().dir === 'asc' ? 'desc' : 'asc' }, { keepPage: true });
  }
  protected goPage(page: number): void {
    this.update({ page });
  }
  protected clearFilters(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.searchText.set('');
    this.update({ ...DEFAULT_QUERY, sort: this.query().sort, dir: this.query().dir });
  }

  /** Exports exactly the tasks matching the current filters, in the current sort order (all pages). */
  protected exportCsv(): void {
    const tasks = this.filtered();
    const csv = tasksToCsv(tasks, {
      projects: this.store.projectMap(),
      members: this.store.memberMap(),
      tasks: this.store.taskMap(),
      statusName: (t) => this.statusName(t),
      projectName: (id) => projectPath(this.store.projects(), id),
    });
    // BOM so spreadsheet apps detect UTF-8 (titles use curly quotes, names may have accents)
    downloadFile(
      `taskpilot-tasks-${toDateKey(new Date())}.csv`,
      `\uFEFF${csv}`,
      'text/csv;charset=utf-8',
    );
    this.toast.show(`Exported ${tasks.length} task${tasks.length === 1 ? '' : 's'} to CSV`, {
      kind: 'success',
    });
  }

  // ---------- saved views ----------

  /** A readable default name built from the active filters, e.g. "High · Website · #bug". */
  private suggestViewName(): string {
    const q = this.query();
    const parts: string[] = [];
    if (q.q) parts.push(`“${q.q}”`);
    parts.push(...q.status.map((s) => STATUS_LABELS[s]));
    parts.push(...q.priority.map((p) => PRIORITY_LABELS[p]));
    if (q.project)
      parts.push(
        q.project === 'none' ? 'No project' : (this.projectOf(q.project)?.name ?? 'Project'),
      );
    if (q.assignee)
      parts.push(
        q.assignee === 'none' ? 'Unassigned' : (this.memberOf(q.assignee)?.name ?? 'Assignee'),
      );
    if (q.tag) parts.push(`#${q.tag}`);
    if (q.due !== 'all') parts.push(this.dueOptions.find((d) => d.value === q.due)!.label);
    let name = parts.join(' · ') || 'All tasks';
    if (name.length > 60) name = `${name.slice(0, 59)}…`;
    // keep it unique so the user can just press Enter
    const taken = new Set(this.store.views().map((v) => v.name.toLocaleLowerCase()));
    let candidate = name;
    for (let i = 2; taken.has(candidate.toLocaleLowerCase()); i++) candidate = `${name} (${i})`;
    return candidate;
  }

  protected openSaveView(): void {
    this.viewDialog.set({ mode: 'create', view: null, name: this.suggestViewName(), error: '' });
  }

  protected openRenameView(view: SavedView): void {
    this.viewDialog.set({ mode: 'rename', view, name: view.name, error: '' });
  }

  protected setViewName(name: string): void {
    const d = this.viewDialog();
    if (d) this.viewDialog.set({ ...d, name, error: '' });
  }

  protected submitView(e: Event): void {
    e.preventDefault();
    const d = this.viewDialog();
    if (!d) return;
    const error = validateViewName(d.name, this.store.views(), d.view?.id ?? null);
    if (error) {
      this.viewDialog.set({ ...d, error });
      return;
    }
    if (d.mode === 'create') {
      const v = this.store.createView(d.name, viewParams(this.query()));
      this.toast.show(`View “${v.name}” saved`, { kind: 'success' });
    } else if (d.view) {
      this.store.renameView(d.view.id, d.name);
      this.toast.show(`View renamed to “${d.name.trim()}”`, { kind: 'success' });
    }
    this.viewDialog.set(null);
  }

  protected deleteView(view: SavedView): void {
    this.store.deleteView(view.id);
    this.toast.show(`View “${view.name}” deleted`, {
      actionLabel: 'Undo',
      action: () => this.store.undo(),
    });
  }

  // ---------- selection & bulk ----------

  protected isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  protected toggleSelect(id: string): void {
    const s = new Set(this.selected());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.selected.set(s);
  }

  protected toggleSelectPage(): void {
    const s = new Set(this.selected());
    if (this.allOnPageSelected()) this.pageIds().forEach((id) => s.delete(id));
    else this.pageIds().forEach((id) => s.add(id));
    this.selected.set(s);
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected bulkDone(): void {
    const ids = [...this.selected()];
    // blocked tasks are refused by the store (it shows an error toast naming the blockers)
    const done = this.store.setStatus(ids, 'done');
    if (done.length)
      this.toast.show(`Marked ${done.length} task${done.length === 1 ? '' : 's'} as done`, {
        kind: 'success',
        actionLabel: 'Undo',
        action: () => this.store.undo(),
      });
    this.clearSelection();
  }

  protected bulkMove(projectId: string): void {
    if (!projectId) return;
    const ids = [...this.selected()];
    const target = projectId === 'none' ? null : projectId;
    this.store.moveToProject(ids, target);
    const name = target ? (this.store.projectMap().get(target)?.name ?? 'project') : 'No project';
    this.toast.show(`Moved ${ids.length} task${ids.length === 1 ? '' : 's'} to ${name}`, {
      actionLabel: 'Undo',
      action: () => this.store.undo(),
    });
    this.bulkProject.set('');
    this.clearSelection();
  }

  protected bulkDelete(): void {
    const ids = [...this.selected()];
    const n = this.store.deleteTasks(ids);
    this.toast.show(`Deleted ${n} task${n === 1 ? '' : 's'}`, {
      actionLabel: 'Undo',
      action: () => this.store.undo(),
    });
    this.clearSelection();
  }

  protected deleteOne(t: Task): void {
    this.store.deleteTasks([t.id]);
    this.toast.show(`Deleted “${t.title}”`, {
      actionLabel: 'Undo',
      action: () => this.store.undo(),
    });
  }

  // ---------- row helpers ----------

  protected overdue(t: Task): boolean {
    return isOverdue(t, this.store.today());
  }

  protected due(t: Task): string {
    return t.dueDate ? relativeDue(t.dueDate, this.store.today()) : '—';
  }

  protected projectOf(id: string | null) {
    return id ? this.store.projectMap().get(id) : undefined;
  }

  protected blockedTitle(t: Task): string {
    const open = openBlockers(t, this.store.taskMap());
    return `Blocked by ${open.map((b) => b.title).join(', ')}`;
  }

  /** Workflow status name (falls back to the category label). */
  protected statusName(t: Task): string {
    return this.store.statusOf(t)?.name ?? STATUS_LABELS[t.status];
  }

  protected memberOf(id: string | null) {
    return id ? this.store.memberMap().get(id) : undefined;
  }

  protected subtaskLabel(t: Task): string {
    return t.subtasks.length
      ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`
      : '';
  }
}
