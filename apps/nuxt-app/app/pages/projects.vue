<script setup lang="ts">
import type { Project } from '~/lib/types';
import { projectProgress } from '~/lib/stats';
import { descendantIds, projectTree } from '~/lib/projects';
import type { ProjectTaskMode, SubprojectMode } from '~/lib/projects';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

useHead({ title: 'Projects · TaskPilot' });

const store = useTaskStore();
const ui = useUiStore();

const PRESETS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b'];

/** Projects in tree order with progress that includes sub-projects. */
const rows = computed(() => {
  const progress = new Map(projectProgress(store.projects, store.tasks).map((r) => [r.project.id, r]));
  const childCount = new Map<string, number>();
  for (const p of store.projects) if (p.parentId) childCount.set(p.parentId, (childCount.get(p.parentId) ?? 0) + 1);
  return projectTree(store.projects).map((n) => ({
    ...(progress.get(n.project.id) as ReturnType<typeof projectProgress>[number]),
    depth: n.depth,
    path: n.path,
    children: childCount.get(n.project.id) ?? 0,
    workflowLabel: n.project.workflow ? `Own workflow · ${n.project.workflow.length} statuses` : n.project.parentId ? 'Inherited workflow' : 'Default workflow',
  }));
});
const unassigned = computed(() => store.tasks.filter((t) => t.projectId === null).length);

function validateName(name: string, exceptId?: string): string {
  const n = name.trim();
  if (!n) return 'Project name is required.';
  if (n.length > 60) return 'Project name must be at most 60 characters.';
  if (store.projects.some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase())) return 'A project with this name already exists.';
  return '';
}

// ----- create -----
const newName = ref('');
const newColor = ref(PRESETS[0] as string);
const newParent = ref('');
const createError = ref('');

function create(): void {
  createError.value = validateName(newName.value);
  if (createError.value) return;
  const p = store.createProject(newName.value, newColor.value, newParent.value || null);
  ui.toast(`Created project “${p.name}”`, { kind: 'success', actionLabel: 'Undo', action: () => store.undo() });
  newName.value = '';
  newColor.value = PRESETS[(store.projects.length % PRESETS.length) as number] as string;
}

// ----- rename -----
const editingId = ref<string | null>(null);
const editName = ref('');
const editError = ref('');

async function startEdit(p: Project): Promise<void> {
  editingId.value = p.id;
  editName.value = p.name;
  editError.value = '';
  await nextTick();
  document.getElementById(`rename-${p.id}`)?.focus();
}

function saveEdit(p: Project): void {
  editError.value = validateName(editName.value, p.id);
  if (editError.value) return;
  if (editName.value.trim() !== p.name) store.updateProject(p.id, { name: editName.value.trim() });
  editingId.value = null;
}

function recolor(p: Project, e: Event): void {
  const color = (e.target as HTMLInputElement).value;
  if (color !== p.color) store.updateProject(p.id, { color });
}

// ----- move (re-parent) -----
const moving = ref<Project | null>(null);
const moveParent = ref('');
const moveError = ref('');
/** Possible parents: every project except the one being moved and its sub-projects. */
const parentOptions = computed(() => {
  const excluded = moving.value ? descendantIds(store.projects, moving.value.id) : new Set<string>();
  return store.projectOptions.filter((o) => !excluded.has(o.id));
});
function askMove(p: Project): void {
  moving.value = p;
  moveParent.value = p.parentId ?? '';
  moveError.value = '';
}
function confirmMove(): void {
  const p = moving.value;
  if (!p) return;
  const parentId = moveParent.value || null;
  if (parentId !== p.parentId) {
    moveError.value = store.updateProject(p.id, { parentId });
    if (moveError.value) return;
    const parent = parentId ? store.projectById.get(parentId)?.name : null;
    ui.toast(parent ? `Moved “${p.name}” under “${parent}”` : `“${p.name}” is now a top-level project`, { kind: 'success', actionLabel: 'Undo', action: () => store.undo() });
  }
  moving.value = null;
}

// ----- workflow -----
const workflowFor = ref<Project | null>(null);

// ----- delete -----
const deleting = ref<Project | null>(null);
const deleteMode = ref<ProjectTaskMode>('unassign');
const subMode = ref<SubprojectMode>('lift');
const deletingChildren = computed(() => (deleting.value ? store.projects.filter((p) => p.parentId === deleting.value?.id).length : 0));
/** Projects removed with the current choice: just this one, or it and all its sub-projects. */
const deletingScope = computed(() => {
  if (!deleting.value) return new Set<string>();
  return subMode.value === 'delete' ? descendantIds(store.projects, deleting.value.id) : new Set([deleting.value.id]);
});
const deletingCount = computed(() => store.tasks.filter((t) => t.projectId !== null && deletingScope.value.has(t.projectId)).length);

function askDelete(p: Project): void {
  deleting.value = p;
  deleteMode.value = 'unassign';
  subMode.value = 'lift';
}

function confirmDelete(): void {
  const p = deleting.value;
  if (!p) return;
  const n = deletingCount.value;
  store.deleteProject(p.id, deleteMode.value, subMode.value);
  deleting.value = null;
  ui.toast(
    deleteMode.value === 'delete' && n ? `Deleted “${p.name}” and ${n} task${n === 1 ? '' : 's'}` : `Deleted project “${p.name}”`,
    { actionLabel: 'Undo', action: () => store.undo() },
  );
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">Projects</h1>
        <p class="page-subtitle">Group tasks and track progress per project.</p>
      </div>
    </div>

    <form class="card create" novalidate @submit.prevent="create">
      <div class="field grow">
        <label for="new-project-name">New project</label>
        <input
          id="new-project-name"
          v-model="newName"
          class="input"
          type="text"
          placeholder="Project name"
          maxlength="80"
          :aria-invalid="createError ? 'true' : 'false'"
          :aria-describedby="createError ? 'new-project-err' : undefined"
        >
      </div>
      <div class="field parent-field">
        <label for="new-project-parent">Parent</label>
        <select id="new-project-parent" v-model="newParent" class="select" data-testid="new-project-parent">
          <option value="">None (top level)</option>
          <option v-for="o in store.projectOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
        </select>
      </div>
      <fieldset class="colors">
        <legend class="label">Colour</legend>
        <div class="swatches">
          <label v-for="c in PRESETS" :key="c" class="swatch" :style="{ background: c }" :class="{ on: newColor === c }">
            <input v-model="newColor" type="radio" name="new-color" :value="c" class="sr-only" :aria-label="`Colour ${c}`" >
          </label>
          <label class="swatch custom" :class="{ on: !PRESETS.includes(newColor) }" :style="{ background: PRESETS.includes(newColor) ? undefined : newColor }" title="Custom colour">
            <input v-model="newColor" type="color" class="color-input" aria-label="Custom colour" >
            <AppIcon v-if="PRESETS.includes(newColor)" name="plus" :size="12" />
          </label>
        </div>
      </fieldset>
      <button type="submit" class="btn btn-primary">
        <AppIcon name="plus" :size="15" />
        Add project
      </button>
      <p v-if="createError" id="new-project-err" class="field-error full" role="alert">{{ createError }}</p>
    </form>

    <PageLoading v-if="!store.ready" :rows="4" />
    <template v-else>
      <ul v-if="rows.length" class="grid">
        <li
          v-for="r in rows"
          :key="r.project.id"
          class="card proj"
          :class="{ sub: r.depth > 0 }"
          :style="{ '--pc': r.project.color, '--depth': r.depth }"
          data-testid="project-row"
          :data-project-id="r.project.id"
        >
          <div class="proj-head">
            <label class="color-btn" :title="`Change colour of ${r.project.name}`">
              <span class="sr-only">Colour for {{ r.project.name }}</span>
              <input type="color" class="color-input" :value="r.project.color" @change="recolor(r.project, $event)" >
            </label>
            <form v-if="editingId === r.project.id" class="rename" novalidate @submit.prevent="saveEdit(r.project)">
              <label :for="`rename-${r.project.id}`" class="sr-only">Project name</label>
              <input
                :id="`rename-${r.project.id}`"
                v-model="editName"
                class="input"
                type="text"
                maxlength="80"
                :aria-invalid="editError ? 'true' : 'false'"
                @keydown.esc.stop="editingId = null"
              >
              <button type="submit" class="btn btn-primary btn-sm">Save</button>
              <button type="button" class="btn btn-sm" @click="editingId = null">Cancel</button>
            </form>
            <h2 v-else class="pname" :title="r.path">
              <NuxtLink :to="`/tasks?project=${r.project.id}`">{{ r.project.name }}</NuxtLink>
              <span v-if="r.children" class="subs-count">{{ r.children }} sub-project{{ r.children === 1 ? '' : 's' }}</span>
            </h2>
            <div v-if="editingId !== r.project.id" class="pactions">
              <button type="button" class="btn btn-ghost btn-icon btn-sm" :aria-label="`Rename ${r.project.name}`" @click="startEdit(r.project)">
                <AppIcon name="edit" :size="15" />
              </button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm" :aria-label="`Workflow of ${r.project.name}`" title="Workflow" data-testid="project-workflow" @click="workflowFor = r.project">
                <AppIcon name="board" :size="15" />
              </button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm" :aria-label="`Move ${r.project.name}`" title="Move under another project" data-testid="project-move" @click="askMove(r.project)">
                <AppIcon name="folderMove" :size="15" />
              </button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm" :aria-label="`Delete ${r.project.name}`" @click="askDelete(r.project)">
                <AppIcon name="trash" :size="15" />
              </button>
            </div>
          </div>
          <p v-if="editingId === r.project.id && editError" class="field-error" role="alert">{{ editError }}</p>
          <div class="stats">
            <span><strong>{{ r.total }}</strong> task{{ r.total === 1 ? '' : 's' }}</span>
            <span><strong>{{ r.done }}</strong> done</span>
            <span><strong>{{ r.total - r.done }}</strong> open</span>
          </div>
          <div class="progress" role="progressbar" :aria-valuenow="r.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="`${r.project.name} progress`">
            <span :style="{ width: `${r.percent}%` }" />
          </div>
          <div class="pfoot">
            <span class="pct">{{ r.percent }}% complete<template v-if="r.children"> · incl. sub-projects</template></span>
            <button type="button" class="wf-chip" @click="workflowFor = r.project">{{ r.workflowLabel }}</button>
            <NuxtLink :to="`/board?project=${r.project.id}`" class="small">Open board →</NuxtLink>
          </div>
        </li>
      </ul>
      <div v-else class="card empty">No projects yet. Create your first one above.</div>
      <p class="muted unassigned">{{ unassigned }} task{{ unassigned === 1 ? '' : 's' }} without a project · <NuxtLink to="/tasks?project=none">view</NuxtLink></p>
    </template>

    <BaseModal :open="!!deleting" :title="`Delete “${deleting?.name ?? ''}”?`" size="sm" @close="deleting = null">
      <fieldset v-if="deletingChildren" class="choices">
        <legend>It has {{ deletingChildren }} sub-project{{ deletingChildren === 1 ? '' : 's' }}. What should happen to {{ deletingChildren === 1 ? 'it' : 'them' }}?</legend>
        <label class="choice">
          <input v-model="subMode" type="radio" name="sub-mode" value="lift" data-testid="delete-sub-lift" >
          <span>
            <strong>Move up one level</strong>
            <small>{{ deleting?.parentId ? `They move under “${store.projectById.get(deleting.parentId)?.name}”.` : 'They become top-level projects.' }}</small>
          </span>
        </label>
        <label class="choice">
          <input v-model="subMode" type="radio" name="sub-mode" value="delete" data-testid="delete-sub-delete" >
          <span>
            <strong>Delete them too</strong>
            <small>All {{ deletingScope.size - 1 }} sub-project{{ deletingScope.size === 2 ? '' : 's' }} (at every level) are deleted.</small>
          </span>
        </label>
      </fieldset>
      <p v-if="deletingCount === 0">{{ deletingChildren && subMode === 'delete' ? 'These projects have' : 'This project has' }} no tasks.</p>
      <fieldset v-else class="choices">
        <legend>{{ subMode === 'delete' && deletingChildren ? 'These projects have' : 'This project has' }} {{ deletingCount }} task{{ deletingCount === 1 ? '' : 's' }}. What should happen to {{ deletingCount === 1 ? 'it' : 'them' }}?</legend>
        <label class="choice">
          <input v-model="deleteMode" type="radio" name="delete-mode" value="unassign" >
          <span>
            <strong>Move to “No project”</strong>
            <small>Tasks are kept without a project.</small>
          </span>
        </label>
        <label class="choice">
          <input v-model="deleteMode" type="radio" name="delete-mode" value="delete" >
          <span>
            <strong>Delete the tasks</strong>
            <small>All {{ deletingCount }} task{{ deletingCount === 1 ? '' : 's' }} will be deleted.</small>
          </span>
        </label>
      </fieldset>
      <template #footer>
        <button type="button" class="btn" @click="deleting = null">Cancel</button>
        <button type="button" class="btn btn-danger" data-testid="delete-project-confirm" @click="confirmDelete">Delete project</button>
      </template>
    </BaseModal>

    <BaseModal :open="!!moving" :title="`Move “${moving?.name ?? ''}”`" size="sm" @close="moving = null">
      <form id="move-project-form" class="field" novalidate @submit.prevent="confirmMove">
        <label for="move-parent">Parent project</label>
        <select id="move-parent" v-model="moveParent" class="select" data-testid="move-parent" :aria-invalid="moveError ? 'true' : 'false'">
          <option value="">None (top level)</option>
          <option v-for="o in parentOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
        </select>
        <p v-if="moveError" class="field-error" role="alert">{{ moveError }}</p>
        <p v-else class="field-hint">Sub-projects move with it. Tasks of a project that inherits its workflow switch to the new parent's statuses (matched by category).</p>
      </form>
      <template #footer>
        <button type="button" class="btn" @click="moving = null">Cancel</button>
        <button type="submit" form="move-project-form" class="btn btn-primary" data-testid="move-project-confirm">Move</button>
      </template>
    </BaseModal>

    <BaseModal :open="!!workflowFor" :title="`Workflow · ${workflowFor?.name ?? ''}`" size="md" @close="workflowFor = null">
      <WorkflowEditor v-if="workflowFor" :project-id="workflowFor.id" />
      <template #footer>
        <NuxtLink v-if="workflowFor" :to="`/board?project=${workflowFor.id}`" class="btn">Open board</NuxtLink>
        <button type="button" class="btn btn-primary" @click="workflowFor = null">Done</button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.create {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px 18px;
  padding: 16px;
  margin-bottom: 20px;
}

.grow {
  flex: 1 1 220px;
}

.full {
  flex-basis: 100%;
}

.colors {
  border: 0;
  margin: 0;
  padding: 0;
}

.colors legend {
  padding: 0;
  margin-bottom: 6px;
}

.swatches {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.swatch {
  position: relative;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  display: grid;
  place-items: center;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
}

.swatch.on {
  outline: 2px solid var(--text);
  outline-offset: 2px;
}

.swatch:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.custom {
  background: var(--surface-2);
  color: var(--text-muted);
  border: 1px dashed var(--border-strong);
}

.color-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: 0;
  padding: 0;
}

.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.proj {
  position: relative;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-left: 4px solid var(--pc);
  margin-left: calc(var(--depth, 0) * 28px);
}

/* tree connector to the parent */
.proj.sub::before {
  content: '';
  position: absolute;
  left: -20px;
  top: -10px;
  width: 14px;
  height: 34px;
  border-left: 2px solid var(--border-strong);
  border-bottom: 2px solid var(--border-strong);
  border-bottom-left-radius: 6px;
}

.subs-count {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 550;
  color: var(--text-subtle);
}

.parent-field {
  width: 200px;
}

.wf-chip {
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
}

.wf-chip:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.proj-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}

.color-btn {
  position: relative;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: var(--pc);
  flex: none;
  cursor: pointer;
}

.color-btn:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.pname {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pname a {
  color: var(--text);
}

.pactions {
  display: flex;
}

.rename {
  flex: 1;
  display: flex;
  gap: 6px;
  min-width: 0;
}

.rename .input {
  height: 30px;
}

.stats {
  display: flex;
  gap: 16px;
  color: var(--text-muted);
  font-size: 13px;
}

.stats strong {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.progress {
  height: 8px;
  border-radius: 4px;
  background: var(--surface-2);
  overflow: hidden;
}

.progress span {
  display: block;
  height: 100%;
  background: var(--pc);
  border-radius: 4px;
  transition: width 0.3s;
}

.pfoot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  justify-content: space-between;
  font-size: 12.5px;
}

.pct {
  font-weight: 650;
}

.small {
  font-size: 12.5px;
}

.unassigned {
  margin-top: 16px;
  font-size: 13px;
}

.choices {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.choices legend {
  padding: 0;
  margin-bottom: 10px;
}

.choice {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.choice:has(input:checked) {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.choice input {
  margin-top: 3px;
  accent-color: var(--accent);
}

.choice span {
  display: flex;
  flex-direction: column;
}

.choice small {
  color: var(--text-muted);
}

@media (max-width: 767px) {
  .proj {
    margin-left: calc(var(--depth, 0) * 14px);
  }

  .proj.sub::before {
    display: none;
  }

  .parent-field {
    width: 100%;
  }
}
</style>
