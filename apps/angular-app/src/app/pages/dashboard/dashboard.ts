import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StoreService } from '../../services/store.service';
import { UiService } from '../../services/ui.service';
import {
  completedPerDay,
  computeKpis,
  openByAssignee,
  openByPriority,
  overdueTasks,
  productivityStreak,
  projectProgress,
  upcomingDeadlines,
} from '../../core/stats';
import { PRIORITIES, PRIORITY_LABELS } from '../../core/models';
import { MONTH_NAMES, relativeDue } from '../../core/dates';
import { LineChart } from '../../components/line-chart';
import { DonutChart, DonutSegment } from '../../components/donut-chart';
import { BarChart, BarDatum } from '../../components/bar-chart';
import { HBarChart, HBarDatum } from '../../components/hbar-chart';
import { avatarTextColor, initials } from '../../core/members';
import { Icon } from '../../components/icon';

const PRIORITY_COLORS = {
  low: '#94a3b8',
  medium: '#3b82f6',
  high: '#f59e0b',
  urgent: '#ef4444',
} as const;
const UNASSIGNED_COLOR = '#94a3b8';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LineChart, DonutChart, BarChart, HBarChart, Icon],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardPage {
  protected readonly store = inject(StoreService);
  protected readonly ui = inject(UiService);

  protected readonly kpis = computed(() => computeKpis(this.store.tasks(), this.store.now()));
  protected readonly perDay = computed(() =>
    completedPerDay(this.store.tasks(), this.store.now(), 30),
  );
  protected readonly completed30 = computed(() => this.perDay().reduce((a, d) => a + d.count, 0));
  protected readonly streak = computed(() =>
    productivityStreak(this.store.tasks(), this.store.now()),
  );
  protected readonly upcoming = computed(() =>
    upcomingDeadlines(this.store.tasks(), this.store.now(), 7, 8),
  );
  protected readonly overdue = computed(() =>
    overdueTasks(this.store.tasks(), this.store.now(), 8),
  );
  protected readonly prioritySegments = computed<DonutSegment[]>(() => {
    const c = openByPriority(this.store.tasks());
    return [...PRIORITIES]
      .reverse()
      .map((p) => ({ label: PRIORITY_LABELS[p], value: c[p], color: PRIORITY_COLORS[p] }));
  });
  protected readonly projectBars = computed<BarDatum[]>(() =>
    // top-level projects only; their numbers include all sub-projects
    projectProgress(this.store.tasks(), this.store.projects(), this.store.projectSubtree())
      .filter((p) => !p.project.parentId || !this.store.projectMap().has(p.project.parentId))
      .map((p) => ({
        id: p.project.id,
        label: p.project.name,
        percent: p.percent,
        color: p.project.color,
        detail: `${p.done} of ${p.total} done`,
      })),
  );
  protected readonly assigneeBars = computed<HBarDatum[]>(() =>
    openByAssignee(this.store.tasks(), this.store.members()).map(({ member, count }) =>
      member
        ? {
            id: member.id,
            label: member.name,
            value: count,
            color: member.color,
            badge: { text: initials(member.name), fg: avatarTextColor(member.color) },
          }
        : { id: 'none', label: 'Unassigned', value: count, color: UNASSIGNED_COLOR, badge: null },
    ),
  );
  protected readonly greeting = computed(() => {
    const h = this.store.now().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  });
  protected readonly dateLabel = computed(() => {
    const d = this.store.now();
    return `${WEEKDAYS[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
  });

  protected due(key: string): string {
    return relativeDue(key, this.store.today());
  }

  protected projectOf(id: string | null) {
    return id ? this.store.projectMap().get(id) : undefined;
  }
}
