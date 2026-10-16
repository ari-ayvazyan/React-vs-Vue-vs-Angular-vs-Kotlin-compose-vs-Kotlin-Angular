import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppNotification, DateFmt } from '../core/kt';
import { StoreService } from '../core/store.service';
import { Icon } from '../shared/icon';

const TYPE_ICON: Record<string, string> = {
  assigned: 'users',
  mentioned: 'message',
  due: 'calendar',
  blocker_done: 'check',
};

/** Top-bar bell with unread badge and a dropdown panel (notification rules live in Kotlin). */
@Component({
  selector: 'app-notifications-bell',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'bell-host',
    '(document:click)': 'onDocumentClick($event)',
    // Document-level: focus may be on <body> (e.g. after "Mark all read" disables itself).
    '(document:keydown.escape)': 'onEscape($event)',
  },
  template: `
    <button
      type="button"
      class="icon-btn bell"
      data-testid="notifications-bell"
      aria-haspopup="dialog"
      aria-controls="notifications-panel"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label()"
      [title]="label()"
      (click)="toggle()"
    >
      <app-icon name="bell" />
      @if (store.ready() && store.unread() > 0) {
        <span class="bell-badge" data-testid="notifications-count" aria-hidden="true">{{ store.unread() > 99 ? '99+' : store.unread() }}</span>
      }
    </button>
    @if (open()) {
      <div class="notif-panel" id="notifications-panel" role="dialog" aria-label="Notifications" data-testid="notifications-panel">
        <header class="notif-head">
          <h2>Notifications</h2>
          <button type="button" class="btn btn-ghost btn-sm" data-testid="notifications-mark-all" [disabled]="store.unread() === 0" (click)="store.markAllNotificationsRead()">
            Mark all read
          </button>
        </header>
        @if (!store.currentUser()) {
          <p class="muted small notif-empty">Choose the current user in Settings to see notifications.</p>
        }
        <ul class="notif-list">
          @for (n of visible(); track n.id) {
            <li class="notif-item" [class.unread]="!n.read" data-testid="notification-item">
              <button type="button" class="notif-open" (click)="openTask(n)">
                <span class="notif-icon" [attr.data-type]="n.type" aria-hidden="true"><app-icon [name]="icon(n.type)" [size]="14" /></span>
                <span class="notif-body">
                  <span class="notif-text">{{ n.text }}</span>
                  <time class="muted small" [attr.datetime]="n.at" [title]="fmt.dateTime(n.at)">{{ fmt.ago(n.at, now()) }}</time>
                </span>
                @if (!n.read) {
                  <span class="sr-only">Unread</span>
                }
              </button>
              @if (!n.read) {
                <button type="button" class="icon-btn icon-btn-xs notif-read" data-testid="notification-mark-read" [attr.aria-label]="'Mark as read: ' + n.text" (click)="store.markNotificationRead(n.id)">
                  <span class="unread-dot" aria-hidden="true"></span>
                </button>
              }
            </li>
          } @empty {
            <li class="muted small notif-empty">You're all caught up.</li>
          }
        </ul>
        @if (store.notifications().length > visible().length) {
          <button type="button" class="btn btn-ghost btn-sm notif-more" (click)="limit.set(limit() + 30)">Show older</button>
        }
      </div>
    }
  `,
})
export class NotificationsBell {
  protected readonly store = inject(StoreService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly fmt = DateFmt;
  protected readonly open = signal(false);
  protected readonly limit = signal(30);
  protected readonly visible = computed(() => this.store.notifications().slice(0, this.limit()));
  protected readonly label = computed(() => {
    const n = this.store.ready() ? this.store.unread() : 0;
    return n ? `Notifications, ${n} unread` : 'Notifications';
  });
  protected readonly now = computed(() => {
    this.store.notifications();
    return DateFmt.nowIso();
  });

  protected icon(type: string): string {
    return TYPE_ICON[type] ?? 'bell';
  }

  protected toggle(): void {
    this.open.set(!this.open());
    this.limit.set(30);
  }

  protected openTask(n: AppNotification): void {
    this.store.markNotificationRead(n.id);
    this.open.set(false);
    void this.router.navigate(['/tasks', n.taskId]);
  }

  protected onDocumentClick(e: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  protected onEscape(e: Event): void {
    if (!this.open()) return;
    e.stopPropagation();
    this.open.set(false);
    this.host.nativeElement.querySelector<HTMLElement>('.bell')?.focus();
  }
}
