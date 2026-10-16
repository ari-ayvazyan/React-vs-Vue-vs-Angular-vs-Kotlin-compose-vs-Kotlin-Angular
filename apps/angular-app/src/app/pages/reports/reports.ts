import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { StoreService } from '../../services/store.service';
import { PRIORITY_LABELS } from '../../core/models';
import { burndown, cycleTimeByPriority, round1, workloadByAssignee } from '../../core/reports';
import { avatarTextColor, initials } from '../../core/members';
import { LineChart } from '../../components/line-chart';
import { HBarChart, HBarDatum } from '../../components/hbar-chart';

const PRIORITY_COLORS = {
  low: '#94a3b8',
  medium: '#3b82f6',
  high: '#f59e0b',
  urgent: '#ef4444',
} as const;
const UNASSIGNED_COLOR = '#94a3b8';

@Component({
  selector: 'app-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LineChart, HBarChart],
  templateUrl: './reports.html',
  styleUrl: './reports.css',
})
export class ReportsPage {
  protected readonly store = inject(StoreService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Burndown project ('' = all, 'none' = no project), from `?project=`. */
  protected readonly project = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('project') ?? '')),
    { initialValue: this.route.snapshot.queryParamMap.get('project') ?? '' },
  );
  protected readonly projectName = computed(() => {
    const p = this.project();
    return !p
      ? 'All projects'
      : p === 'none'
        ? 'No project'
        : (this.store.projectMap().get(p)?.name ?? 'Unknown project');
  });

  protected readonly burndown = computed(() =>
    burndown(this.store.tasks(), this.project(), this.store.now(), 30, this.store.projectSubtree()),
  );
  protected readonly burnSummary = computed(() => {
    const d = this.burndown();
    const first = d[0]?.count ?? 0;
    const last = d.at(-1)?.count ?? 0;
    return { first, last, delta: last - first };
  });

  protected readonly workload = computed(() =>
    workloadByAssignee(this.store.tasks(), this.store.members()),
  );
  protected readonly workloadBars = computed<HBarDatum[]>(() =>
    this.workload().map((w) => {
      const hours = round1(w.minutes / 60);
      const display = `${hours}h`;
      return w.member
        ? {
            id: w.member.id,
            label: w.member.name,
            value: hours,
            display,
            color: w.member.color,
            badge: { text: initials(w.member.name), fg: avatarTextColor(w.member.color) },
          }
        : {
            id: 'none',
            label: 'Unassigned',
            value: hours,
            display,
            color: UNASSIGNED_COLOR,
            badge: null,
          };
    }),
  );
  protected readonly unestimated = computed(() =>
    this.workload().reduce((n, w) => n + w.unestimated, 0),
  );

  protected readonly cycle = computed(() => cycleTimeByPriority(this.store.tasks()));
  protected readonly cycleBars = computed<HBarDatum[]>(() =>
    [...this.cycle()].reverse().map((c) => ({
      id: c.priority,
      label: `${PRIORITY_LABELS[c.priority]} (${c.count})`,
      value: c.avgDays ?? 0,
      display: c.avgDays === null ? '–' : `${c.avgDays} d`,
      color: PRIORITY_COLORS[c.priority],
    })),
  );

  protected setProject(value: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { project: value || null },
      replaceUrl: true,
    });
  }

  protected value(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }
}
