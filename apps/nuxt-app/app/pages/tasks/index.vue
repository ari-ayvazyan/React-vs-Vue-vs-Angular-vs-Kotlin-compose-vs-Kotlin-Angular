<script setup lang="ts">
import type { Priority, Status, Task, WorkflowStatus } from '~/lib/types';
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from '~/lib/types';
import { DEFAULT_QUERY, DUE_OPTIONS, SORT_OPTIONS, filterTasks, isOverdue, paginate, parseTaskQuery, serializeTaskQuery, sortTasks } from '~/lib/filters';
import type { TaskQuery } from '~/lib/filters';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';
import { tasksToCsv } from '~/lib/csv';

useHead({ title: 'Tasks · TaskPilot' });

const store = useTaskStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const query = computed(() => parseTaskQuery(route.query as Record<string, string>));

function update(patch: Partial<TaskQuery>, opts: { replace?: boolean } = {}): void {
  const next: TaskQuery = { ...query.value, page: 1, ...patch };
  const location = { path: '/tasks', query: serializeTaskQuery(next) };
  void (opts.replace ? router.replace(location) : router.push(location));
}

// ----- debounced search (200ms) -----
const searchText = ref(query.value.q);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchText, (v) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (v !== query.value.q) update({ q: v }, { replace: true });
  }, 200);
});
watch(
  () => query.value.q,
  (q) => {
    if (q !== searchText.value) searchText.value = q;
  },
);
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

// ----- data pipeline -----
const filtered = computed(() => filterTasks(store.tasks, query.value, store.today, store.projectScope));
const sorted = computed(() => sortTasks(filtered.value, query.value.sort, query.value.dir));
const paged = computed(() => paginate(sorted.value, query.value.page, store.settings.pageSize));

const activeFilterCount = computed(() => {
  const q = query.value;
  return q.status.length + q.priority.length + (q.project ? 1 : 0) + (q.assignee ? 1 : 0) + (q.tag ? 1 : 0) + (q.due !== 'all' ? 1 : 0) + (q.q ? 1 : 0);
});

function toggleIn<T extends string>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function toggleStatus(s: Status): void {
  update({ status: toggleIn(query.value.status, s) });
}

function togglePriority(p: Priority): void {
  update({ priority: toggleIn(query.value.priority, p) });
}

function clearFilters(): void {
  searchText.value = '';
  void router.push({ path: '/tasks', query: serializeTaskQuery({ ...DEFAULT_QUERY, sort: query.value.sort, dir: query.value.dir }) });
}

function onSelect(key: 'project' | 'assignee' | 'tag' | 'due' | 'sort', e: Event): void {
  const value = (e.target as HTMLSelectElement).value;
  update({ [key]: value } as Partial<TaskQuery>);
}

function goPage(p: number): void {
  update({ page: p });
  if (import.meta.client) window.scrollTo({ top: 0 });
}

// ----- selection & bulk actions -----
const selected = ref<Set<string>>(new Set());
const pageIds = computed(() => paged.value.items.map((t) => t.id));
const allOnPageSelected = computed(() => pageIds.value.length > 0 && pageIds.value.every((id) => selected.value.has(id)));
const someOnPageSelected = computed(() => pageIds.value.some((id) => selected.value.has(id)));

// Drop selections that no longer exist (e.g. after delete/undo).
watch(
  () => store.tasks,
  () => {
    const ids = store.taskById;
    if ([...selected.value].some((id) => !ids.has(id))) selected.value = new Set([...selected.value].filter((id) => ids.has(id)));
  },
);

function toggleSelect(id: string): void {
  const s = new Set(selected.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  selected.value = s;
}

function toggleSelectAll(): void {
  const s = new Set(selected.value);
  if (allOnPageSelected.value) pageIds.value.forEach((id) => s.delete(id));
  else pageIds.value.forEach((id) => s.add(id));
  selected.value = s;
}

function bulkDone(): void {
  const ids = [...selected.value];
  // blocked tasks are skipped by the store, which also reports them
  const n = store.setStatus(ids, 'done');
  if (n) ui.toast(`Marked ${n} task${n === 1 ? '' : 's'} as done`, { kind: 'success', actionLabel: 'Undo', action: () => store.undo() });
  selected.value = new Set();
}

function bulkDelete(): void {
  const ids = [...selected.value];
  const n = store.deleteTasks(ids);
  ui.toast(`Deleted ${n} task${n === 1 ? '' : 's'}`, { actionLabel: 'Undo', action: () => store.undo() });
  selected.value = new Set();
}

const moveTarget = ref('');
function bulkMove(): void {
  if (!moveTarget.value) return;
  const ids = [...selected.value];
  const pid = moveTarget.value === 'none' ? null : moveTarget.value;
  store.moveToProject(ids, pid);
  const name = pid ? store.projectById.get(pid)?.name : 'No project';
  ui.toast(`Moved ${ids.length} task${ids.length === 1 ? '' : 's'} to ${name}`, { actionLabel: 'Undo', action: () => store.undo() });
  moveTarget.value = '';
  selected.value = new Set();
}

function toggleDone(id: string): void {
  store.toggleDone(id);
}

const showFilters = ref(false);

/**
 * Status shown under the title: any status of a custom workflow, and "In progress" for the default one
 * (to-do and done are already visible from the checkbox).
 */
function statusPill(t: Task): WorkflowStatus | undefined {
  const s = store.workflows.statusOf(t.projectId, t.statusId);
  if (!s) return undefined;
  return s.id === 'todo' || s.id === 'done' ? undefined : s;
}

/** Export exactly the filtered + sorted list (all pages) as CSV. */
function exportCsv(): void {
  const csv = tasksToCsv(sorted.value, {
    projects: store.projectById,
    members: store.memberById,
    tasks: store.taskById,
    statusName: (t) => store.workflows.statusOf(t.projectId, t.statusId)?.name ?? t.statusId,
  });
  // BOM so spreadsheet apps detect UTF-8
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `taskpilot-tasks-${store.today}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const n = sorted.value.length;
  ui.toast(`Exported ${n} task${n === 1 ? '' : 's'} to CSV`, { kind: 'success', duration: 3000 });
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">Tasks</h1>
        <p class="page-subtitle">
          <template v-if="store.ready">{{ filtered.length.toLocaleString('en-US') }} of {{ store.tasks.length.toLocaleString('en-US') }} tasks</template>
          <template v-else>Loading…</template>
        </p>
      </div>
      <div class="head-actions">
        <button type="button" class="btn" :disabled="!store.ready || !sorted.length" data-testid="export-csv" @click="exportCsv">
          <AppIcon name="download" :size="16" />
          Export CSV
        </button>
        <button type="button" class="btn btn-primary" @click="ui.openNewTask()">
          <AppIcon name="plus" :size="16" />
          New task
        </button>
      </div>
    </div>

    <div class="card toolbar">
      <TaskViewBar v-if="store.ready" :query="query" />
      <div class="toolbar-row">
        <div class="search">
          <AppIcon name="search" :size="16" class="search-icon" />
          <label for="task-search" class="sr-only">Search title, description and tags</label>
          <input
            id="task-search"
            v-model="searchText"
            type="search"
            class="input search-input"
            placeholder="Search title, description, tags…"
            data-testid="task-list-search"
            autocomplete="off"
          >
        </div>
        <div class="sort">
          <label for="sort-by" class="sr-only">Sort by</label>
          <select id="sort-by" class="select" :value="query.sort" @change="onSelect('sort', $event)">
            <option v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value">Sort: {{ o.label }}</option>
          </select>
          <button
            type="button"
            class="btn btn-icon"
            :aria-label="`Sort direction: ${query.dir === 'asc' ? 'ascending' : 'descending'}. Click to toggle.`"
            :title="query.dir === 'asc' ? 'Ascending' : 'Descending'"
            @click="update({ dir: query.dir === 'asc' ? 'desc' : 'asc' })"
          >
            <span class="dir" :class="query.dir" aria-hidden="true">↑</span>
          </button>
        </div>
        <button type="button" class="btn filters-toggle" :aria-expanded="showFilters" aria-controls="task-filters" @click="showFilters = !showFilters">
          <AppIcon name="filter" :size="16" />
          Filters<span v-if="activeFilterCount" class="count">{{ activeFilterCount }}</span>
        </button>
      </div>

      <div id="task-filters" class="filters" :class="{ open: showFilters }">
        <fieldset class="group">
          <legend class="label">Status</legend>
          <div class="chips">
            <button
              v-for="s in STATUSES"
              :key="s"
              type="button"
              class="fchip"
              :class="{ on: query.status.includes(s) }"
              :aria-pressed="query.status.includes(s)"
              @click="toggleStatus(s)"
            >
              <span class="dot" :style="{ background: `var(--s-${s})` }" aria-hidden="true" />{{ STATUS_LABELS[s] }}
            </button>
          </div>
        </fieldset>
        <fieldset class="group">
          <legend class="label">Priority</legend>
          <div class="chips">
            <button
              v-for="p in PRIORITIES"
              :key="p"
              type="button"
              class="fchip"
              :class="{ on: query.priority.includes(p) }"
              :aria-pressed="query.priority.includes(p)"
              @click="togglePriority(p)"
            >
              <span class="dot" :style="{ background: `var(--p-${p})` }" aria-hidden="true" />{{ PRIORITY_LABELS[p] }}
            </button>
          </div>
        </fieldset>
        <div class="field small-field">
          <label for="f-project">Project</label>
          <select id="f-project" class="select" :value="query.project" @change="onSelect('project', $event)">
            <option value="">All projects</option>
            <option value="none">No project</option>
            <option v-for="p in store.projectOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <div class="field small-field">
          <label for="f-assignee">Assignee</label>
          <select id="f-assignee" class="select" :value="query.assignee" data-testid="filter-assignee" @change="onSelect('assignee', $event)">
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            <option v-if="query.assignee && query.assignee !== 'none' && !store.memberById.has(query.assignee)" :value="query.assignee">Unknown member</option>
            <option v-for="m in store.members" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>
        <div class="field small-field">
          <label for="f-tag">Tag</label>
          <select id="f-tag" class="select" :value="query.tag" @change="onSelect('tag', $event)">
            <option value="">All tags</option>
            <option v-if="query.tag && !store.allTags.includes(query.tag)" :value="query.tag">{{ query.tag }}</option>
            <option v-for="t in store.allTags" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="field small-field">
          <label for="f-due">Due</label>
          <select id="f-due" class="select" :value="query.due" @change="onSelect('due', $event)">
            <option v-for="o in DUE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <button v-if="activeFilterCount" type="button" class="btn btn-ghost clear" @click="clearFilters">
          <AppIcon name="x" :size="14" />
          Clear filters
        </button>
      </div>
    </div>

    <div v-if="selected.size" class="bulk" role="region" aria-label="Bulk actions">
      <span class="bulk-count"><strong>{{ selected.size }}</strong> selected</span>
      <button type="button" class="btn btn-sm" @click="bulkDone">
        <AppIcon name="check" :size="14" />
        Mark done
      </button>
      <div class="bulk-move">
        <label for="bulk-project" class="sr-only">Move selected tasks to project</label>
        <select id="bulk-project" v-model="moveTarget" class="select select-sm" @change="bulkMove">
          <option value="" disabled>Move to project…</option>
          <option value="none">No project</option>
          <option v-for="p in store.projectOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </div>
      <button type="button" class="btn btn-sm btn-danger" @click="bulkDelete">
        <AppIcon name="trash" :size="14" />
        Delete
      </button>
      <button type="button" class="btn btn-sm btn-ghost" @click="selected = new Set()">Clear selection</button>
    </div>

    <PageLoading v-if="!store.ready" :rows="8" />
    <div v-else class="card list-card">
      <div class="list-head" aria-hidden="false">
        <input
          type="checkbox"
          class="checkbox"
          :checked="allOnPageSelected"
          :indeterminate="someOnPageSelected && !allOnPageSelected"
          :disabled="!pageIds.length"
          aria-label="Select all tasks on this page"
          @change="toggleSelectAll"
        >
        <span class="h-title">Task</span>
        <span class="h-project">Project</span>
        <span class="h-assignee">Assignee</span>
        <span class="h-priority">Priority</span>
        <span class="h-due">Due</span>
        <span class="h-actions"><span class="sr-only">Actions</span></span>
      </div>
      <ul v-if="paged.items.length" class="rows">
        <li
          v-for="t in paged.items"
          :key="t.id"
          class="row"
          :class="{ overdue: isOverdue(t, store.today), done: t.status === 'done', selected: selected.has(t.id) }"
          data-testid="task-row"
        >
          <input type="checkbox" class="checkbox sel" :checked="selected.has(t.id)" :aria-label="`Select “${t.title}”`" @change="toggleSelect(t.id)" >
          <div class="main">
            <button
              type="button"
              class="done-toggle"
              :class="{ checked: t.status === 'done' }"
              :aria-label="t.status === 'done' ? `Mark “${t.title}” as not done` : `Mark “${t.title}” as done`"
              :aria-pressed="t.status === 'done'"
              @click="toggleDone(t.id)"
            >
              <AppIcon name="check" :size="12" />
            </button>
            <div class="title-wrap">
              <NuxtLink :to="`/tasks/${t.id}`" class="title">{{ t.title }}</NuxtLink>
              <div class="sub">
                <span v-if="statusPill(t)" class="status-pill" :class="{ custom: statusPill(t)?.id !== 'in_progress' }" data-testid="status-pill"><span v-if="statusPill(t)?.id !== 'in_progress'" class="dot" :style="{ background: statusPill(t)?.color }" aria-hidden="true" />{{ statusPill(t)?.name }}</span>
                <RecurrenceIcon :recurrence="t.recurrence" />
                <span v-if="isOverdue(t, store.today)" class="badge badge-danger overdue-flag">Overdue</span>
                <BlockedBadge v-if="store.blockedIds.has(t.id)" :task="t" />
                <span v-for="tag in t.tags" :key="tag" class="tag">{{ tag }}</span>
                <span v-if="t.subtasks.length" class="subs" :title="'Subtasks completed'">
                  <AppIcon name="check" :size="12" />{{ t.subtasks.filter((s) => s.done).length }}/{{ t.subtasks.length }}
                </span>
              </div>
            </div>
          </div>
          <div class="meta">
            <div class="c-project"><ProjectChip :project-id="t.projectId" /></div>
            <div class="c-assignee"><MemberAvatar :member-id="t.assigneeId" /></div>
            <div class="c-priority"><PriorityBadge :priority="t.priority" /></div>
            <div class="c-due"><DueLabel :due="t.dueDate" :status="t.status" /></div>
          </div>
          <div class="c-actions">
            <button type="button" class="btn btn-ghost btn-icon btn-sm" :aria-label="`Edit “${t.title}”`" @click="ui.openEditTask(t.id)">
              <AppIcon name="edit" :size="15" />
            </button>
          </div>
        </li>
      </ul>
      <div v-else class="empty">
        <p><strong>No tasks match.</strong></p>
        <p>Try adjusting your search or filters.</p>
        <button v-if="activeFilterCount" type="button" class="btn" style="margin-top: 12px" @click="clearFilters">Clear filters</button>
      </div>

      <nav class="pager" aria-label="Pagination">
        <span class="muted">
          {{ paged.items.length ? (paged.page - 1) * store.settings.pageSize + 1 : 0 }}–{{ (paged.page - 1) * store.settings.pageSize + paged.items.length }}
          of {{ sorted.length.toLocaleString('en-US') }}
        </span>
        <div class="pager-btns">
          <button type="button" class="btn btn-sm" :disabled="paged.page <= 1" data-testid="pagination-prev" @click="goPage(paged.page - 1)">
            <AppIcon name="chevronLeft" :size="14" />
            Prev
          </button>
          <span class="page-no" aria-current="page">Page {{ paged.page }} / {{ paged.pageCount }}</span>
          <button type="button" class="btn btn-sm" :disabled="paged.page >= paged.pageCount" data-testid="pagination-next" @click="goPage(paged.page + 1)">
            Next
            <AppIcon name="chevronRight" :size="14" />
          </button>
        </div>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar {
  padding: 12px;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbar-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.search {
  position: relative;
  flex: 1;
}

.search-icon {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-subtle);
  pointer-events: none;
}

.search-input {
  padding-left: 34px;
}

.sort {
  display: flex;
  gap: 6px;
}

.sort .select {
  width: auto;
}

.dir {
  display: inline-block;
  font-weight: 700;
  transition: transform 0.15s;
}

.dir.desc {
  transform: rotate(180deg);
}

.filters-toggle {
  display: none;
}

.count {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 11px;
  margin-left: 2px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 18px;
  align-items: flex-end;
}

.group {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.group legend {
  padding: 0;
  margin-bottom: 6px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fchip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
}

.fchip:hover {
  background: var(--surface-hover);
}

.fchip.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-text);
}

.small-field {
  width: 160px;
}

.clear {
  margin-left: auto;
}

.bulk {
  position: sticky;
  top: calc(var(--topbar-h) + 8px);
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: var(--radius);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  box-shadow: var(--shadow);
}

.bulk-count {
  margin-right: 6px;
  color: var(--accent-text);
}

.select-sm {
  height: 30px;
  font-size: 12.5px;
  width: auto;
}

.list-card {
  overflow: hidden;
}

.list-head,
.row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 150px 84px 100px 120px 40px;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
}

.list-head {
  height: 40px;
  font-size: 12px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-subtle);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.row {
  min-height: 58px;
  padding-top: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
  position: relative;
}

.row:hover {
  background: var(--surface-hover);
}

.row.selected {
  background: color-mix(in srgb, var(--accent-soft) 70%, transparent);
}

.row.overdue::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--danger);
}

.main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.done-toggle {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  background: transparent;
  color: transparent;
  cursor: pointer;
  padding: 0;
  transition: all 0.12s;
}

.done-toggle:hover {
  border-color: var(--s-done);
  color: var(--s-done);
}

.done-toggle.checked {
  background: var(--s-done);
  border-color: var(--s-done);
  color: #fff;
}

:root[data-theme='dark'] .done-toggle.checked {
  color: #0d1017;
}

.title-wrap {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.title {
  color: var(--text);
  font-weight: 560;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row.done .title {
  color: var(--text-subtle);
  text-decoration: line-through;
}

.sub {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.sub:empty {
  display: none;
}

.status-pill {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--s-in_progress);
}

.status-pill.custom {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
}

.status-pill .dot {
  width: 7px;
  height: 7px;
}

.overdue-flag {
  height: 20px;
}

.subs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--text-subtle);
  font-variant-numeric: tabular-nums;
}

.meta {
  display: contents;
}

.c-project {
  min-width: 0;
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

@media (max-width: 1000px) {
  .list-head,
  .row {
    grid-template-columns: 20px minmax(0, 1fr) 84px 100px 120px 40px;
  }

  .c-project,
  .h-project {
    display: none;
  }
}

@media (max-width: 767px) {
  .toolbar-row {
    flex-wrap: wrap;
  }

  .search {
    flex-basis: 100%;
  }

  .sort {
    flex: 1;
  }

  .sort .select {
    flex: 1;
  }

  .filters-toggle {
    display: inline-flex;
  }

  .filters {
    display: none;
  }

  .filters.open {
    display: flex;
  }

  .small-field {
    width: calc(50% - 9px);
  }

  .list-head {
    display: flex;
    gap: 10px;
    padding: 0 14px;
  }

  .list-head > span {
    display: none;
  }

  .list-head::after {
    content: 'Select all on page';
    text-transform: none;
    letter-spacing: 0;
    font-size: 12.5px;
  }

  .row {
    grid-template-columns: 20px minmax(0, 1fr) 36px;
    grid-template-areas:
      'sel main act'
      '. meta meta';
    row-gap: 8px;
    padding: 12px 14px;
  }

  .sel {
    grid-area: sel;
    align-self: start;
    margin-top: 2px;
  }

  .main {
    grid-area: main;
  }

  .title {
    white-space: normal;
  }

  .meta {
    grid-area: meta;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }

  .row .c-project {
    display: block;
    max-width: 50%;
  }

  .c-assignee:empty {
    display: none;
  }

  .c-actions {
    grid-area: act;
  }

}
</style>
