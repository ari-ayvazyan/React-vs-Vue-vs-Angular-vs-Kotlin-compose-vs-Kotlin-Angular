import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { StoreService } from '../services/store.service';
import { AppNotification } from '../core/models';
import { describeNotification } from '../core/notifications';
import { Icon } from './icon';

const ICONS: Record<AppNotification['type'], string> = {
  assigned: 'users',
  mentioned: 'comment',
  due: 'clock',
  overdue: 'alert',
  unblocked: 'link',
};
const MAX_SHOWN = 50;

/** Top-bar bell with the current user's unread count and a dropdown panel. */
@Component({
  selector: 'app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  host: {
    class: 'bell-host',
    '(document:pointerdown)': 'onDocPointer($event)',
    '(document:keydown.escape)': 'onEscape($event)',
  },
  template: `
    <button
      #bell
      type="button"
      class="icon-btn bell"
      data-testid="notifications-bell"
      aria-haspopup="true"
      [attr.aria-expanded]="open()"
      aria-controls="notifications-panel"
      [attr.aria-label]="label()"
      [title]="label()"
      (click)="toggle()"
    >
      <app-icon name="bell" />
      @if (store.ready() && store.unreadCount()) {
        <span class="badge-count" data-testid="notifications-count" aria-hidden="true">{{
          store.unreadCount() > 99 ? '99+' : store.unreadCount()
        }}</span>
      }
    </button>
    @if (open()) {
      <section
        #panel
        id="notifications-panel"
        class="panel"
        role="dialog"
        aria-labelledby="notifications-title"
        data-testid="notifications-panel"
      >
        <header class="panel-head">
          <h2 id="notifications-title">Notifications</h2>
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            data-testid="notifications-read-all"
            [disabled]="!store.unreadCount()"
            (click)="store.markAllNotificationsRead()"
          >
            Mark all as read
          </button>
        </header>
        @if (!store.currentUser()) {
          <p class="empty">
            Choose a
            <a routerLink="/settings" fragment="current-user" (click)="close(false)"
              >current user</a
            >
            in Settings to get notifications.
          </p>
        } @else {
          <ul class="list" role="list">
            @for (n of shown(); track n.id) {
              <li class="item" [class.unread]="!n.read" data-testid="notification">
                <button
                  type="button"
                  class="item-main"
                  data-testid="notification-open"
                  (click)="openTask(n)"
                >
                  <span class="type" [class]="'type t-' + n.type" aria-hidden="true">
                    <app-icon [name]="icon(n)" [size]="14" />
                  </span>
                  <span class="text">
                    <strong>{{ describe(n).title }}</strong>
                    <span class="detail">{{ describe(n).detail }}</span>
                    <time class="muted" [attr.datetime]="n.at">{{ fmt(n.at) }}</time>
                  </span>
                  @if (!n.read) {
                    <span class="sr-only">(unread)</span>
                  }
                </button>
                @if (!n.read) {
                  <button
                    type="button"
                    class="mark"
                    data-testid="notification-mark-read"
                    [attr.aria-label]="'Mark as read: ' + describe(n).title"
                    title="Mark as read"
                    (click)="markRead(n, $event)"
                  >
                    <span class="dot" aria-hidden="true"></span>
                  </button>
                }
              </li>
            } @empty {
              <li class="empty">You're all caught up.</li>
            }
          </ul>
          @if (store.myNotifications().length > shown().length) {
            <p class="more muted">Showing the latest {{ shown().length }}.</p>
          }
        }
      </section>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
    }
    .bell {
      position: relative;
    }
    .badge-count {
      position: absolute;
      top: 2px;
      right: 2px;
      min-width: 17px;
      height: 17px;
      padding: 0 4px;
      border-radius: 999px;
      background: var(--danger);
      color: #fff;
      font-size: 0.66rem;
      font-weight: 700;
      line-height: 17px;
      text-align: center;
      pointer-events: none;
    }
    .panel {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 80;
      width: min(380px, calc(100vw - 24px));
      max-height: min(520px, calc(100dvh - 90px));
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }
    /* on phones the bell is not at the screen edge: pin the panel to the viewport */
    @media (max-width: 600px) {
      .panel {
        position: fixed;
        top: 60px;
        left: 12px;
        right: 12px;
        width: auto;
      }
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px 10px 16px;
      border-bottom: 1px solid var(--border);
    }
    .panel-head h2 {
      margin: 0;
      font-size: 0.95rem;
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 4px;
      overflow-y: auto;
    }
    .item {
      position: relative;
      display: flex;
      align-items: stretch;
      border-radius: var(--radius-sm);
    }
    .item:hover {
      background: var(--hover);
    }
    .item.unread {
      background: color-mix(in srgb, var(--primary-soft) 70%, transparent);
    }
    .item-main {
      flex: 1;
      min-width: 0;
      display: flex;
      gap: 10px;
      padding: 10px 8px 10px 10px;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      border-radius: var(--radius-sm);
    }
    .type {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      flex-shrink: 0;
      border-radius: 50%;
      background: var(--surface-2);
      color: var(--text-muted);
    }
    .t-overdue {
      background: var(--danger-soft);
      color: var(--danger);
    }
    .t-due {
      background: var(--warning-soft);
      color: var(--warning);
    }
    .t-mentioned,
    .t-assigned {
      background: var(--primary-soft);
      color: var(--primary-strong);
    }
    .t-unblocked {
      background: var(--success-soft);
      color: var(--success);
    }
    .text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
      font-size: 0.85rem;
    }
    .detail {
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      color: var(--text);
    }
    time {
      font-size: 0.74rem;
    }
    .mark {
      width: 32px;
      flex-shrink: 0;
      display: grid;
      place-items: center;
      border: 0;
      background: transparent;
      cursor: pointer;
      border-radius: var(--radius-sm);
    }
    .mark .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--primary);
    }
    .mark:hover .dot {
      box-shadow: 0 0 0 4px var(--primary-soft);
    }
    .empty {
      padding: 20px 16px;
      color: var(--text-muted);
      font-size: 0.88rem;
      text-align: center;
    }
    .more {
      margin: 0;
      padding: 8px 16px;
      font-size: 0.78rem;
      border-top: 1px solid var(--border);
    }
  `,
})
export class NotificationBell {
  protected readonly store = inject(StoreService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly bell = viewChild.required<ElementRef<HTMLButtonElement>>('bell');

  protected readonly open = signal(false);
  protected readonly shown = computed(() => this.store.myNotifications().slice(0, MAX_SHOWN));
  protected readonly label = computed(() => {
    const n = this.store.ready() ? this.store.unreadCount() : 0;
    return n ? `Notifications, ${n} unread` : 'Notifications';
  });

  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.open.set(true);
  }

  close(restoreFocus: boolean): void {
    this.open.set(false);
    if (restoreFocus) this.bell().nativeElement.focus();
  }

  protected onDocPointer(e: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.close(false);
  }

  protected onEscape(e: Event): void {
    if (!this.open()) return;
    e.stopPropagation();
    this.close(true);
  }

  /** The mark-read button disappears once read, so move focus to the item itself. */
  protected markRead(n: AppNotification, e: Event): void {
    const item = (e.currentTarget as HTMLElement).closest('li');
    this.store.markNotificationRead(n.id);
    item?.querySelector<HTMLElement>('[data-testid="notification-open"]')?.focus();
  }

  protected openTask(n: AppNotification): void {
    this.store.markNotificationRead(n.id);
    this.close(false);
    void this.router.navigate(['/tasks', n.taskId]);
  }

  protected describe(n: AppNotification) {
    return describeNotification(n, this.store.memberMap());
  }

  protected icon(n: AppNotification): string {
    return ICONS[n.type];
  }

  protected fmt(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
