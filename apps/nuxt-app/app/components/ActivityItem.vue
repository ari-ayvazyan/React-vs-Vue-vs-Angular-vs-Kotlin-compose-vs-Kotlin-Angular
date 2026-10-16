<script setup lang="ts">
import type { ActivityEntry } from '~/lib/types';
import type { ActivityLookups } from '~/lib/activity';
import { describeActivity } from '~/lib/activity';
import { formatDateTime, formatRelativeTime } from '~/lib/dates';
import { useTaskStore } from '~/stores/tasks';

const props = withDefaults(defineProps<{ entry: ActivityEntry; lookups: ActivityLookups; showTask?: boolean }>(), { showTask: false });
const store = useTaskStore();

const actor = computed(() => (props.entry.actorId ? (props.lookups.members.get(props.entry.actorId)?.name ?? 'Former member') : 'Someone'));
const d = computed(() => describeActivity(props.entry, props.lookups));
const taskExists = computed(() => store.taskById.has(props.entry.taskId));
const title = computed(() => props.lookups.taskTitle(props.entry.taskId) ?? 'a deleted task');
const ICONS = { created: 'plus', deleted: 'trash', status: 'check', assignee: 'users', dependencies: 'lock', comment: 'message', updated: 'edit' } as const;
</script>

<template>
  <div class="item" data-testid="activity-entry" :data-type="entry.type">
    <span class="icon" :class="`t-${entry.type}`" aria-hidden="true"><AppIcon :name="ICONS[entry.type]" :size="13" /></span>
    <div class="main">
      <p class="line">
        <strong>{{ actor }}</strong> {{ showTask ? d.actionOnTask : d.action }}
        <template v-if="showTask">
          <NuxtLink v-if="taskExists" :to="`/tasks/${entry.taskId}`" class="task">{{ title }}</NuxtLink>
          <span v-else class="task gone">{{ title }}</span>
        </template>
      </p>
      <p v-if="d.from !== undefined || d.to !== undefined" class="change">
        <template v-if="d.from !== undefined && d.to !== undefined">
          <span class="from">{{ d.from }}</span>
          <span class="arrow" aria-label="changed to">→</span>
          <span class="to">{{ d.to }}</span>
        </template>
        <span v-else-if="d.to !== undefined" class="quote">{{ d.to }}</span>
        <span v-else class="quote from">{{ d.from }}</span>
      </p>
      <time class="when" :datetime="entry.at" :title="formatDateTime(entry.at)">{{ formatRelativeTime(entry.at) }}</time>
    </div>
  </div>
</template>

<style scoped>
.item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-width: 0;
}

.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text-muted);
  border: 1px solid var(--border);
}

.t-created {
  color: var(--success);
}

.t-deleted {
  color: var(--danger);
}

.t-status {
  color: var(--s-done);
}

.t-comment,
.t-assignee {
  color: var(--accent-text);
}

.t-dependencies {
  color: var(--warning);
}

.main {
  flex: 1;
  min-width: 0;
}

.line {
  margin: 0;
  overflow-wrap: anywhere;
}

.task {
  font-weight: 600;
}

.gone {
  color: var(--text-subtle);
  text-decoration: line-through;
}

.change {
  margin: 3px 0 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
}

.from,
.to,
.quote {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--surface-2);
  overflow-wrap: anywhere;
  max-width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.from {
  color: var(--text-muted);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--text-muted) 50%, transparent);
}

.quote {
  text-decoration: none;
}

.quote.from {
  text-decoration: line-through;
}

.arrow {
  color: var(--text-subtle);
}

.when {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-subtle);
}
</style>
