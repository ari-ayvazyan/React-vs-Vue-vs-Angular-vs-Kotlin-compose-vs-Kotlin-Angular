import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BurndownChartComponent } from '../../charts/burndown-chart';
import { HBarChartComponent } from '../../charts/hbar-chart';
import { NO_PROJECT, buildBurndown, cycleTimeByPriority, workloadByAssignee } from '../../core/kt';
import { StoreService } from '../../core/store.service';
import { Skeleton } from '../../shared/skeleton';

@Component({
  selector: 'app-reports',
  imports: [BurndownChartComponent, HBarChartComponent, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports.html',
})
export class ReportsPage {
  protected readonly store = inject(StoreService);
  protected readonly NO_PROJECT = NO_PROJECT;
  protected readonly ALL = 'all';
  /** Selected project; "" until chosen = first project, "all" = every project. */
  protected readonly selected = signal('');
  protected readonly projectId = computed(() => this.selected() || this.store.projects()[0]?.id || this.ALL);
  protected readonly burndown = computed(() =>
    buildBurndown(this.store.state(), this.projectId() === this.ALL ? '' : this.projectId(), this.store.today(), 640, 240),
  );
  protected readonly workload = computed(() => workloadByAssignee(this.store.state()));
  protected readonly cycle = computed(() => cycleTimeByPriority(this.store.state()));
}
