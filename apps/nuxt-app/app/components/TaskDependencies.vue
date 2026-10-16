<script setup lang="ts">
import type { Task } from '~/lib/types';
import { STATUS_LABELS } from '~/lib/types';
import { tokenize } from '~/lib/filters';
import { validateDependency } from '~/lib/dependencies';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

const props = defineProps<{ task: Task }>();
const store = useTaskStore();
const ui = useUiStore();
const uidBase = useId();

/** Workflow status name (custom workflows have their own names). */
const statusName = (t: Task): string => store.workflows.statusOf(t.projectId, t.statusId)?.name ?? STATUS_LABELS[t.status];
const blockers = computed(() => props.task.blockedBy.map((id) => store.taskById.get(id)).filter((t): t is Task => !!t));
/** Tasks this one blocks (reverse edges). */
const blocking = computed(() => store.tasks.filter((t) => t.blockedBy.includes(props.task.id)));
const openCount = computed(() => blockers.value.filter((b) => b.status !== 'done').length);

// ----- searchable picker (ARIA combobox) -----
const query = ref('');
const open = ref(false);
const active = ref(0);
const error = ref('');
const MAX_RESULTS = 8;

const results = computed(() => {
  const tokens = tokenize(query.value);
  if (!tokens.length) return [];
  const taken = new Set([props.task.id, ...props.task.blockedBy]);
  const out: { task: Task; problem: string }[] = [];
  for (const t of store.tasks) {
    if (taken.has(t.id)) continue;
    const hay = t.title.toLowerCase();
    if (!tokens.every((tok) => hay.includes(tok))) continue;
    out.push({ task: t, problem: validateDependency(store.tasks, props.task.id, t.id) });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
});

watch(query, () => {
  open.value = query.value.trim().length > 0;
  active.value = 0;
  error.value = '';
});

const optionId = (i: number): string => `${uidBase}-dep-opt-${i}`;

function choose(i: number): void {
  const r = results.value[i];
  if (!r) return;
  const msg = store.addDependency(props.task.id, r.task.id);
  if (msg) {
    error.value = msg;
    return;
  }
  ui.toast(`“${r.task.title}” now blocks this task`, { kind: 'success', duration: 3000, actionLabel: 'Undo', action: () => store.undo() });
  query.value = '';
  open.value = false;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!results.value.length) return;
    e.preventDefault();
    open.value = true;
    const n = results.value.length;
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (open.value) choose(active.value);
  } else if (e.key === 'Escape' && open.value) {
    e.stopPropagation();
    open.value = false;
  }
}

function remove(b: Task): void {
  store.removeDependency(props.task.id, b.id);
  ui.toast(`Removed blocker “${b.title}”`, { duration: 3000, actionLabel: 'Undo', action: () => store.undo() });
}
</script>

<template>
  <section class="card" aria-labelledby="dep-title" data-testid="task-dependencies">
    <div class="card-header">
      <h2 id="dep-title" class="card-title">Dependencies</h2>
      <span v-if="blockers.length" class="muted small">{{ openCount }} open blocker{{ openCount === 1 ? '' : 's' }}</span>
    </div>
    <div class="card-body">
      <h3 class="sub-h">Blocked by</h3>
      <ul v-if="blockers.length" class="deps">
        <li v-for="b in blockers" :key="b.id" class="dep" :class="{ done: b.status === 'done' }" data-testid="blocker-row">
          <span class="st" :class="`st-${b.status}`">{{ statusName(b) }}</span>
          <NuxtLink :to="`/tasks/${b.id}`" class="dep-title">{{ b.title }}</NuxtLink>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" :aria-label="`Remove blocker “${b.title}”`" @click="remove(b)">
            <AppIcon name="x" :size="14" />
          </button>
        </li>
      </ul>
      <p v-else class="muted none">Nothing blocks this task.</p>

      <div class="picker">
        <label :for="`${uidBase}-dep-input`" class="sr-only">Add a blocking task</label>
        <AppIcon name="search" :size="15" class="picker-icon" />
        <input
          :id="`${uidBase}-dep-input`"
          v-model="query"
          class="input picker-input"
          type="text"
          role="combobox"
          autocomplete="off"
          placeholder="Add blocker: search tasks by title…"
          aria-autocomplete="list"
          :aria-expanded="open && results.length > 0"
          :aria-controls="`${uidBase}-dep-list`"
          :aria-activedescendant="open && results.length ? optionId(active) : undefined"
          :aria-invalid="error ? 'true' : 'false'"
          :aria-describedby="error ? `${uidBase}-dep-err` : undefined"
          data-testid="dependency-search"
          @keydown="onKeydown"
          @focus="open = query.trim().length > 0"
          @blur="open = false"
        >
        <ul v-show="open && results.length" :id="`${uidBase}-dep-list`" class="results" role="listbox" aria-label="Matching tasks">
          <li
            v-for="(r, i) in results"
            :id="optionId(i)"
            :key="r.task.id"
            role="option"
            class="result"
            :class="{ active: i === active, problem: r.problem }"
            :aria-selected="i === active"
            data-testid="dependency-option"
            @mousedown.prevent="choose(i)"
            @mousemove="active = i"
          >
            <span class="r-title">{{ r.task.title }}</span>
            <span class="r-meta">{{ r.problem ? 'Would create a cycle' : statusName(r.task) }}</span>
          </li>
        </ul>
        <p v-if="open && query.trim() && !results.length" class="muted small no-res">No matching tasks.</p>
      </div>
      <p v-if="error" :id="`${uidBase}-dep-err`" class="field-error" role="alert" data-testid="dependency-error">{{ error }}</p>

      <template v-if="blocking.length">
        <h3 class="sub-h blocking-h">Blocking</h3>
        <ul class="deps">
          <li v-for="b in blocking" :key="b.id" class="dep" :class="{ done: b.status === 'done' }">
            <span class="st" :class="`st-${b.status}`">{{ statusName(b) }}</span>
            <NuxtLink :to="`/tasks/${b.id}`" class="dep-title">{{ b.title }}</NuxtLink>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>

<style scoped>
.small {
  font-size: 12.5px;
}

.sub-h {
  font-size: 12px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-subtle);
  margin: 0 0 8px;
}

.blocking-h {
  margin-top: 16px;
}

.deps {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dep {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 2px 4px;
  border-radius: 6px;
}

.dep:hover {
  background: var(--surface-hover);
}

.st {
  flex: none;
  width: 84px;
  font-size: 12px;
  font-weight: 650;
  color: var(--text-muted);
}

.st-in_progress {
  color: var(--s-in_progress);
}

.st-done {
  color: var(--success);
}

.dep-title {
  flex: 1;
  min-width: 0;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dep.done .dep-title {
  color: var(--text-subtle);
  text-decoration: line-through;
}

.none {
  margin: 0 0 12px;
}

.picker {
  position: relative;
}

.picker-icon {
  position: absolute;
  left: 11px;
  top: 10px;
  color: var(--text-subtle);
  pointer-events: none;
}

.picker-input {
  padding-left: 34px;
}

.results {
  position: absolute;
  z-index: 30;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  max-height: 300px;
  overflow-y: auto;
}

.result {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 5px;
  cursor: pointer;
}

.result.active {
  background: var(--accent-soft);
}

.r-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.r-meta {
  flex: none;
  font-size: 12px;
  color: var(--text-subtle);
}

.problem .r-meta {
  color: var(--danger);
}

.no-res {
  margin: 6px 2px 0;
}
</style>
