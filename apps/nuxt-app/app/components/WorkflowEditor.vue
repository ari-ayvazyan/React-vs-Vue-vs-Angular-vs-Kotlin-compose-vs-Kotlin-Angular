<script setup lang="ts">
import type { StatusCategory, WorkflowStatus } from '~/lib/types';
import { STATUSES } from '~/lib/types';
import { CATEGORY_LABELS, STATUS_NAME_MAX, copyWorkflow, moveStatus, projectsUsingWorkflowOf } from '~/lib/workflows';
import { uid } from '~/lib/taskOps';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

/** Edit one project's workflow: customise/reset, add, rename, recolour, recategorise, reorder and delete statuses. */
const props = defineProps<{ projectId: string }>();
const store = useTaskStore();
const ui = useUiStore();
const uidBase = useId();

const project = computed(() => store.projectById.get(props.projectId));
const own = computed(() => project.value?.workflow ?? null);
const effective = computed(() => store.workflows.workflowOf(props.projectId));
const sourceId = computed(() => store.workflows.sourceOf(props.projectId));
const parentName = computed(() => (project.value?.parentId ? (store.projectById.get(project.value.parentId)?.name ?? '') : ''));
const inheritedFrom = computed(() => (sourceId.value ? (store.projectById.get(sourceId.value)?.name ?? '') : 'the default workflow'));
/** Projects sharing this workflow: the project itself and sub-projects that inherit it. */
const sharingCount = computed(() => (own.value ? projectsUsingWorkflowOf(store.projects, props.projectId).size - 1 : 0));

/** Tasks per status id among the projects that use this workflow. */
const taskCounts = computed(() => {
  const scope = own.value ? projectsUsingWorkflowOf(store.projects, props.projectId) : new Set<string>();
  const counts = new Map<string, number>();
  for (const t of store.tasks) if (t.projectId && scope.has(t.projectId)) counts.set(t.statusId, (counts.get(t.statusId) ?? 0) + 1);
  return counts;
});

const error = ref('');
function apply(next: WorkflowStatus[] | null, remap: Record<string, string> = {}, message = ''): boolean {
  error.value = store.setWorkflow(props.projectId, next, remap);
  if (error.value) return false;
  if (message) ui.toast(message, { kind: 'success', duration: 3000, actionLabel: 'Undo', action: () => store.undo() });
  return true;
}

function customize(): void {
  apply(copyWorkflow(effective.value), {}, 'This project now has its own workflow');
}

const confirmReset = ref(false);
function reset(): void {
  confirmReset.value = false;
  apply(null, {}, parentName.value ? `Now using the workflow of ${parentName.value}` : 'Now using the default workflow');
}

function update(id: string, patch: Partial<WorkflowStatus>): void {
  if (!own.value) return;
  apply(own.value.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

function rename(s: WorkflowStatus, e: Event): void {
  const input = e.target as HTMLInputElement;
  const name = input.value.trim();
  if (name === s.name) return;
  if (!apply((own.value ?? []).map((x) => (x.id === s.id ? { ...x, name } : x)))) input.value = s.name;
}

function move(id: string, dir: -1 | 1): void {
  if (own.value) apply(moveStatus(own.value, id, dir));
}

// ----- delete with "move tasks to" -----
const deleting = ref<WorkflowStatus | null>(null);
const moveTo = ref('');
function askDelete(s: WorkflowStatus): void {
  deleting.value = s;
  const others = (own.value ?? []).filter((x) => x.id !== s.id);
  moveTo.value = (others.find((x) => x.category === s.category) ?? others[0])?.id ?? '';
  error.value = '';
}
function confirmDelete(): void {
  const s = deleting.value;
  if (!s || !own.value) return;
  const remaining = own.value.filter((x) => x.id !== s.id);
  if (apply(remaining, moveTo.value ? { [s.id]: moveTo.value } : {}, `Deleted status “${s.name}”`)) deleting.value = null;
}

// ----- add -----
const PRESETS = ['#64748b', '#2563eb', '#7c3aed', '#db2777', '#d97706', '#0891b2', '#059669'];
const newName = ref('');
const newCategory = ref<StatusCategory>('in_progress');
const newColor = ref(PRESETS[2] as string);
function add(): void {
  if (!own.value) return;
  const status: WorkflowStatus = { id: uid('st'), name: newName.value.trim(), color: newColor.value, category: newCategory.value };
  // insert after the last status of the same category, so categories stay grouped
  const list = [...own.value];
  let at = list.map((x) => x.category).lastIndexOf(status.category);
  if (at < 0) at = status.category === 'todo' ? -1 : list.length - 1;
  list.splice(at + 1, 0, status);
  if (apply(list, {}, `Added status “${status.name}”`)) newName.value = '';
}
</script>

<template>
  <div class="wf" data-testid="workflow-editor">
    <template v-if="!own">
      <p class="muted inherit">
        Uses <strong>{{ inheritedFrom === 'the default workflow' ? inheritedFrom : `the workflow of ${inheritedFrom}` }}</strong>.
        Changes there apply here too.
      </p>
      <ol class="preview">
        <li v-for="s in effective" :key="s.id"><span class="dot" :style="{ background: s.color }" aria-hidden="true" />{{ s.name }} <span class="cat">{{ CATEGORY_LABELS[s.category] }}</span></li>
      </ol>
      <button type="button" class="btn btn-primary btn-sm" data-testid="workflow-customize" @click="customize">Customize for this project</button>
    </template>

    <template v-else>
      <p v-if="sharingCount" class="muted inherit">{{ sharingCount }} sub-project{{ sharingCount === 1 ? '' : 's' }} inherit{{ sharingCount === 1 ? 's' : '' }} this workflow.</p>
      <ol class="statuses">
        <li v-for="(s, i) in own" :key="s.id" class="status" data-testid="workflow-status">
          <label class="color" :title="`Colour of ${s.name}`">
            <span class="sr-only">Colour of {{ s.name }}</span>
            <span class="swatch" :style="{ background: s.color }" aria-hidden="true" />
            <input type="color" :value="s.color" @change="update(s.id, { color: ($event.target as HTMLInputElement).value })" >
          </label>
          <label :for="`${uidBase}-name-${s.id}`" class="sr-only">Name</label>
          <input
            :id="`${uidBase}-name-${s.id}`"
            class="input name"
            type="text"
            :value="s.name"
            :maxlength="STATUS_NAME_MAX"
            data-testid="workflow-status-name"
            @change="rename(s, $event)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          >
          <label :for="`${uidBase}-cat-${s.id}`" class="sr-only">Category of {{ s.name }}</label>
          <select :id="`${uidBase}-cat-${s.id}`" class="select cat-select" :value="s.category" @change="update(s.id, { category: ($event.target as HTMLSelectElement).value as StatusCategory })">
            <option v-for="c in STATUSES" :key="c" :value="c">{{ CATEGORY_LABELS[c] }}</option>
          </select>
          <span class="count muted" :title="`${taskCounts.get(s.id) ?? 0} tasks`">{{ taskCounts.get(s.id) ?? 0 }}</span>
          <div class="acts">
            <button type="button" class="btn btn-ghost btn-icon btn-sm" :disabled="i === 0" :aria-label="`Move ${s.name} up`" @click="move(s.id, -1)">
              <AppIcon name="chevronDown" :size="14" class="up" />
            </button>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" :disabled="i === own.length - 1" :aria-label="`Move ${s.name} down`" @click="move(s.id, 1)">
              <AppIcon name="chevronDown" :size="14" />
            </button>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" :disabled="own.length === 1" :aria-label="`Delete status ${s.name}`" data-testid="workflow-status-delete" @click="askDelete(s)">
              <AppIcon name="trash" :size="14" />
            </button>
          </div>
        </li>
      </ol>

      <div v-if="deleting" class="confirm" role="group" :aria-label="`Delete status ${deleting.name}`">
        <p>
          Delete <strong>{{ deleting.name }}</strong>?
          <template v-if="taskCounts.get(deleting.id)">Its {{ taskCounts.get(deleting.id) }} task{{ taskCounts.get(deleting.id) === 1 ? '' : 's' }} will move to:</template>
        </p>
        <div class="confirm-row">
          <template v-if="taskCounts.get(deleting.id)">
            <label :for="`${uidBase}-moveto`" class="sr-only">Move tasks to</label>
            <select :id="`${uidBase}-moveto`" v-model="moveTo" class="select" data-testid="workflow-delete-target">
              <option v-for="o in own.filter((x) => x.id !== deleting?.id)" :key="o.id" :value="o.id">{{ o.name }} ({{ CATEGORY_LABELS[o.category] }})</option>
            </select>
          </template>
          <button type="button" class="btn btn-danger btn-sm" data-testid="workflow-delete-confirm" @click="confirmDelete">Delete status</button>
          <button type="button" class="btn btn-sm" @click="deleting = null">Cancel</button>
        </div>
      </div>

      <form class="add" novalidate @submit.prevent="add">
        <label :for="`${uidBase}-new`" class="sr-only">New status name</label>
        <input :id="`${uidBase}-new`" v-model="newName" class="input" type="text" placeholder="New status, e.g. Review" :maxlength="STATUS_NAME_MAX" data-testid="workflow-new-name" >
        <label :for="`${uidBase}-newcat`" class="sr-only">Category</label>
        <select :id="`${uidBase}-newcat`" v-model="newCategory" class="select cat-select" data-testid="workflow-new-category">
          <option v-for="c in STATUSES" :key="c" :value="c">{{ CATEGORY_LABELS[c] }}</option>
        </select>
        <div class="presets" role="radiogroup" aria-label="Colour">
          <label v-for="c in PRESETS" :key="c" class="preset" :class="{ on: newColor === c }" :style="{ background: c }">
            <input v-model="newColor" type="radio" :value="c" class="sr-only" :aria-label="`Colour ${c}`" >
          </label>
        </div>
        <button type="submit" class="btn btn-sm" data-testid="workflow-add">
          <AppIcon name="plus" :size="14" />
          Add status
        </button>
      </form>

      <p v-if="error" class="field-error" role="alert" data-testid="workflow-error">{{ error }}</p>

      <div class="reset">
        <template v-if="!confirmReset">
          <button type="button" class="btn btn-ghost btn-sm" @click="confirmReset = true">
            {{ parentName ? `Use the workflow of ${parentName} instead` : 'Use the default workflow instead' }}
          </button>
        </template>
        <template v-else>
          <span class="muted small">Tasks keep matching statuses; others move to the first status of the same category.</span>
          <button type="button" class="btn btn-danger btn-sm" data-testid="workflow-reset-confirm" @click="reset">Switch workflow</button>
          <button type="button" class="btn btn-sm" @click="confirmReset = false">Cancel</button>
        </template>
      </div>
    </template>
    <p v-if="error && !own" class="field-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.wf {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.inherit {
  margin: 0;
}

.preview {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preview li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 13px;
  font-weight: 550;
}

.cat {
  color: var(--text-subtle);
  font-weight: 500;
  font-size: 12px;
}

.statuses {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 130px 32px auto;
  align-items: center;
  gap: 8px;
}

.color {
  position: relative;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  cursor: pointer;
}

.color input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.color:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: 50%;
}

.swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.cat-select {
  width: auto;
}

.count {
  text-align: right;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.acts {
  display: flex;
}

.up {
  transform: rotate(180deg);
}

.confirm {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
}

.confirm p {
  margin: 0 0 8px;
}

.confirm-row,
.add,
.reset {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.confirm-row .select {
  width: auto;
}

.add .input {
  flex: 1 1 160px;
  width: auto;
}

.presets {
  display: flex;
  gap: 4px;
}

.preset {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  cursor: pointer;
}

.preset.on {
  outline: 2px solid var(--text);
  outline-offset: 2px;
}

.preset:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.reset {
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.small {
  font-size: 12.5px;
}

@media (max-width: 767px) {
  /* two rows per status: colour · name · count / category · actions */
  .status {
    grid-template-columns: 28px minmax(0, 1fr) auto;
    row-gap: 6px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .status .name {
    grid-column: 2;
    grid-row: 1;
  }

  .status .count {
    grid-column: 3;
    grid-row: 1;
  }

  .status .cat-select {
    grid-column: 2;
    grid-row: 2;
  }

  .status .acts {
    grid-column: 3;
    grid-row: 2;
  }
}
</style>
