import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  DateFmt,
  TimelineBar,
  TimelineZoom,
  buildTimeline,
  shiftDate,
  timelineDayAt,
  timelinePreview,
} from '../../core/kt';
import { StoreService } from '../../core/store.service';
import { UiService } from '../../core/ui.service';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';

interface DragState {
  id: string;
  original: string;
  due: string;
}

const ZOOM_KEY = 'taskpilot:timeline-zoom';

/** Gantt-style timeline; all layout (rows, bars, arrows, ticks, drag maths) is computed in Kotlin. */
@Component({
  selector: 'app-timeline',
  imports: [RouterLink, Icon, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './timeline.html',
})
export class TimelinePage {
  protected readonly store = inject(StoreService);
  private readonly ui = inject(UiService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly chart = viewChild<ElementRef<SVGSVGElement>>('chart');

  protected readonly zooms = TimelineZoom.all;
  protected readonly zoomLabel = (z: string) => TimelineZoom.label(z);
  protected readonly fmt = DateFmt;
  protected readonly zoom = signal<string>(TimelineZoom.MONTH);
  protected readonly hideDone = signal(false);
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());
  protected readonly drag = signal<DragState | null>(null);

  protected readonly timeline = computed(() => {
    if (!this.store.ready()) return null;
    return buildTimeline(this.store.state(), this.zoom(), this.store.today(), [...this.collapsed()], this.hideDone());
  });
  protected readonly groupKeys = computed(() => (this.timeline()?.rows ?? []).filter((r) => r.kind === 'group').map((r) => r.key));

  private scrolledToToday = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.isBrowser) this.endDrag();
    });
    if (this.isBrowser) {
      try {
        const z = localStorage.getItem(ZOOM_KEY);
        if (z && TimelineZoom.all.includes(z)) this.zoom.set(z);
      } catch {
        // storage unavailable: keep default zoom
      }
    }
    // Scroll to "today" the first time the chart is rendered.
    effect(() => {
      const tl = this.timeline();
      const el = this.scroller()?.nativeElement;
      if (!tl || !el || this.scrolledToToday) return;
      this.scrolledToToday = true;
      untracked(() => setTimeout(() => this.scrollToToday()));
    });
  }

  protected setZoom(z: string): void {
    this.zoom.set(z);
    try {
      localStorage.setItem(ZOOM_KEY, z);
    } catch {
      // ignore
    }
    setTimeout(() => this.scrollToToday());
  }

  protected scrollToToday(): void {
    const tl = this.timeline();
    const el = this.scroller()?.nativeElement;
    if (!tl || !el) return;
    const labelWidth = el.querySelector<HTMLElement>('.tl-labels')?.offsetWidth ?? 0;
    el.scrollLeft = Math.max(0, tl.todayX - (el.clientWidth - labelWidth) / 2);
  }

  protected toggleGroup(key: string): void {
    const next = new Set(this.collapsed());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.collapsed.set(next);
  }

  protected setAllCollapsed(collapse: boolean): void {
    this.collapsed.set(collapse ? new Set(this.groupKeys()) : new Set());
  }

  /** Bar geometry, using the drag preview for the bar being resized. */
  protected span(bar: TimelineBar): { x: number; width: number } {
    const d = this.drag();
    const tl = this.timeline();
    if (!d || !tl || d.id !== bar.task.id) return { x: bar.x, width: bar.width };
    return timelinePreview(tl, bar, d.due);
  }

  protected dueLabel(bar: TimelineBar): string {
    const d = this.drag();
    return DateFmt.long(d && d.id === bar.task.id ? d.due : bar.dueDate);
  }

  // ---- resizing the right end (pointer) ----
  // Move/up are tracked on the window: the handle moves under the pointer while resizing, and pointer capture
  // alone proved unreliable (a missed pointerup left the drag dangling and nothing was saved).
  private readonly moveListener = (e: PointerEvent) => this.onHandleMove(e);
  private readonly upListener = () => this.onHandleUp();
  private readonly cancelListener = () => this.endDrag();

  protected onHandleDown(e: PointerEvent, bar: TimelineBar): void {
    if (e.button !== 0) return;
    e.preventDefault();
    this.drag.set({ id: bar.task.id, original: bar.dueDate, due: bar.dueDate });
    window.addEventListener('pointermove', this.moveListener);
    window.addEventListener('pointerup', this.upListener);
    window.addEventListener('pointercancel', this.cancelListener);
  }

  private endDrag(): void {
    window.removeEventListener('pointermove', this.moveListener);
    window.removeEventListener('pointerup', this.upListener);
    window.removeEventListener('pointercancel', this.cancelListener);
    this.drag.set(null);
  }

  private onHandleMove(e: PointerEvent): void {
    const d = this.drag();
    const tl = this.timeline();
    const svg = this.chart()?.nativeElement;
    if (!d || !tl || !svg) return;
    const x = e.clientX - svg.getBoundingClientRect().left;
    const due = timelineDayAt(tl, x);
    if (due !== d.due) this.drag.set({ ...d, due });
  }

  private onHandleUp(): void {
    const d = this.drag();
    this.endDrag();
    if (d) this.commit(d.id, d.original, d.due);
  }

  // ---- keyboard alternative: ←/→ one day, Shift = one week ----
  protected onHandleKey(e: KeyboardEvent, bar: TimelineBar): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const days = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 7 : 1);
    this.commit(bar.task.id, bar.dueDate, shiftDate(bar.dueDate, days), false);
    setTimeout(() => document.querySelector<SVGElement>(`[data-handle-id="${bar.task.id}"]`)?.focus());
  }

  private commit(id: string, from: string, to: string, toast = true): void {
    if (from === to) return;
    if (!this.store.setDueDate(id, to)) return;
    if (toast) {
      this.ui.toast(`Due date moved to ${DateFmt.long(to)}`, { actionLabel: 'Undo', action: () => this.store.undo() });
    }
  }
}
