import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { StoreService } from '../../services/store.service';
import { ToastService } from '../../services/toast.service';
import { STATUS_LABELS, Task } from '../../core/models';
import {
  TimelineItem,
  TimelineRow,
  ZOOMS,
  ZOOM_PX,
  Zoom,
  axisTicks,
  buildTimeline,
  dayOffset,
  flattenRows,
  shiftDueDate,
  timelineRange,
  visibleWindow,
} from '../../core/timeline';
import { addDays, formatShortDate, parseDateKey, toDateKey } from '../../core/dates';
import { Icon } from '../../components/icon';
import { projectPath, treeOrder } from '../../core/project-tree';

const ROW_H = 34;
const HEADER_H = 40;
const UNDATED_LIMIT = 100;
const NO_PROJECT_COLOR = '#94a3b8';

interface DragState {
  taskId: string;
  pointerId: number;
  startX: number;
  origDue: string;
  minKey: string;
  due: string;
}

interface Arrow {
  id: string;
  d: string;
  open: boolean;
}

@Component({
  selector: 'app-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  templateUrl: './timeline.html',
  styleUrl: './timeline.css',
})
export class TimelinePage {
  protected readonly store = inject(StoreService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly zooms = ZOOMS;
  protected readonly zoomLabels: Record<Zoom, string> = {
    week: 'Week',
    month: 'Month',
    quarter: 'Quarter',
  };
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly rowH = ROW_H;
  protected readonly headerH = HEADER_H;
  protected readonly undatedLimit = UNDATED_LIMIT;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly zoom = computed<Zoom>(() => {
    const z = this.params().get('zoom');
    return (ZOOMS as string[]).includes(z ?? '') ? (z as Zoom) : 'month';
  });
  protected readonly hideDone = computed(() => this.params().get('done') === 'hide');
  protected readonly px = computed(() => ZOOM_PX[this.zoom()]);

  /** Label column width (narrower on phones). */
  protected readonly labelW = signal(260);
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());
  private readonly scrollTop = signal(0);
  private readonly viewportH = signal(600);
  protected readonly drag = signal<DragState | null>(null);

  /** Projects in tree order, labelled with their path ("Parent / Child"). */
  private readonly treeProjects = computed(() => {
    const all = this.store.projects();
    return treeOrder(all).map(({ project }) => ({
      ...project,
      name: projectPath(all, project.id),
    }));
  });
  protected readonly data = computed(() =>
    buildTimeline(this.store.tasks(), this.treeProjects(), { hideDone: this.hideDone() }),
  );
  protected readonly range = computed(() =>
    timelineRange(this.data().groups, this.store.today(), this.zoom()),
  );
  protected readonly chartW = computed(() => this.range().days * this.px());
  protected readonly ticks = computed(() => axisTicks(this.range(), this.zoom()));
  protected readonly rows = computed(() => flattenRows(this.data().groups, this.collapsed()));
  protected readonly canvasH = computed(() => HEADER_H + this.rows().length * ROW_H);
  protected readonly todayX = computed(
    () => this.labelW() + (dayOffset(this.range(), this.store.today()) + 0.5) * this.px(),
  );
  protected readonly datedCount = computed(() =>
    this.data().groups.reduce((n, g) => n + g.items.length, 0),
  );

  /** Rows currently rendered (virtualised: only those near the viewport). */
  private readonly window = computed(() =>
    visibleWindow(
      Math.max(0, this.scrollTop() - HEADER_H),
      this.viewportH(),
      ROW_H,
      this.rows().length,
    ),
  );
  protected readonly windowRows = computed(() => {
    const { first, last } = this.window();
    return this.rows()
      .slice(first, last)
      .map((row, i) => ({ row, index: first + i }));
  });

  /** Row index of each visible (dated, expanded) task. */
  private readonly rowIndex = computed(() => {
    const m = new Map<string, number>();
    this.rows().forEach((r, i) => {
      if (r.kind === 'task') m.set(r.item.task.id, i);
    });
    return m;
  });

  /** Dependency arrows (blocker end → blocked start) touching the rendered window. */
  protected readonly arrows = computed<Arrow[]>(() => {
    const { first, last } = this.window();
    const rows = this.rows();
    const index = this.rowIndex();
    const out: Arrow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.kind !== 'task' || !r.item.task.blockedBy.length) continue;
      for (const bid of r.item.task.blockedBy) {
        const bi = index.get(bid);
        if (bi === undefined) continue;
        // skip arrows entirely above or below the rendered window
        if (Math.max(i, bi) < first || Math.min(i, bi) >= last) continue;
        const blocker = rows[bi] as Extract<TimelineRow, { kind: 'task' }>;
        out.push({
          id: `${bid}>${r.item.task.id}`,
          d: this.arrowPath(blocker.item, bi, r.item, i),
          open: blocker.item.task.status !== 'done',
        });
      }
    }
    return out;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const mq = window.matchMedia('(max-width: 767px)');
      const applyWidth = () => this.labelW.set(mq.matches ? 150 : 260);
      applyWidth();
      mq.addEventListener('change', applyWidth);
      const el = this.scroller()?.nativeElement;
      if (!el) return;
      const ro = new ResizeObserver(() => this.viewportH.set(el.clientHeight));
      ro.observe(el);
      destroyRef.onDestroy(() => {
        ro.disconnect();
        mq.removeEventListener('change', applyWidth);
      });
    });
    // Once data is available, start scrolled to (just before) today.
    let scrolledInitially = false;
    effect(() => {
      if (!this.store.ready() || !this.scroller()) return;
      untracked(() => {
        if (scrolledInitially) return;
        scrolledInitially = true;
        setTimeout(() => this.scrollToDay(this.store.today(), 0.3));
      });
    });
  }

  // ---------- geometry ----------

  protected x(key: string): number {
    return this.labelW() + dayOffset(this.range(), key) * this.px();
  }

  /** Bar box for an item, honouring an in-progress drag of its end. */
  protected bar(item: TimelineItem): { left: number; width: number; end: string } {
    const d = this.drag();
    const end = d && d.taskId === item.task.id ? d.due : item.end;
    const left = this.x(item.start);
    return { left, width: Math.max(this.px(), this.x(end) + this.px() - left), end };
  }

  private arrowPath(from: TimelineItem, fi: number, to: TimelineItem, ti: number): string {
    const fb = this.bar(from);
    const tb = this.bar(to);
    const x1 = fb.left + fb.width;
    const y1 = HEADER_H + fi * ROW_H + ROW_H / 2;
    const x2 = tb.left;
    const y2 = HEADER_H + ti * ROW_H + ROW_H / 2;
    const gap = 8;
    if (x2 - gap >= x1 + gap) {
      const mx = x1 + gap;
      return `M${x1},${y1} H${mx} V${y2} H${x2}`;
    }
    // blocked bar starts before the blocker ends: route around between the rows
    const yMid = ti > fi ? y2 - ROW_H / 2 : y2 + ROW_H / 2;
    return `M${x1},${y1} H${x1 + gap} V${yMid} H${x2 - gap} V${y2} H${x2}`;
  }

  protected color(item: TimelineItem): string {
    const pid = item.task.projectId;
    return (pid && this.store.projectMap().get(pid)?.color) || NO_PROJECT_COLOR;
  }

  protected barLabel(item: TimelineItem): string {
    return `${item.task.title}: ${formatShortDate(item.start)} – ${formatShortDate(this.bar(item).end)}`;
  }

  // ---------- controls ----------

  private setParam(patch: Record<string, string | null>): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: patch,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected setZoom(z: Zoom): void {
    if (z === this.zoom()) return;
    const center = this.centerDay();
    void this.setParam({ zoom: z === 'month' ? null : z }).then(() =>
      requestAnimationFrame(() => this.scrollToDay(center, 0.5)),
    );
  }

  protected toggleHideDone(): void {
    void this.setParam({ done: this.hideDone() ? null : 'hide' });
  }

  protected toggleGroup(id: string): void {
    const s = new Set(this.collapsed());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.collapsed.set(s);
  }

  protected setAllCollapsed(collapse: boolean): void {
    this.collapsed.set(collapse ? new Set(this.data().groups.map((g) => g.id)) : new Set());
  }

  protected goToday(): void {
    this.scrollToDay(this.store.today(), 0.3);
  }

  protected onScroll(e: Event): void {
    const el = e.target as HTMLElement;
    if (el.scrollTop !== this.scrollTop()) this.scrollTop.set(el.scrollTop);
  }

  /** The day under the horizontal middle of the chart viewport. */
  private centerDay(): string {
    const el = this.scroller()?.nativeElement;
    if (!el) return this.store.today();
    const chartX = el.scrollLeft + (el.clientWidth - this.labelW()) / 2;
    const days = Math.floor(chartX / this.px());
    return toDateKey(addDays(parseDateKey(this.range().start), days));
  }

  /** Scrolls so `key` sits at `fraction` of the visible chart width. */
  private scrollToDay(key: string, fraction: number): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    const visible = el.clientWidth - this.labelW();
    el.scrollLeft = Math.max(0, dayOffset(this.range(), key) * this.px() - visible * fraction);
  }

  // ---------- resizing the bar end (due date) ----------

  protected onHandleDown(e: PointerEvent, item: TimelineItem): void {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.drag.set({
      taskId: item.task.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      origDue: item.end,
      minKey: item.start,
      due: item.end,
    });
  }

  protected onHandleMove(e: PointerEvent): void {
    const d = this.drag();
    if (!d || d.pointerId !== e.pointerId) return;
    const due = shiftDueDate(d.origDue, (e.clientX - d.startX) / this.px(), d.minKey);
    if (due !== d.due) this.drag.set({ ...d, due });
  }

  protected onHandleUp(e: PointerEvent): void {
    const d = this.drag();
    if (!d || d.pointerId !== e.pointerId) return;
    this.drag.set(null);
    if (d.due !== d.origDue) this.commitDue(d.taskId, d.due);
  }

  protected onHandleCancel(): void {
    this.drag.set(null);
  }

  /** Keyboard alternative: ←/→ move the due date by a day, with Shift by a week. */
  protected onHandleKey(e: KeyboardEvent, item: TimelineItem): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1);
    const due = shiftDueDate(item.end, step, item.start);
    if (due === item.end) return;
    this.commitDue(item.task.id, due, false);
    this.refocusHandle(item.task.id);
  }

  /**
   * A new due date can re-sort the row inside its group; Angular then moves the row's DOM node,
   * which drops focus. Bring the row back into the rendered window if needed and refocus.
   */
  private refocusHandle(id: string): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    const sel = `[data-task-id="${CSS.escape(id)}"] [data-testid="timeline-handle"]`;
    requestAnimationFrame(() => {
      const index = this.rowIndex().get(id);
      if (index === undefined) return;
      const top = HEADER_H + index * ROW_H;
      if (top < el.scrollTop + HEADER_H || top + ROW_H > el.scrollTop + el.clientHeight) {
        el.scrollTop = Math.max(0, top - el.clientHeight / 2);
        this.scrollTop.set(el.scrollTop);
      }
      requestAnimationFrame(() => {
        const handle = el.querySelector<HTMLElement>(sel);
        if (handle && handle !== document.activeElement) handle.focus({ preventScroll: true });
      });
    });
  }

  private commitDue(id: string, due: string, withToast = true): void {
    const t: Task | undefined = this.store.getTask(id);
    if (!t) return;
    this.store.updateTask(id, { dueDate: due });
    if (withToast)
      this.toast.show(`Due date of “${t.title}” moved to ${formatShortDate(due)}`, {
        actionLabel: 'Undo',
        action: () => this.store.undo(),
      });
  }
}
