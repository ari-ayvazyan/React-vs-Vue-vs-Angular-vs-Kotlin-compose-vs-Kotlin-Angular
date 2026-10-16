<script setup lang="ts">
import type { ActivityEntry, ActivityType } from '~/lib/types';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS, filterActivity } from '~/lib/activity';
import { paginate } from '~/lib/filters';
import { dayOfTimestamp, formatDate } from '~/lib/dates';
import { useTaskStore } from '~/stores/tasks';

useHead({ title: 'Activity · TaskPilot' });

const PAGE_SIZE = 50;
const store = useTaskStore();
const route = useRoute();
const router = useRouter();
const lookups = useActivityLookups();

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const actor = computed(() => str(route.query.actor));
const type = computed<ActivityType | ''>(() => {
  const t = str(route.query.type);
  return (ACTIVITY_TYPES as readonly string[]).includes(t) ? (t as ActivityType) : '';
});
const page = computed(() => {
  const n = Number.parseInt(str(route.query.page), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
});

function update(patch: { actor?: string; type?: string; page?: number }): void {
  const next = { actor: actor.value, type: type.value, page: 1, ...patch };
  const query: Record<string, string> = {};
  if (next.actor) query.actor = next.actor;
  if (next.type) query.type = next.type;
  if (next.page > 1) query.page = String(next.page);
  void router.push({ path: '/activity', query });
}

const filtered = computed(() => filterActivity(store.activity, { actor: actor.value, type: type.value }));
const paged = computed(() => paginate(filtered.value, page.value, PAGE_SIZE));

/** Entries of the page grouped by local day (newest first). */
const groups = computed(() => {
  const out: { day: string; entries: ActivityEntry[] }[] = [];
  for (const e of paged.value.items) {
    const day = dayOfTimestamp(e.at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.entries.push(e);
    else out.push({ day, entries: [e] });
  }
  return out;
});

const dayLabel = (day: string): string => {
  if (day === store.today) return 'Today';
  return formatDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

function goPage(p: number): void {
  update({ page: p });
  if (import.meta.client) window.scrollTo({ top: 0 });
}
</script>

<template>
  <div class="page narrow">
    <div class="page-header">
      <div>
        <h1 class="page-title">Activity</h1>
        <p class="page-subtitle">
          <template v-if="store.ready">{{ filtered.length.toLocaleString('en-US') }} change{{ filtered.length === 1 ? '' : 's' }} recorded</template>
          <template v-else>Loading…</template>
        </p>
      </div>
      <div class="filters">
        <div class="field">
          <label for="act-member">Member</label>
          <select id="act-member" class="select" :value="actor" data-testid="activity-filter-member" @change="update({ actor: ($event.target as HTMLSelectElement).value })">
            <option value="">Everyone</option>
            <option v-for="m in store.members" :key="m.id" :value="m.id">{{ m.name }}</option>
            <option value="none">Unknown</option>
          </select>
        </div>
        <div class="field">
          <label for="act-type">Type</label>
          <select id="act-type" class="select" :value="type" data-testid="activity-filter-type" @change="update({ type: ($event.target as HTMLSelectElement).value })">
            <option value="">All types</option>
            <option v-for="t in ACTIVITY_TYPES" :key="t" :value="t">{{ ACTIVITY_TYPE_LABELS[t] }}</option>
          </select>
        </div>
      </div>
    </div>

    <PageLoading v-if="!store.ready" :rows="6" />
    <div v-else class="card list" data-testid="activity-list">
      <template v-if="groups.length">
        <section v-for="g in groups" :key="g.day" class="day" :aria-label="dayLabel(g.day)">
          <h2 class="day-h">{{ dayLabel(g.day) }}</h2>
          <ol class="entries">
            <li v-for="e in g.entries" :key="e.id" class="entry">
              <ActivityItem :entry="e" :lookups="lookups" show-task />
            </li>
          </ol>
        </section>
      </template>
      <div v-else class="empty">
        <p><strong>No activity{{ actor || type ? ' matches these filters' : ' yet' }}.</strong></p>
        <p>Changes to tasks – edits, status changes, comments, dependencies – are recorded here.</p>
      </div>

      <nav class="pager" aria-label="Pagination">
        <span class="muted">
          {{ paged.items.length ? (paged.page - 1) * PAGE_SIZE + 1 : 0 }}–{{ (paged.page - 1) * PAGE_SIZE + paged.items.length }}
          of {{ filtered.length.toLocaleString('en-US') }}
        </span>
        <div class="pager-btns">
          <button type="button" class="btn btn-sm" :disabled="paged.page <= 1" data-testid="activity-prev" @click="goPage(paged.page - 1)">
            <AppIcon name="chevronLeft" :size="14" />
            Prev
          </button>
          <span class="page-no" aria-current="page">Page {{ paged.page }} / {{ paged.pageCount }}</span>
          <button type="button" class="btn btn-sm" :disabled="paged.page >= paged.pageCount" data-testid="activity-next" @click="goPage(paged.page + 1)">
            Next
            <AppIcon name="chevronRight" :size="14" />
          </button>
        </div>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.narrow {
  max-width: 900px;
  margin-left: 0;
}

.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.filters .field {
  width: 180px;
}

.day {
  padding: 4px 16px 12px;
  border-bottom: 1px solid var(--border);
}

.day-h {
  position: sticky;
  top: var(--topbar-h);
  z-index: 1;
  margin: 0 -16px 8px;
  padding: 10px 16px 8px;
  font-size: 12px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-subtle);
  background: var(--surface);
}

.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
}

.pager-btns {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-no {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: var(--text-muted);
}

@media (max-width: 767px) {
  .filters {
    width: 100%;
  }

  .filters .field {
    flex: 1 1 140px;
    width: auto;
  }
}
</style>
