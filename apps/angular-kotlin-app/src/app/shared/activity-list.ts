import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivityEntry, ActivityType, DateFmt, describeActivity } from '../core/kt';
import { StoreService } from '../core/store.service';
import { Avatar } from './avatar';

/** Activity timeline; sentences are produced in Kotlin (`describeActivity`). */
@Component({
  selector: 'app-activity-list',
  imports: [RouterLink, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="timeline" [attr.aria-label]="label()">
      @for (e of entries(); track e.id) {
        <li class="timeline-item" data-testid="activity-entry" [attr.data-type]="e.type">
          <app-avatar [member]="store.member(e.actorId)" [showEmpty]="true" size="sm" />
          <div class="timeline-body">
            <p>
              <strong>{{ store.member(e.actorId)?.name ?? 'Unknown user' }}</strong>
              {{ describe(e) }}
              @if (showTask()) {
                on
                @if (store.task(e.taskId); as t) {
                  <a [routerLink]="['/tasks', t.id]">{{ t.title }}</a>
                } @else {
                  <span class="muted">{{ e.taskTitle }} (deleted)</span>
                }
              }
            </p>
            @if (e.type === commentType && e.to) {
              <blockquote class="timeline-quote">{{ e.to }}</blockquote>
            }
            <time class="muted small" [attr.datetime]="e.at" [title]="fmt.dateTime(e.at)">{{ fmt.ago(e.at, now()) }}</time>
          </div>
        </li>
      } @empty {
        <li class="muted small">No activity yet.</li>
      }
    </ol>
  `,
})
export class ActivityList {
  readonly entries = input.required<ActivityEntry[]>();
  readonly showTask = input(false);
  readonly label = input('Activity');
  protected readonly store = inject(StoreService);
  protected readonly fmt = DateFmt;
  protected readonly commentType = ActivityType.COMMENT;
  protected readonly describe = (e: ActivityEntry) => describeActivity(e);
  /** Reference time for "5 min ago" labels, refreshed whenever the list changes. */
  protected readonly now = computed(() => {
    this.entries();
    this.store.today();
    return DateFmt.nowIso();
  });
}
