'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { formatDateTime } from '@/lib/dates';
import { inbox, notificationText, unreadCount } from '@/lib/notifications';
import type { Notification, NotificationType } from '@/lib/types';
import { IconAlert, IconAt, IconBell, IconCheck, IconClock, IconUnlock, IconUserPlus } from './icons';
import { getStore, useStoreSnapshot, useToday } from './store-hooks';
import styles from './notifications.module.css';

const PAGE = 50;

const TYPE_ICON: Record<NotificationType, typeof IconBell> = {
  assigned: IconUserPlus,
  mentioned: IconAt,
  due: IconClock,
  overdue: IconAlert,
  unblocked: IconUnlock,
};

/** Top-bar bell with unread count and a panel listing the current user's notifications. */
export function NotificationsBell() {
  const snap = useStoreSnapshot();
  const today = useToday();
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const state = snap?.state;
  const members = state?.members;
  const settingsUser = state?.settings.currentUserId ?? null;
  const userId = settingsUser && members?.some((m) => m.id === settingsUser) ? settingsUser : null;
  const tasks = state?.tasks;

  // Due/overdue reminders: re-evaluated when the day, the tasks or the current user change (idempotent per task per day).
  useEffect(() => {
    if (tasks && today && userId) getStore().syncDueNotifications(today);
  }, [tasks, today, userId]);

  // Close on outside click, and on Escape wherever focus is (e.g. after a focused button unmounted).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return;
      setOpen(false);
      bellRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!state) {
    return (
      <button type="button" className={`icon-btn ${styles.bell}`} aria-label="Notifications" data-testid="notifications-bell" disabled>
        <IconBell />
      </button>
    );
  }

  const list = inbox(state.notifications, userId);
  const unread = unreadCount(state.notifications, userId);
  const taskIds = new Set(state.tasks.map((t) => t.id));
  const memberName = (id: string | null) => (id ? (state.members.find((m) => m.id === id)?.name ?? 'Someone') : null);

  const close = (focusBell: boolean) => {
    setOpen(false);
    if (focusBell) bellRef.current?.focus();
  };
  const openItem = (n: Notification) => {
    if (!n.read) getStore().markNotificationsRead([n.id]);
    if (!taskIds.has(n.taskId)) return;
    close(false);
    router.push(`/tasks/${n.taskId}`);
  };
  /** Marks read, keeping keyboard focus inside the panel (the clicked button disappears or is disabled). */
  const markRead = (ids: string[] | 'all') => {
    getStore().markNotificationsRead(ids);
    panelRef.current?.focus();
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={bellRef}
        type="button"
        className={`icon-btn ${styles.bell}`}
        onClick={() => {
          setLimit(PAGE);
          setOpen((o) => !o);
        }}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls={`${uid}-panel`}
        title="Notifications"
        data-testid="notifications-bell"
      >
        <IconBell />
        {unread > 0 && (
          <span className={styles.badge} data-testid="notifications-count" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id={`${uid}-panel`}
          ref={panelRef}
          className={styles.panel}
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          data-testid="notifications-panel"
        >
          <div className={styles.head}>
            <h2 className={styles.title}>Notifications</h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!unread}
              onClick={() => markRead('all')}
              data-testid="notifications-mark-all"
            >
              <IconCheck size={14} /> Mark all as read
            </button>
          </div>
          {!userId ? (
            <p className={styles.empty}>Choose who you are under Settings → Current user to receive notifications.</p>
          ) : list.length ? (
            <ul className={styles.list}>
              {list.slice(0, limit).map((n) => {
                const Icon = TYPE_ICON[n.type];
                const actor = memberName(n.actorId);
                const exists = taskIds.has(n.taskId);
                return (
                  <li key={n.id} className={`${styles.item} ${n.read ? '' : styles.unread}`} data-testid="notification-item" data-read={n.read}>
                    <button type="button" className={styles.main} onClick={() => openItem(n)} aria-disabled={!exists}>
                      <span className={`${styles.icon} ${styles[`icon_${n.type}`]}`} aria-hidden="true">
                        <Icon size={15} />
                      </span>
                      <span className={styles.body}>
                        <span className={styles.text}>
                          {actor && n.type !== 'due' && n.type !== 'overdue' && <strong>{actor} </strong>}
                          {notificationText(n, today)}
                          {!exists && <span className={styles.gone}> (task deleted)</span>}
                        </span>
                        {n.type === 'mentioned' && n.detail && <span className={styles.snippet}>{n.detail}</span>}
                        <time className={styles.time} dateTime={n.at}>
                          {formatDateTime(n.at)}
                        </time>
                      </span>
                      {!n.read && <span className="sr-only">(unread)</span>}
                    </button>
                    {!n.read && (
                      <button
                        type="button"
                        className={`icon-btn icon-btn-sm ${styles.markOne}`}
                        onClick={() => markRead([n.id])}
                        aria-label="Mark as read"
                        title="Mark as read"
                        data-testid="notification-mark-read"
                      >
                        <span className={styles.dot} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.empty}>You’re all caught up.</p>
          )}
          {list.length > limit && (
            <button type="button" className={`btn btn-ghost btn-sm ${styles.more}`} onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({list.length - limit})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
