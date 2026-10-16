<script setup lang="ts">
import type { AppNotification } from '~/lib/types';
import type { IconName } from '~/lib/icons';
import { describeNotification } from '~/lib/notifications';
import { formatDateTime, formatRelativeTime } from '~/lib/dates';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

const store = useTaskStore();
const ui = useUiStore();
const lookups = useActivityLookups();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const bell = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const LIMIT = 50;
const shown = computed(() => store.myNotifications.slice(0, LIMIT));
const ICONS: Record<AppNotification['type'], IconName> = { assigned: 'users', mentioned: 'message', due: 'clock', unblocked: 'lock' };

const text = (n: AppNotification): string =>
  describeNotification(n, store.today, { members: store.memberById, taskTitle: (id) => lookups.value.taskTitle(id) ?? 'a deleted task' });

async function toggle(): Promise<void> {
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    // first notification if there is one, otherwise the heading
    (panel.value?.querySelector<HTMLElement>('.item') ?? panel.value?.querySelector<HTMLElement>('h2'))?.focus();
  }
}

function close(returnFocus = true): void {
  if (!open.value) return;
  open.value = false;
  if (returnFocus) bell.value?.focus();
}

function activate(n: AppNotification): void {
  store.markNotificationRead(n.id);
  close(false);
  if (store.taskById.has(n.taskId)) void navigateTo(`/tasks/${n.taskId}`);
  else ui.toast('That task has been deleted.', { kind: 'error', duration: 3000 });
}

function onDocPointer(e: PointerEvent): void {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close(false);
}

function onKeydown(e: KeyboardEvent): void {
  if (!open.value) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...(panel.value?.querySelectorAll<HTMLElement>('.item') ?? [])];
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
  items[next]?.focus();
}

onMounted(() => document.addEventListener('pointerdown', onDocPointer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer));
const route = useRoute();
watch(
  () => route.fullPath,
  () => close(false),
);
</script>

<template>
  <div ref="root" class="notif" @keydown="onKeydown">
    <button
      ref="bell"
      type="button"
      class="btn btn-ghost btn-icon bell"
      :aria-label="store.unreadCount ? `Notifications, ${store.unreadCount} unread` : 'Notifications'"
      :aria-expanded="open"
      aria-controls="notifications-panel"
      aria-haspopup="dialog"
      data-testid="notifications-bell"
      @click="toggle"
    >
      <AppIcon name="bell" />
      <span v-if="store.ready && store.unreadCount" class="count" aria-hidden="true" data-testid="notifications-count">{{ store.unreadCount > 99 ? '99+' : store.unreadCount }}</span>
    </button>

    <div v-if="open" id="notifications-panel" ref="panel" class="panel" role="dialog" aria-modal="false" aria-labelledby="notifications-title" data-testid="notifications-panel">
      <div class="head">
        <h2 id="notifications-title" tabindex="-1">Notifications</h2>
        <button v-if="store.unreadCount" type="button" class="btn btn-ghost btn-sm mark-all" data-testid="notifications-mark-all" @click="store.markAllNotificationsRead()">
          <AppIcon name="check" :size="14" />
          Mark all as read
        </button>
      </div>
      <p v-if="!store.currentUser" class="empty-note">
        Choose who you are under <NuxtLink to="/settings#team">Settings → Team members</NuxtLink> to get notifications.
      </p>
      <ul v-else-if="shown.length" class="list">
        <li v-for="n in shown" :key="n.id" class="row" :class="{ unread: !n.read }" data-testid="notification">
          <button type="button" class="item" @click="activate(n)">
            <span class="icon" :class="`t-${n.type}`" aria-hidden="true"><AppIcon :name="ICONS[n.type]" :size="14" /></span>
            <span class="body">
              <span class="msg">{{ text(n) }}</span>
              <time class="when" :datetime="n.at" :title="formatDateTime(n.at)">{{ formatRelativeTime(n.at) }}</time>
            </span>
            <span v-if="!n.read" class="sr-only">(unread)</span>
          </button>
          <button
            v-if="!n.read"
            type="button"
            class="dot-btn"
            :aria-label="`Mark as read: ${text(n)}`"
            title="Mark as read"
            data-testid="notification-mark-read"
            @click="store.markNotificationRead(n.id)"
          >
            <span class="dot" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <p v-else class="empty-note">You’re all caught up.</p>
      <p v-if="store.myNotifications.length > LIMIT" class="more muted">Showing the latest {{ LIMIT }} of {{ store.myNotifications.length }}.</p>
    </div>
  </div>
</template>

<style scoped>
.notif {
  position: relative;
}

.bell {
  position: relative;
}

.count {
  position: absolute;
  top: 2px;
  right: 1px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--danger);
  color: #fff;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 2px var(--bg);
}

:root[data-theme='dark'] .count {
  color: #1a0b0e;
}

.panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: min(380px, calc(100vw - 24px));
  max-height: min(520px, calc(100vh - var(--topbar-h) - 24px));
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  z-index: 60;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--border);
}

.head h2 {
  font-size: 14px;
  margin: 0;
}

.list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
}

.row {
  display: flex;
  align-items: flex-start;
  border-radius: 8px;
}

.row.unread {
  background: color-mix(in srgb, var(--accent-soft) 70%, transparent);
}

.item {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font: inherit;
}

.item:hover {
  background: var(--surface-hover);
}

.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text-muted);
}

.t-assigned,
.t-mentioned {
  color: var(--accent-text);
}

.t-due {
  color: var(--danger);
}

.t-unblocked {
  color: var(--success);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.msg {
  font-size: 13px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.row.unread .msg {
  font-weight: 600;
}

.when {
  font-size: 12px;
  color: var(--text-subtle);
}

.dot-btn {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin: 8px 4px 0 0;
  border: 0;
  border-radius: 6px;
  background: none;
  cursor: pointer;
}

.dot-btn:hover {
  background: var(--surface-hover);
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent);
}

.empty-note {
  margin: 0;
  padding: 24px 16px;
  text-align: center;
  color: var(--text-muted);
}

@media (max-width: 767px) {
  .panel {
    position: fixed;
    left: 12px;
    right: 12px;
    top: calc(var(--topbar-h) + 4px);
    width: auto;
  }
}

.more {
  margin: 0;
  padding: 8px 16px;
  font-size: 12px;
  border-top: 1px solid var(--border);
}
</style>
