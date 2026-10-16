import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { StoreService } from '../../services/store.service';
import { UiService } from '../../services/ui.service';
import {
  DEFAULT_WORKFLOW,
  PRIORITY_LABELS,
  RECURRENCE_LABELS,
  STATUSES,
  STATUS_LABELS,
  Status,
  Task,
} from '../../core/models';
import { ColumnTarget } from '../../core/task-ops';
import { formatShortDate, relativeDue } from '../../core/dates';
import { DueFilter, filterTasks, isOverdue } from '../../core/filters';
import { boardParams, boardQuery, sameParams, viewParams } from '../../core/views';
import { openBlockers } from '../../core/dependencies';
import { Icon } from '../../components/icon';
import { Avatar } from '../../components/avatar';

const DUE_LABELS: Record<DueFilter, string> = {
  all: 'Any due date',
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Due this week',
  none: 'No due date',
};

/**
 * A board column: one workflow status of the selected project, or (for "All projects" / "No
 * project") one status category. Keys of the default workflow equal the category names, so
 * `board-column-todo|in_progress|done` test ids work in both modes.
 */
interface BoardColumn {
  key: string;
  label: string;
  color: string;
  category: Status;
  statusId?: string;
  inColumn: (t: Task) => boolean;
}

interface DropTarget {
  key: string;
  index: number; // index among visible cards
}

@Component({
  selector: 'app-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, Avatar],
  templateUrl: './board.html',
  styleUrl: './board.css',
})
export class BoardPage {
  protected readonly store = inject(StoreService);
  protected readonly ui = inject(UiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);

  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly recurrenceLabels = RECURRENCE_LABELS;
  /**
   * Board filters, from the URL: the task-list filters that make sense here (search, priority,
   * project, assignee, tag, due). Status, sort and paging are ignored (see core/views.ts).
   */
  protected readonly query = toSignal(this.route.queryParams.pipe(map((p) => boardQuery(p))), {
    initialValue: boardQuery(this.route.snapshot.queryParams),
  });
  protected readonly projectFilter = computed(() => this.query().project);
  protected readonly assigneeFilter = computed(() => this.query().assignee);
  /** Filters set by a saved view / URL that have no select on the board itself. */
  protected readonly extraFilters = computed(() => {
    const q = this.query();
    const out: string[] = [];
    if (q.q) out.push(`“${q.q}”`);
    out.push(...q.priority.map((p) => PRIORITY_LABELS[p]));
    if (q.tag) out.push(`#${q.tag}`);
    if (q.due !== 'all') out.push(DUE_LABELS[q.due]);
    return out;
  });
  protected readonly activeView = computed(() => {
    const current = boardParams(viewParams(this.query()));
    // an unfiltered board is not "a view", even if some view only sets status/sort
    if (!Object.keys(current).length) return undefined;
    return this.store.views().find((v) => sameParams(boardParams(v.params), current));
  });
  protected readonly listParams = computed(() => viewParams(this.query()));

  protected readonly dragId = signal<string | null>(null);
  protected readonly drop = signal<DropTarget | null>(null);
  protected readonly announcement = signal('');

  /** The selected project's workflow statuses, or the three categories. */
  private readonly columnDefs = computed<BoardColumn[]>(() => {
    const pf = this.projectFilter();
    if (pf && pf !== 'none' && this.store.projectMap().has(pf)) {
      const wf = this.store.workflowOf()(pf);
      const ids = new Set(wf.map((s) => s.id));
      const firstOf = new Map<Status, string>();
      for (const s of [...wf].reverse()) firstOf.set(s.category, s.id);
      // sub-projects may use another workflow: their tasks go to the first column of their category
      return wf.map((s) => ({
        key: s.id,
        label: s.name,
        color: s.color,
        category: s.category,
        statusId: s.id,
        inColumn: (t: Task) =>
          t.statusId === s.id || (!ids.has(t.statusId) && firstOf.get(t.status) === s.id),
      }));
    }
    return STATUSES.map((c) => ({
      key: c,
      label: STATUS_LABELS[c],
      color: DEFAULT_WORKFLOW.find((s) => s.category === c)!.color,
      category: c,
      inColumn: (t: Task) => t.status === c,
    }));
  });

  /** Full columns (before the filters), ordered. */
  private readonly fullColumns = computed(() => {
    const tasks = this.store.tasks();
    return new Map(
      this.columnDefs().map((c) => [
        c.key,
        tasks.filter(c.inColumn).sort((a, b) => a.order - b.order),
      ]),
    );
  });

  /** Visible columns after the filters (a project filter includes its sub-projects). */
  protected readonly columns = computed(() => {
    const full = this.fullColumns();
    const q = this.query();
    const today = this.store.today();
    const active = !sameParams(viewParams(q), {});
    const subtree = this.store.projectSubtree();
    return this.columnDefs().map((def) => ({
      ...def,
      tasks: active ? filterTasks(full.get(def.key)!, q, today, subtree) : full.get(def.key)!,
    }));
  });

  protected clearExtraFilters(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: null, priority: null, tag: null, due: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected setFilter(key: 'project' | 'assignee', value: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** New tasks from a column inherit the active filters, so they show up where they were added. */
  protected addTask(key: string): void {
    const col = this.columnDefs().find((c) => c.key === key)!;
    const pf = this.projectFilter();
    const af = this.assigneeFilter();
    this.ui.openNewTask({
      status: col.category,
      ...(col.statusId ? { statusId: col.statusId } : {}),
      ...(pf && this.store.projectMap().has(pf) ? { projectId: pf } : {}),
      ...(af && this.store.memberMap().has(af) ? { assigneeId: af } : {}),
    });
  }

  protected memberOf(id: string | null) {
    return id ? this.store.memberMap().get(id) : undefined;
  }

  protected projectOf(id: string | null) {
    return id ? this.store.projectMap().get(id) : undefined;
  }

  protected due(t: Task): string {
    if (!t.dueDate) return '';
    return t.status === 'done'
      ? formatShortDate(t.dueDate)
      : relativeDue(t.dueDate, this.store.today());
  }

  protected overdue(t: Task): boolean {
    return isOverdue(t, this.store.today());
  }

  protected subDone(t: Task): number {
    return t.subtasks.filter((s) => s.done).length;
  }

  /** Converts an index among visible cards (excluding the dragged one) into an index in the full column. */
  private toFullIndex(key: string, visibleIndex: number, movingId: string): number {
    const visible = this.columns()
      .find((c) => c.key === key)!
      .tasks.filter((t) => t.id !== movingId);
    const full = this.fullColumns()
      .get(key)!
      .filter((t) => t.id !== movingId);
    if (visibleIndex < visible.length) return full.indexOf(visible[visibleIndex]);
    if (!visible.length) return full.length;
    return full.indexOf(visible[visible.length - 1]) + 1;
  }

  /** Returns false when the store refused the move (blocked task to Done). */
  private move(id: string, key: string, visibleIndex: number): boolean {
    const task = this.store.getTask(id);
    const col = this.columnDefs().find((c) => c.key === key);
    if (!task || !col) return false;
    const target: ColumnTarget = {
      category: col.category,
      statusId: col.statusId,
      inColumn: col.inColumn,
    };
    return this.store.moveOnBoard(id, target, this.toFullIndex(key, visibleIndex, id));
  }

  /** Key of the column a task is shown in. */
  private columnKeyOf(t: Task): string | undefined {
    return this.columnDefs().find((c) => c.inColumn(t))?.key;
  }

  protected blockedTitle(t: Task): string {
    return `Blocked by ${openBlockers(t, this.store.taskMap())
      .map((b) => b.title)
      .join(', ')}`;
  }

  // ---------- native drag & drop ----------

  protected onDragStart(e: DragEvent, t: Task): void {
    this.dragId.set(t.id);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
    }
  }

  protected onDragEnd(): void {
    this.dragId.set(null);
    this.drop.set(null);
  }

  protected onDragOver(e: DragEvent, key: string): void {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const list = e.currentTarget as HTMLElement;
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-card-id]')).filter(
      (el) => el.dataset['cardId'] !== this.dragId(),
    );
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    const cur = this.drop();
    if (!cur || cur.key !== key || cur.index !== index) this.drop.set({ key, index });
  }

  protected onDragLeave(e: DragEvent): void {
    const list = e.currentTarget as HTMLElement;
    if (!list.contains(e.relatedTarget as Node | null)) this.drop.set(null);
  }

  protected onDrop(e: DragEvent, key: string): void {
    e.preventDefault();
    const id = e.dataTransfer?.getData('text/plain') || this.dragId();
    const target = this.drop() ?? { key, index: Number.MAX_SAFE_INTEGER };
    if (id) {
      const index = target.key === key ? target.index : Number.MAX_SAFE_INTEGER;
      if (this.move(id, key, index)) this.announce(id, key);
      else this.announceBlocked(id);
    }
    this.onDragEnd();
  }

  /** Visible index (excluding dragged card) at which the placeholder is shown. */
  protected placeholderAt(key: string): number {
    const d = this.drop();
    return d && d.key === key ? d.index : -1;
  }

  protected showEndPlaceholder(key: string, tasks: Task[]): boolean {
    const at = this.placeholderAt(key);
    if (at < 0) return false;
    const dragId = this.dragId();
    const count = tasks.filter((t) => t.id !== dragId).length;
    return at >= count;
  }

  /** Maps a rendered card's position to its index among non-dragged cards. */
  protected indexWithoutDragged(tasks: Task[], i: number): number {
    const dragId = this.dragId();
    if (!dragId) return i;
    const draggedPos = tasks.findIndex((t) => t.id === dragId);
    return draggedPos >= 0 && i > draggedPos ? i - 1 : i;
  }

  // ---------- keyboard alternative ----------

  protected onCardKey(e: KeyboardEvent, t: Task): void {
    if (e.key === 'Enter') {
      void this.router.navigate(['/tasks', t.id]);
      return;
    }
    if (!e.shiftKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const cols = this.columns();
    const si = cols.findIndex((c) => c.key === this.columnKeyOf(t));
    if (si < 0) return;
    const col = cols[si];
    const idx = col.tasks.findIndex((x) => x.id === t.id);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const ni = si + (e.key === 'ArrowLeft' ? -1 : 1);
      if (ni < 0 || ni >= cols.length) return;
      const target = cols[ni].key;
      const targetLen = cols[ni].tasks.length;
      if (this.move(t.id, target, Math.min(idx, targetLen))) this.announce(t.id, target);
      else this.announceBlocked(t.id);
    } else {
      const ni = idx + (e.key === 'ArrowUp' ? -1 : 1);
      if (ni < 0 || ni >= col.tasks.length) return;
      this.move(t.id, col.key, ni);
      this.announcement.set(`${t.title} moved to position ${ni + 1} in ${col.label}`);
    }
    this.refocus(t.id);
  }

  private announce(id: string, key: string): void {
    const t = this.store.getTask(id);
    const col = this.columnDefs().find((c) => c.key === key);
    if (t && col) this.announcement.set(`${t.title} moved to ${col.label}`);
  }

  private announceBlocked(id: string): void {
    const t = this.store.getTask(id);
    if (t) this.announcement.set(`${t.title} is blocked and cannot be moved to Done`);
  }

  private refocus(id: string): void {
    setTimeout(() => {
      const el = this.doc.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`);
      el?.focus();
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }
}
