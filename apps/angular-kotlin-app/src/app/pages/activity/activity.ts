import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ActivityQueries, ActivityQuery, ActivityType, queryActivity } from '../../core/kt';
import { StoreService } from '../../core/store.service';
import { injectQueryString } from '../../core/url-query';
import { ActivityList } from '../../shared/activity-list';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';

/** Global activity log: newest first, filter by member and type (URL-synced), 50 per page. */
@Component({
  selector: 'app-activity',
  imports: [ActivityList, Icon, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './activity.html',
})
export class ActivityPage {
  protected readonly store = inject(StoreService);
  private readonly router = inject(Router);
  private readonly queryString = injectQueryString();
  protected readonly types = ActivityType.all;
  protected readonly typeLabel = (t: string) => ActivityType.label(t);
  protected readonly query = computed(() => ActivityQueries.parse(this.queryString()));
  protected readonly result = computed(() => queryActivity(this.store.activity(), this.query(), ActivityQueries.PAGE_SIZE));

  protected apply(q: ActivityQuery): void {
    const qs = q.toQueryString();
    void this.router.navigateByUrl('/activity' + (qs ? '?' + qs : ''));
  }
}
