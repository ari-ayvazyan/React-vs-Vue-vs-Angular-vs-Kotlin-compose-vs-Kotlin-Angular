import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  DateFmt,
  DueFilter,
  NO_PROJECT,
  Priority,
  Recurrence,
  SortKey,
  Status,
  Task,
  TaskQuery,
  TaskQueries,
  UNASSIGNED,
  activeView,
  exportTasksCsv,
  projectPath,
  isBlocked,
  validateViewName,
  isTaskOverdue,
  queryTasks,
} from '../../core/kt';
import { StoreService } from '../../core/store.service';
import { UiService } from '../../core/ui.service';
import { injectQueryString } from '../../core/url-query';
import { Autofocus } from '../../shared/autofocus';
import { Avatar } from '../../shared/avatar';
import { StatusPill } from '../../shared/status-pill';
import { Dialog } from '../../shared/dialog';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';

@Component({
  selector: 'app-tasks',
  imports: [RouterLink, Icon, Skeleton, Avatar, Dialog, Autofocus, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tasks.html',
})
export class TasksPage implements OnDestroy {
  protected readonly store = inject(StoreService);
  protected readonly ui = inject(UiService);
  private readonly router = inject(Router);
  private readonly queryString = injectQueryString();

  protected readonly statuses = Status.all;
  protected readonly priorities = Priority.all;
  protected readonly dueFilters = DueFilter.all;
  protected readonly sortKeys = SortKey.all;
  protected readonly NO_PROJECT = NO_PROJECT;
  protected readonly UNASSIGNED = UNASSIGNED;
  protected readonly recurrenceLabel = (r: string) => Recurrence.label(r);
  protected readonly statusLabel = (s: string) => Status.label(s);
  protected readonly priorityLabel = (p: string) => Priority.label(p);
  protected readonly dueLabel = (d: string) => DueFilter.label(d);
  protected readonly sortLabel = (s: string) => SortKey.label(s);
  protected readonly fmt = DateFmt;

  protected readonly query = computed(() => TaskQueries.parse(this.queryString()));
  protected readonly result = computed(() =>
    queryTasks(this.store.state(), this.query(), this.store.today(), this.store.settings().pageSize),
  );
  protected readonly searchText = linkedSignal(() => this.query().search);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly bulkProject = signal('');
  protected readonly bulkAssignee = signal('');

  // ---- saved views ----
  protected readonly currentView = computed(() => activeView(this.store.views(), this.queryString()) ?? null);
  protected readonly savingView = signal(false);
  protected readonly viewName = signal('');
  protected readonly viewError = signal('');

  protected readonly pageIds = computed(() => this.result().items.map((t) => t.id));
  protected readonly allOnPageSelected = computed(() => {
    const ids = this.pageIds();
    const sel = this.selected();
    return ids.length > 0 && ids.every((id) => sel.has(id));
  });
  protected readonly someOnPageSelected = computed(() => {
    const sel = this.selected();
    return this.pageIds().some((id) => sel.has(id)) && !this.allOnPageSelected();
  });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Selection is scoped to the current result set: drop it when filters/page change.
    effect(() => {
      this.queryString();
      untracked(() => this.selected.set(new Set()));
    });
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  protected projectName(id: string | null | undefined): string {
    return id ? projectPath(this.store.state(), id) : '';
  }

  protected projectColor(id: string | null | undefined): string {
    return id ? (this.store.projectMap().get(id)?.color ?? 'transparent') : 'transparent';
  }

  protected blocked(t: Task): boolean {
    return isBlocked(this.store.state(), t);
  }

  protected overdue(t: Task): boolean {
    return isTaskOverdue(t, this.store.today());
  }

  protected apply(q: TaskQuery, replaceUrl = false): void {
    const qs = q.toQueryString();
    void this.router.navigateByUrl('/tasks' + (qs ? '?' + qs : ''), { replaceUrl });
  }

  protected onSearch(value: string): void {
    this.searchText.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.apply(this.query().withSearch(value.trim()), true), 200);
  }

  protected goToPage(page: number): void {
    this.apply(this.query().withPage(page));
  }

  protected toggleSelect(id: string, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  protected toggleSelectPage(checked: boolean): void {
    const next = new Set(this.selected());
    for (const id of this.pageIds()) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    this.selected.set(next);
  }

  protected openSaveView(): void {
    this.viewName.set('');
    this.viewError.set('');
    this.savingView.set(true);
  }

  protected saveView(e: Event): void {
    e.preventDefault();
    const err = validateViewName(this.store.views(), this.viewName(), null);
    this.viewError.set(err);
    if (err) return;
    this.store.saveView(this.viewName(), this.query());
    this.savingView.set(false);
    this.ui.toast(`Saved view “${this.viewName().trim()}”`, { tone: 'success', actionLabel: 'Undo', action: () => this.store.undo() });
  }

  /** Query params for opening the current view on the board (status/sort are dropped by Kotlin). */
  protected boardParams(): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(this.query().forBoard().toQueryString()));
  }

  /** Downloads exactly the filtered + sorted tasks (all pages) as CSV; the CSV itself is built in Kotlin. */
  protected exportCsv(): void {
    const csv = exportTasksCsv(this.store.state(), this.query(), this.store.today());
    // BOM so spreadsheet apps detect UTF-8.
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tasks-${this.store.today()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const n = this.result().total;
    this.ui.toast(`Exported ${n} task${n === 1 ? '' : 's'} as CSV`, { tone: 'success' });
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected bulkDone(): void {
    const n = this.store.markDone([...this.selected()]);
    this.selected.set(new Set());
    this.ui.toast(n ? `Marked ${n} task${n === 1 ? '' : 's'} done` : 'Selected tasks were already done', {
      actionLabel: n ? 'Undo' : undefined,
      action: () => this.store.undo(),
    });
  }

  protected bulkDelete(): void {
    const n = this.store.deleteTasks([...this.selected()]);
    this.selected.set(new Set());
    this.ui.toast(`Deleted ${n} task${n === 1 ? '' : 's'}`, { actionLabel: 'Undo', action: () => this.store.undo() });
  }

  protected bulkMove(projectId: string): void {
    if (!projectId) return;
    const n = this.store.moveToProject([...this.selected()], projectId);
    const name = projectId === NO_PROJECT ? 'No project' : this.projectName(projectId);
    this.selected.set(new Set());
    this.bulkProject.set('');
    this.ui.toast(`Moved ${n} task${n === 1 ? '' : 's'} to ${name}`, { actionLabel: 'Undo', action: () => this.store.undo() });
  }

  protected bulkAssign(memberId: string): void {
    if (!memberId) return;
    const n = this.store.assignTasks([...this.selected()], memberId);
    const name = memberId === UNASSIGNED ? 'nobody' : (this.store.member(memberId)?.name ?? '');
    this.selected.set(new Set());
    this.bulkAssignee.set('');
    this.ui.toast(`Assigned ${n} task${n === 1 ? '' : 's'} to ${name}`, { actionLabel: 'Undo', action: () => this.store.undo() });
  }

  protected toggleDone(t: Task): void {
    this.store.toggleDone(t.id);
  }
}
