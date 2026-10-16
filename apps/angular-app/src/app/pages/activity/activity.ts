import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { StoreService } from '../../services/store.service';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS, ActivityType } from '../../core/models';
import { ActivityQuery, queryActivity } from '../../core/activity';
import { paginate } from '../../core/filters';
import { ActivityList } from '../../components/activity-list';
import { Icon } from '../../components/icon';

export const ACTIVITY_PAGE_SIZE = 50;

function parseActivityQuery(p: Record<string, string | undefined>): ActivityQuery {
  const type = p['type'] ?? '';
  const page = parseInt(p['page'] ?? '', 10);
  return {
    actor: p['actor'] ?? '',
    type: (ACTIVITY_TYPES as string[]).includes(type) ? (type as ActivityType) : '',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

@Component({
  selector: 'app-activity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityList, Icon],
  templateUrl: './activity.html',
  styleUrl: './activity.css',
})
export class ActivityPage {
  protected readonly store = inject(StoreService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly types = ACTIVITY_TYPES;
  protected readonly typeLabels = ACTIVITY_TYPE_LABELS;

  protected readonly query = toSignal(this.route.queryParams.pipe(map(parseActivityQuery)), {
    initialValue: parseActivityQuery(this.route.snapshot.queryParams),
  });

  protected readonly filtered = computed(() => queryActivity(this.store.activity(), this.query()));
  protected readonly pageData = computed(() =>
    paginate(this.filtered(), this.query().page, ACTIVITY_PAGE_SIZE),
  );
  protected readonly rangeLabel = computed(() => {
    const total = this.filtered().length;
    if (!total) return 'No entries';
    const p = this.pageData().page;
    return `${(p - 1) * ACTIVITY_PAGE_SIZE + 1}–${Math.min(p * ACTIVITY_PAGE_SIZE, total)} of ${total}`;
  });

  private update(patch: Partial<ActivityQuery>): void {
    const next = { ...this.query(), page: 1, ...patch };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        actor: next.actor || null,
        type: next.type || null,
        page: next.page > 1 ? next.page : null,
      },
    });
  }

  protected setActor(actor: string): void {
    this.update({ actor });
  }
  protected setType(type: string): void {
    this.update({ type: type as ActivityType | '' });
  }
  protected goPage(page: number): void {
    this.update({ page });
  }
  protected value(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }
}
