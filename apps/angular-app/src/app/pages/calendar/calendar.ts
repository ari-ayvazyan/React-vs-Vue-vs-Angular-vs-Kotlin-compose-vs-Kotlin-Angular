import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { StoreService } from '../../services/store.service';
import { UiService } from '../../services/ui.service';
import { MONTH_NAMES, addDays, startOfWeek, toDateKey } from '../../core/dates';
import { Task } from '../../core/models';
import { matchesAssignee } from '../../core/filters';
import { Icon } from '../../components/icon';

interface Cell {
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  tasks: Task[];
}

const MAX_VISIBLE = 3;

@Component({
  selector: 'app-calendar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  templateUrl: './calendar.html',
  styleUrl: './calendar.css',
})
export class CalendarPage {
  protected readonly store = inject(StoreService);
  protected readonly ui = inject(UiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  protected readonly maxVisible = MAX_VISIBLE;
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());

  /** Month shown, from `?month=YYYY-MM`; defaults to the current month (client clock). */
  private readonly monthParam = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('month'))),
    {
      initialValue: this.route.snapshot.queryParamMap.get('month'),
    },
  );
  /** '' = anyone, 'none' = unassigned, else member id (`?assignee=`). */
  protected readonly assigneeFilter = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('assignee') ?? '')),
    { initialValue: this.route.snapshot.queryParamMap.get('assignee') ?? '' },
  );
  protected readonly month = computed(() => {
    const m = this.monthParam();
    if (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)) {
      const [y, mo] = m.split('-').map(Number);
      return new Date(y, mo - 1, 1);
    }
    const now = this.store.now();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  protected readonly title = computed(
    () => `${MONTH_NAMES[this.month().getMonth()]} ${this.month().getFullYear()}`,
  );

  private readonly byDate = computed(() => {
    const m = new Map<string, Task[]>();
    const assignee = this.assigneeFilter();
    for (const t of this.store.tasks()) {
      if (!t.dueDate || !matchesAssignee(t, assignee)) continue;
      const list = m.get(t.dueDate);
      if (list) list.push(t);
      else m.set(t.dueDate, [t]);
    }
    const rank = { urgent: 0, high: 1, medium: 2, low: 3 } as const;
    for (const list of m.values())
      list.sort(
        (a, b) =>
          Number(a.status === 'done') - Number(b.status === 'done') ||
          rank[a.priority] - rank[b.priority],
      );
    return m;
  });

  protected readonly weeks = computed<Cell[][]>(() => {
    const first = this.month();
    const start = startOfWeek(first);
    const today = this.store.today();
    const byDate = this.byDate();
    const lastOfMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const weeks: Cell[][] = [];
    let cursor = start;
    while (weeks.length < 6 && (weeks.length < 4 || cursor <= lastOfMonth)) {
      const row: Cell[] = [];
      for (let i = 0; i < 7; i++) {
        const key = toDateKey(cursor);
        row.push({
          key,
          day: cursor.getDate(),
          inMonth: cursor.getMonth() === first.getMonth(),
          isToday: key === today,
          isWeekend: i >= 5,
          tasks: byDate.get(key) ?? [],
        });
        cursor = addDays(cursor, 1);
      }
      weeks.push(row);
    }
    return weeks;
  });

  protected readonly monthCount = computed(() =>
    this.weeks()
      .flat()
      .filter((c) => c.inMonth)
      .reduce((a, c) => a + c.tasks.length, 0),
  );

  private go(d: Date | null): void {
    const month = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null;
    this.expanded.set(new Set());
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { month },
      queryParamsHandling: 'merge',
    });
  }

  protected setAssignee(value: string): void {
    this.expanded.set(new Set());
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { assignee: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** New tasks inherit the assignee filter, so they show up where they were added. */
  protected addTask(dueDate: string): void {
    const af = this.assigneeFilter();
    this.ui.openNewTask({
      dueDate,
      ...(af && this.store.memberMap().has(af) ? { assigneeId: af } : {}),
    });
  }

  protected prev(): void {
    const m = this.month();
    this.go(new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  protected next(): void {
    const m = this.month();
    this.go(new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
  protected today(): void {
    this.go(null);
  }

  protected visible(cell: Cell): Task[] {
    return this.expanded().has(cell.key) ? cell.tasks : cell.tasks.slice(0, MAX_VISIBLE);
  }

  protected toggle(key: string): void {
    const s = new Set(this.expanded());
    if (s.has(key)) s.delete(key);
    else s.add(key);
    this.expanded.set(s);
  }

  protected color(t: Task): string {
    return (t.projectId && this.store.projectMap().get(t.projectId)?.color) || 'var(--text-muted)';
  }

  protected dayLabel(cell: Cell): string {
    const d = new Date(`${cell.key}T00:00:00`);
    return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${cell.tasks.length} task${cell.tasks.length === 1 ? '' : 's'}`;
  }
}
