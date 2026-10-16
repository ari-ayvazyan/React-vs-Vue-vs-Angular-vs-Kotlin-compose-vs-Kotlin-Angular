import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CalendarDay,
  DateFmt,
  Priority,
  UNASSIGNED,
  buildMonthGrid,
  isTaskOverdue,
  shiftMonth,
  yearMonthOf,
} from '../../core/kt';
import { StoreService } from '../../core/store.service';
import { UiService } from '../../core/ui.service';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';

const MAX_VISIBLE = 3;

@Component({
  selector: 'app-calendar',
  imports: [RouterLink, Icon, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calendar.html',
})
export class CalendarPage {
  protected readonly store = inject(StoreService);
  protected readonly ui = inject(UiService);
  protected readonly weekdays = DateFmt.weekdayNames();
  protected readonly fmt = DateFmt;
  protected readonly maxVisible = MAX_VISIBLE;
  protected readonly priorityLabel = (p: string) => Priority.label(p);
  protected readonly UNASSIGNED = UNASSIGNED;
  protected readonly assigneeFilter = signal('');

  /** Displayed month; starts at the current month once the client knows "today". */
  protected readonly month = linkedSignal(() => {
    const today = this.store.today();
    return today ? yearMonthOf(today) : null;
  });
  protected readonly grid = computed(() => {
    const m = this.month();
    return m ? buildMonthGrid(m.year, m.month, this.store.tasks(), this.store.today(), this.assigneeFilter()) : null;
  });
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected shift(delta: number): void {
    const m = this.month();
    if (m) this.month.set(shiftMonth(m.year, m.month, delta));
    this.expanded.set(new Set());
  }

  protected goToday(): void {
    this.month.set(yearMonthOf(this.store.today()));
  }

  protected toggleExpanded(date: string): void {
    const next = new Set(this.expanded());
    if (next.has(date)) next.delete(date);
    else next.add(date);
    this.expanded.set(next);
  }

  protected visibleTasks(day: CalendarDay) {
    return this.expanded().has(day.date) ? day.tasks : day.tasks.slice(0, MAX_VISIBLE);
  }

  protected overdue = (t: Parameters<typeof isTaskOverdue>[0]) => isTaskOverdue(t, this.store.today());
}
