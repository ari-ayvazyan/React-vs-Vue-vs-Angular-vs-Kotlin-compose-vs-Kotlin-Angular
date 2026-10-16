<script setup lang="ts">
import type { Task, WorkflowStatus } from '~/lib/types';
import { PRIORITY_LABELS } from '~/lib/types';
import type { BoardColumn } from '~/lib/board';
import { boardColumns, columnKeyOf, groupByColumn, statusForColumn } from '~/lib/board';
import { formatDate, relativeDue } from '~/lib/dates';
import { DEFAULT_QUERY, filterTasks, isOverdue, parseTaskQuery, serializeTaskQuery } from '~/lib/filters';
import { boardQueryOf, describeQuery, sameViewQuery } from '~/lib/views';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

useHead({ title: 'Board · TaskPilot' });

const store = useTaskStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

/**
 * The board reads the same query parameters as the task list (so saved views can be opened here), but ignores
 * status (the columns), sort and page. Project and assignee have selects; the other filters come from views.
 */
const boardQuery = computed(() => ({ ...parseTaskQuery(route.query as Record<string, string>), status: [], sort: DEFAULT_QUERY.sort, dir: DEFAULT_QUERY.dir, page: 1 }));
const projectFilter = computed(() => boardQuery.value.project);
const assigneeFilter = computed(() => boardQuery.value.assignee);
const currentBoardQuery = computed(() => boardQueryOf(serializeTaskQuery(boardQuery.value)));
/** Filters other than project/assignee (from a saved view), shown as a summary with a clear button. */
const extraFilters = computed(() => {
  const { project: _p, assignee: _a, ...rest } = currentBoardQuery.value;
  return Object.keys(rest).length ? describeQuery(rest, { projects: store.projectById, members: store.memberById }).replace(/ · Sort: .*$/, '') : '';
});
const activeView = computed(() => store.views.find((v) => sameViewQuery(boardQueryOf(v.query), currentBoardQuery.value) && Object.keys(currentBoardQuery.value).length > 0));

function setFilter(key: 'project' | 'assignee', e: Event): void {
  const next = { ...currentBoardQuery.value, [key]: (e.target as HTMLSelectElement).value };
  const query = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== ''));
  void router.replace({ path: '/board', query });
}

function clearExtraFilters(): void {
  const { project, assignee } = currentBoardQuery.value;
  void router.replace({ path: '/board', query: Object.fromEntries(Object.entries({ project, assignee }).filter(([, v]) => !!v)) as Record<string, string> });
}

const visibleIds = computed(() => new Set(filterTasks(store.tasks, boardQuery.value, store.today, store.projectScope).map((t) => t.id)));
const matches = (t: Task): boolean => visibleIds.value.has(t.id);

/** Defaults for "add task" from a column: pre-fill the filtered project/assignee. */
const newTaskDefaults = (statusId: string): { statusId: string; projectId: string | null; assigneeId: string | null } => ({
  statusId,
  projectId: projectFilter.value && projectFilter.value !== 'none' ? projectFilter.value : null,
  assigneeId: assigneeFilter.value && assigneeFilter.value !== 'none' ? assigneeFilter.value : null,
});

/**
 * Columns: the selected project's workflow statuses, or the three status categories for all projects / no
 * project. See lib/board.ts for how tasks map to columns and which status a dropped task gets.
 */
const board = computed(() => boardColumns(projectFilter.value && store.projectById.has(projectFilter.value) ? projectFilter.value : null, store.workflows));
const columns = computed(() => board.value.columns);
/** Full (unfiltered) columns sorted by order, and the visible (filtered) subset. */
const full = computed(() => groupByColumn(store.tasks, board.value.mode, columns.value));
const visible = computed(() => Object.fromEntries(columns.value.map((c) => [c.key, (full.value[c.key] ?? []).filter(matches)])) as Record<string, Task[]>);

const shown = (key: string): Task[] => visible.value[key] ?? [];
const columnOf = (t: Task): string => columnKeyOf(t, board.value.mode, columns.value);
/** Status name on a card when the column doesn't already say it (custom statuses on the category board). */
const cardStatus = (t: Task, column: BoardColumn): WorkflowStatus | undefined => {
  const s = store.workflows.statusOf(t.projectId, t.statusId);
  return s && s.id !== column.key ? s : undefined;
};

/**
 * Map an insertion index in the visible column (excluding the moving card) to an index in the
 * full column (excluding the moving card), so filtering never scrambles hidden cards.
 */
function toFullIndex(key: string, visibleIndex: number, movingId: string): number {
  const vis = shown(key).filter((t) => t.id !== movingId);
  const all = (full.value[key] ?? []).filter((t) => t.id !== movingId);
  if (vis.length === 0) return all.length;
  if (visibleIndex >= vis.length) return all.indexOf(vis[vis.length - 1] as Task) + 1;
  return all.indexOf(vis[visibleIndex] as Task);
}

/** Move a task into a column (status resolved in the task's own workflow) at a full-column index. */
function moveInto(task: Task, column: BoardColumn, fullIndex: number): boolean {
  const status = statusForColumn(task, column, board.value.mode, store.workflows);
  const destIds = (full.value[column.key] ?? []).filter((t) => t.id !== task.id).map((t) => t.id);
  return store.moveTask(task.id, status.id, destIds, fullIndex);
}

// ---------- drag & drop ----------
const dragId = ref<string | null>(null);
const drop = ref<{ key: string; index: number } | null>(null);
const announce = ref('');

function onDragStart(e: DragEvent, t: Task): void {
  dragId.value = t.id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', t.id);
  }
}

function onDragEnd(): void {
  dragId.value = null;
  drop.value = null;
}

function onDragOver(e: DragEvent, key: string): void {
  if (!dragId.value) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const list = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-card-id]');
  let index = 0;
  for (const el of list) {
    if (el.dataset.cardId === dragId.value) continue;
    const r = el.getBoundingClientRect();
    if (e.clientY > r.top + r.height / 2) index++;
    else break;
  }
  if (!drop.value || drop.value.key !== key || drop.value.index !== index) drop.value = { key, index };
}

function onDragLeave(e: DragEvent): void {
  const to = e.relatedTarget as Node | null;
  if (!to || !(e.currentTarget as HTMLElement).contains(to)) drop.value = null;
}

function onDrop(e: DragEvent, column: BoardColumn): void {
  e.preventDefault();
  const id = dragId.value ?? e.dataTransfer?.getData('text/plain');
  const target = drop.value;
  dragId.value = null;
  drop.value = null;
  if (!id || !target || target.key !== column.key) return;
  const task = store.taskById.get(id);
  if (!task) return;
  const fullIndex = toFullIndex(column.key, target.index, id);
  const currentIndex = (full.value[column.key] ?? []).findIndex((t) => t.id === id);
  if (columnOf(task) === column.key && currentIndex === fullIndex) return;
  if (moveInto(task, column, fullIndex)) announce.value = `Moved “${task.title}” to ${column.name}.`;
}

/** Index (in the visible list, dragged card excluded) where the drop indicator should render. */
function indicatorBefore(key: string, t: Task, i: number): boolean {
  if (!drop.value || drop.value.key !== key || t.id === dragId.value) return false;
  const before = shown(key).slice(0, i).filter((x) => x.id !== dragId.value).length;
  return before === drop.value.index;
}

function indicatorAtEnd(key: string): boolean {
  if (!drop.value || drop.value.key !== key) return false;
  return shown(key).filter((x) => x.id !== dragId.value).length <= drop.value.index;
}

// ---------- keyboard ----------
async function onCardKey(e: KeyboardEvent, t: Task): Promise<void> {
  if (e.key === 'Enter') {
    void navigateTo(`/tasks/${t.id}`);
    return;
  }
  if (!e.shiftKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const key = columnOf(t);
  const col = columns.value.findIndex((c) => c.key === key);
  const vis = shown(key);
  const vi = vis.findIndex((x) => x.id === t.id);
  let target = columns.value[col] as BoardColumn;
  let visIndex = vi;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const next = columns.value[col + (e.key === 'ArrowLeft' ? -1 : 1)];
    if (!next) return;
    target = next;
    visIndex = Math.min(vi, shown(next.key).length);
  } else {
    visIndex = vi + (e.key === 'ArrowUp' ? -1 : 1);
    if (visIndex < 0 || visIndex >= vis.length) return;
  }
  if (!moveInto(t, target, toFullIndex(target.key, visIndex, t.id))) return;
  announce.value = `“${t.title}” moved to ${target.name}, position ${visIndex + 1}.`;
  await nextTick();
  document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(t.id)}"]`)?.focus();
}

const subDone = (t: Task): number => t.subtasks.filter((s) => s.done).length;
</script>

<template>
  <div class="page board-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">Board</h1>
        <p class="page-subtitle">Drag cards between columns, or focus a card and use <kbd>Shift</kbd> + arrow keys.</p>
      </div>
      <div class="filters">
        <div class="field filter">
          <label for="board-project">Project</label>
          <select id="board-project" class="select" :value="projectFilter" @change="setFilter('project', $event)">
            <option value="">All projects</option>
            <option value="none">No project</option>
            <option v-for="p in store.projectOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <div class="field filter">
          <label for="board-assignee">Assignee</label>
          <select id="board-assignee" class="select" :value="assigneeFilter" data-testid="board-filter-assignee" @change="setFilter('assignee', $event)">
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            <option v-for="m in store.members" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="extraFilters || activeView" class="view-bar" data-testid="board-view-bar">
      <AppIcon name="filter" :size="15" />
      <span>
        <strong v-if="activeView">View “{{ activeView.name }}”</strong><template v-if="activeView && extraFilters"> · </template>
        <span v-if="extraFilters">{{ extraFilters }}</span>
      </span>
      <button v-if="extraFilters" type="button" class="btn btn-ghost btn-sm" @click="clearExtraFilters">
        <AppIcon name="x" :size="13" />
        Clear view filters
      </button>
    </div>

    <p class="sr-only" aria-live="polite">{{ announce }}</p>

    <PageLoading v-if="!store.ready" :rows="4" />
    <div v-else class="columns" :style="{ '--cols': columns.length }">
      <section
        v-for="c in columns"
        :key="c.key"
        class="column"
        :class="{ over: drop?.key === c.key }"
        :data-testid="`board-column-${c.key}`"
        :aria-label="`${c.name} column, ${shown(c.key).length} tasks`"
        @dragover="onDragOver($event, c.key)"
        @dragleave="onDragLeave"
        @drop="onDrop($event, c)"
      >
        <header class="col-head">
          <span class="col-dot" :style="{ background: board.mode === 'category' ? `var(--s-${c.key})` : c.color }" aria-hidden="true" />
          <h2 class="col-title">{{ c.name }}</h2>
          <span class="col-count">{{ shown(c.key).length }}</span>
          <button type="button" class="btn btn-ghost btn-icon btn-sm add" :aria-label="`Add task to ${c.name}`" @click="ui.openNewTask(newTaskDefaults(c.key))">
            <AppIcon name="plus" :size="15" />
          </button>
        </header>
        <ul class="cards">
          <template v-for="(t, i) in shown(c.key)" :key="t.id">
            <li v-if="indicatorBefore(c.key, t, i)" class="indicator" aria-hidden="true" />
            <li
              class="card-item"
              :class="{ dragging: dragId === t.id, overdue: isOverdue(t, store.today) }"
              draggable="true"
              tabindex="0"
              :data-card-id="t.id"
              data-testid="board-card"
              :aria-label="`${t.title}. ${PRIORITY_LABELS[t.priority]} priority.${store.blockedIds.has(t.id) ? ' Blocked.' : ''} Press Enter to open, Shift plus arrow keys to move.`"
              aria-roledescription="Draggable task card"
              @dragstart="onDragStart($event, t)"
              @dragend="onDragEnd"
              @keydown="onCardKey($event, t)"
            >
              <div class="card-top">
                <span class="prio-wrap">
                  <span class="prio" :class="`badge badge-${t.priority}`">{{ PRIORITY_LABELS[t.priority] }}</span>
                  <BlockedBadge v-if="store.blockedIds.has(t.id)" :task="t" />
                </span>
                <span v-if="t.projectId && store.projectById.get(t.projectId)" class="proj" :title="store.projectById.get(t.projectId)?.name">
                  <span class="dot" :style="{ background: store.projectById.get(t.projectId)?.color }" />
                  {{ store.projectById.get(t.projectId)?.name }}
                </span>
              </div>
              <NuxtLink :to="`/tasks/${t.id}`" class="ctitle" draggable="false" tabindex="-1">{{ t.title }}</NuxtLink>
              <div class="card-foot">
                <span v-if="t.dueDate" class="due" :class="{ late: isOverdue(t, store.today) }">
                  <AppIcon :name="isOverdue(t, store.today) ? 'alert' : 'calendar'" :size="12" />
                  {{ t.status === 'done' ? formatDate(t.dueDate) : relativeDue(t.dueDate, store.today) }}
                </span>
                <span v-if="t.subtasks.length" class="subs" :class="{ complete: subDone(t) === t.subtasks.length }">
                  <AppIcon name="check" :size="12" />
                  {{ subDone(t) }}/{{ t.subtasks.length }}
                </span>
                <RecurrenceIcon :recurrence="t.recurrence" :size="12" />
                <span v-if="cardStatus(t, c)" class="card-status" data-testid="card-status"><span class="dot" :style="{ background: cardStatus(t, c)?.color }" />{{ cardStatus(t, c)?.name }}</span>
                <MemberAvatar :member-id="t.assigneeId" :size="22" class="assignee" />
              </div>
              <div v-if="t.subtasks.length" class="mini-bar" aria-hidden="true">
                <span :style="{ width: `${(subDone(t) / t.subtasks.length) * 100}%` }" />
              </div>
            </li>
          </template>
          <li v-if="indicatorAtEnd(c.key)" class="indicator" aria-hidden="true" />
          <li v-if="!shown(c.key).length && !indicatorAtEnd(c.key)" class="empty-col">No tasks</li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.view-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: -6px 0 14px;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 13px;
}

.view-bar .btn {
  margin-left: auto;
}

.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.filter {
  width: 200px;
}

.assignee {
  margin-left: auto;
}

.columns {
  display: grid;
  grid-template-columns: repeat(var(--cols, 3), minmax(230px, 1fr));
  overflow-x: auto;
  padding-bottom: 4px;
  gap: 16px;
  align-items: start;
}

.column {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 10px;
  min-height: 200px;
  transition:
    border-color 0.12s,
    background 0.12s;
}

.column.over {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 60%, var(--surface-2));
}

.col-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 10px;
}

.col-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.col-title {
  font-size: 14px;
}

.col-count {
  font-size: 12px;
  font-weight: 650;
  color: var(--text-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 1px 8px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}

.add {
  margin-left: auto;
}

.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-item {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  box-shadow: var(--shadow-sm);
  cursor: grab;
  display: flex;
  flex-direction: column;
  gap: 7px;
  transition:
    box-shadow 0.12s,
    border-color 0.12s,
    opacity 0.12s;
}

.card-item:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow);
}

.card-item:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.card-item.overdue {
  border-left: 3px solid var(--danger);
}

.card-item.dragging {
  opacity: 0.4;
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.prio-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.prio {
  height: 20px;
  font-size: 11px;
}

.proj {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 0;
}

.ctitle {
  color: var(--text);
  font-weight: 560;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.card-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.card-foot:empty {
  display: none;
}

.due,
.subs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.late {
  color: var(--danger);
  font-weight: 600;
}

.complete {
  color: var(--success);
}

.card-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-muted);
}

.card-status .dot {
  width: 7px;
  height: 7px;
}

.mini-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--surface-2);
  overflow: hidden;
}

.mini-bar span {
  display: block;
  height: 100%;
  background: var(--s-done);
}

.indicator {
  height: 4px;
  border-radius: 2px;
  background: var(--accent);
  margin: -2px 0;
}

.empty-col {
  padding: 24px 8px;
  text-align: center;
  color: var(--text-subtle);
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius);
  font-size: 13px;
}

@media (max-width: 767px) {
  .filters {
    width: 100%;
  }

  .filter {
    flex: 1 1 140px;
    width: auto;
  }

  .columns {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding-bottom: 12px;
    margin-right: -14px;
    padding-right: 14px;
  }

  .column {
    flex: 0 0 82vw;
    scroll-snap-align: start;
  }
}
</style>
