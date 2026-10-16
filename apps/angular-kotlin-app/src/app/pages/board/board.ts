import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  DateFmt,
  NO_PROJECT,
  Priority,
  Recurrence,
  Task,
  TaskQuery,
  TaskQueries,
  UNASSIGNED,
  boardColumns,
  describeTaskQuery,
  isBlocked,
  isTaskOverdue,
} from '../../core/kt';
import { StoreService } from '../../core/store.service';
import { UiService } from '../../core/ui.service';
import { injectQueryString } from '../../core/url-query';
import { Avatar } from '../../shared/avatar';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';

interface DropTarget {
  status: string;
  beforeId: string | null;
}

@Component({
  selector: 'app-board',
  imports: [RouterLink, Icon, Skeleton, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board.html',
})
export class BoardPage {
  protected readonly store = inject(StoreService);
  protected readonly ui = inject(UiService);
  private readonly router = inject(Router);
  private readonly queryString = injectQueryString();

  protected readonly NO_PROJECT = NO_PROJECT;
  protected readonly UNASSIGNED = UNASSIGNED;
  protected readonly recurrenceLabel = (r: string) => Recurrence.label(r);

  protected readonly fmt = DateFmt;
  protected readonly priorityLabel = (p: string) => Priority.label(p);
  /**
   * Board filters live in the URL (same parameters as the task list), so saved views can be opened here.
   * Status, sort and page are ignored by the board.
   */
  protected readonly query = computed(() => TaskQueries.parse(this.queryString()).forBoard());
  /** Filters beyond project/assignee (search, priority, tag, due) that came from a saved view or link. */
  protected readonly extraFilters = computed(() => {
    const q = this.query().withProject('').withAssignee('');
    return q.isFiltered ? describeTaskQuery(q) : '';
  });
  protected readonly dragging = signal<string | null>(null);
  protected readonly dropTarget = signal<DropTarget | null>(null);
  protected readonly announcement = signal('');

  /** Columns come from Kotlin: the project's workflow statuses, or the three categories for "All projects". */
  protected readonly columns = computed(() => boardColumns(this.store.state(), this.query(), this.store.today()));
  /** Project whose workflow the board shows ("" = all projects / categories). */
  private readonly boardProject = computed(() => (this.store.projectMap().has(this.query().projectId) ? this.query().projectId : ''));

  protected project(id: string | null | undefined) {
    return id ? (this.store.projectMap().get(id) ?? null) : null;
  }

  protected blocked(t: Task): boolean {
    return isBlocked(this.store.state(), t);
  }

  protected overdue(t: Task): boolean {
    return isTaskOverdue(t, this.store.today());
  }

  // ---- native HTML5 drag & drop ----
  protected onDragStart(e: DragEvent, t: Task): void {
    e.dataTransfer?.setData('text/plain', t.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    this.dragging.set(t.id);
  }

  protected onDragOver(e: DragEvent, status: string): void {
    if (!this.dragging() && !e.dataTransfer?.types.includes('text/plain')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const list = (e.currentTarget as HTMLElement).querySelector('.board-cards');
    let beforeId: string | null = null;
    if (list) {
      for (const card of Array.from(list.querySelectorAll<HTMLElement>('[data-card-id]'))) {
        const id = card.dataset['cardId'] ?? null;
        if (id === this.dragging()) continue;
        const rect = card.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          beforeId = id;
          break;
        }
      }
    }
    const cur = this.dropTarget();
    if (!cur || cur.status !== status || cur.beforeId !== beforeId) this.dropTarget.set({ status, beforeId });
  }

  protected onDragLeave(e: DragEvent): void {
    const related = e.relatedTarget as Node | null;
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) this.dropTarget.set(null);
  }

  protected onDrop(e: DragEvent, status: string): void {
    e.preventDefault();
    const id = e.dataTransfer?.getData('text/plain') || this.dragging();
    const target = this.dropTarget();
    if (id) {
      this.store.moveTaskToColumn(id, status, target?.status === status ? target.beforeId : null, this.boardProject());
      this.announce(id);
    }
    this.onDragEnd();
  }

  protected onDragEnd(): void {
    this.dragging.set(null);
    this.dropTarget.set(null);
  }

  // ---- keyboard alternative ----
  protected onCardKeydown(e: KeyboardEvent, t: Task): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this.router.navigate(['/tasks', t.id]);
      return;
    }
    if (!e.shiftKey) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    if (this.store.moveTaskBy(t.id, move[0], move[1], this.query())) {
      this.announce(t.id);
      setTimeout(() => document.querySelector<HTMLElement>(`[data-card-id="${t.id}"]`)?.focus());
    }
  }

  protected apply(q: TaskQuery): void {
    const qs = q.forBoard().toQueryString();
    void this.router.navigateByUrl('/board' + (qs ? '?' + qs : ''), { replaceUrl: true });
  }

  protected clearExtraFilters(): void {
    const q = this.query();
    this.apply(TaskQueries.DEFAULT.withProject(q.projectId).withAssignee(q.assignee));
  }

  protected addDefaults(status: string) {
    const project = this.query().projectId;
    const assignee = this.query().assignee;
    return {
      status,
      projectId: project === NO_PROJECT ? '' : project,
      assigneeId: assignee === UNASSIGNED ? '' : assignee,
    };
  }

  private announce(id: string): void {
    const t = this.store.task(id);
    if (!t) return;
    const col = this.columns().find((c) => c.tasks.some((x) => x.id === id));
    if (!col) return;
    const pos = col.tasks.findIndex((c) => c.id === id) + 1;
    this.announcement.set(`Moved “${t.title}” to ${col.name}, position ${pos} of ${col.tasks.length}.`);
  }
}
