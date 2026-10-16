import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StoreService } from '../services/store.service';
import { ActivityEntry } from '../core/models';
import { DescribeContext, describeActivity } from '../core/activity';
import { Avatar } from './avatar';
import { Icon } from './icon';

const TYPE_ICONS: Record<ActivityEntry['type'], string> = {
  created: 'plus',
  deleted: 'trash',
  status: 'check',
  assignee: 'users',
  dependency: 'link',
  comment: 'comment',
  field: 'edit',
};

/** Timeline of activity entries; `showTask` adds the task name (for the global /activity page). */
@Component({
  selector: 'app-activity-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Avatar, Icon],
  template: `
    <ol class="timeline">
      @for (e of entries(); track e.id) {
        <li class="entry" data-testid="activity-entry" [attr.data-type]="e.type">
          <span class="marker" [class]="'marker t-' + e.type" aria-hidden="true">
            <app-icon [name]="icon(e)" [size]="12" />
          </span>
          <app-avatar [member]="actor(e)" [size]="24" labelPrefix="" />
          <div class="text">
            <p>
              <strong>{{ actorName(e) }}</strong>
              {{ describe(e) }}
              @if (showTask()) {
                <span class="muted"> · </span>
                @if (e.type !== 'deleted' && ctx().tasks.has(e.taskId)) {
                  <a [routerLink]="['/tasks', e.taskId]">{{ e.taskTitle }}</a>
                } @else {
                  <span class="gone">{{ e.taskTitle }}</span>
                }
              }
            </p>
            <time class="muted" [attr.datetime]="e.at">{{ fmt(e.at) }}</time>
          </div>
        </li>
      } @empty {
        <li class="muted empty-log">{{ emptyText() }}</li>
      }
    </ol>
  `,
  styles: `
    :host {
      display: block;
    }
    .timeline {
      list-style: none;
      margin: 0;
      padding: 0;
      position: relative;
    }
    .entry {
      display: grid;
      grid-template-columns: 22px 24px minmax(0, 1fr);
      align-items: start;
      gap: 10px;
      padding: 8px 0;
      position: relative;
    }
    .entry:not(:last-child)::before {
      content: '';
      position: absolute;
      left: 10px;
      top: 30px;
      bottom: -8px;
      width: 2px;
      background: var(--border);
    }
    .marker {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      margin-top: 1px;
      border-radius: 50%;
      background: var(--surface-2);
      color: var(--text-muted);
    }
    .t-created {
      background: var(--success-soft);
      color: var(--success);
    }
    .t-deleted {
      background: var(--danger-soft);
      color: var(--danger);
    }
    .t-status,
    .t-comment {
      background: var(--primary-soft);
      color: var(--primary-strong);
    }
    .t-dependency {
      background: var(--warning-soft);
      color: var(--warning);
    }
    .text p {
      margin: 0;
      font-size: 0.88rem;
      overflow-wrap: anywhere;
    }
    .text time {
      font-size: 0.76rem;
    }
    .gone {
      text-decoration: line-through;
      color: var(--text-muted);
    }
    .empty-log {
      padding: 8px 0;
      font-size: 0.88rem;
    }
  `,
})
export class ActivityList {
  private readonly store = inject(StoreService);
  readonly entries = input.required<ActivityEntry[]>();
  readonly showTask = input(false);
  readonly emptyText = input('No activity yet.');

  protected readonly ctx = computed<DescribeContext>(() => ({
    members: this.store.memberMap(),
    projects: this.store.projectMap(),
    tasks: this.store.taskMap(),
  }));

  protected actor(e: ActivityEntry) {
    return e.actorId ? this.store.memberMap().get(e.actorId) : undefined;
  }

  protected actorName(e: ActivityEntry): string {
    if (!e.actorId) return 'Someone';
    return this.store.memberMap().get(e.actorId)?.name ?? 'A former member';
  }

  protected describe(e: ActivityEntry): string {
    return describeActivity(e, this.ctx());
  }

  protected icon(e: ActivityEntry): string {
    return TYPE_ICONS[e.type];
  }

  protected fmt(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
