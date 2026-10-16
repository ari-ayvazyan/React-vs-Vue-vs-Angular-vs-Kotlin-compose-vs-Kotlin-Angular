import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DonutChartComponent } from '../../charts/donut-chart';
import { LineChartComponent } from '../../charts/line-chart';
import { ProjectBarsComponent } from '../../charts/project-bars';
import { AssigneeBarsComponent } from '../../charts/assignee-bars';
import { DateFmt, Priority, computeDashboardStats } from '../../core/kt';
import { StoreService } from '../../core/store.service';
import { Skeleton } from '../../shared/skeleton';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, LineChartComponent, DonutChartComponent, ProjectBarsComponent, AssigneeBarsComponent, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
})
export class DashboardPage {
  protected readonly store = inject(StoreService);
  protected readonly stats = computed(() => computeDashboardStats(this.store.state(), this.store.today()));
  protected readonly fmt = DateFmt;
  protected readonly priorityLabel = (p: string) => Priority.label(p);
  protected readonly projectName = (id: string | null | undefined) => (id ? (this.store.projectMap().get(id)?.name ?? '') : '');
}
