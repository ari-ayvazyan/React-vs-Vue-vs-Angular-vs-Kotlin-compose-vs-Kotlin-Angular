<script setup lang="ts">
import type { Task } from '~/lib/types';
import { PRIORITIES, PRIORITY_LABELS, RECURRENCES, RECURRENCE_LABELS } from '~/lib/types';
import { LIMITS, hasErrors, normalizeTags, validateTaskDraft } from '~/lib/validation';
import type { TaskDraft, TaskErrors, TaskFormValue } from '~/lib/validation';
import { useTaskStore } from '~/stores/tasks';


const props = withDefaults(
  defineProps<{
    task?: Task | null;
    /** `statusId` may also be a category name; it is resolved in the project's workflow */
    defaults?: Partial<Pick<Task, 'statusId' | 'projectId' | 'dueDate' | 'assigneeId'>>;
    formId: string;
    autofocus?: boolean;
    /** expose benchmark test ids (only the global modal form does) */
    testids?: boolean;
  }>(),
  { task: null, defaults: () => ({}), autofocus: false, testids: false },
);
const emit = defineEmits<{ submit: [value: TaskFormValue] }>();

const store = useTaskStore();
const uidBase = useId();

function initialDraft(): TaskDraft {
  const t = props.task;
  return {
    title: t?.title ?? '',
    description: t?.description ?? '',
    statusId: t ? t.statusId : store.workflows.resolve(props.defaults.projectId ?? null, props.defaults.statusId ?? 'todo').id,
    priority: t?.priority ?? 'medium',
    projectId: t ? t.projectId : (props.defaults.projectId ?? null),
    tags: t ? [...t.tags] : [],
    dueDate: t ? t.dueDate : (props.defaults.dueDate ?? null),
    estimate: t?.estimateMinutes ? String(t.estimateMinutes) : '',
    assigneeId: t ? t.assigneeId : (props.defaults.assigneeId ?? null),
    recurrence: t?.recurrence ?? 'none',
  };
}

const draft = reactive<TaskDraft>(initialDraft());
const tagInput = ref('');
const errors = ref<TaskErrors>({});
const submitted = ref(false);

function draftFrom(t: Task): TaskDraft {
  return {
    title: t.title,
    description: t.description,
    statusId: t.statusId,
    priority: t.priority,
    projectId: t.projectId,
    tags: [...t.tags],
    dueDate: t.dueDate,
    estimate: t.estimateMinutes ? String(t.estimateMinutes) : '',
    assigneeId: t.assigneeId,
    recurrence: t.recurrence,
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// When the underlying task changes elsewhere (status select, undo, pomodoro…), update only the
// fields the user has not edited, so unsaved input is never clobbered.
watch(
  () => props.task,
  (next, prev) => {
    if (!next || !prev || next.id !== prev.id) {
      Object.assign(draft, initialDraft());
      errors.value = {};
      submitted.value = false;
      return;
    }
    const before = draftFrom(prev);
    const after = draftFrom(next);
    for (const key of Object.keys(after) as (keyof TaskDraft)[]) {
      if (same(draft[key], before[key]) && !same(before[key], after[key])) {
        (draft as Record<keyof TaskDraft, unknown>)[key] = after[key];
      }
    }
  },
);

/** Statuses offered: the workflow of the selected project. */
const statusOptions = computed(() => store.workflows.workflowOf(draft.projectId));
// Changing the project can change the workflow: keep the status if it exists there, otherwise use the first
// status of the same category.
watch(
  () => draft.projectId,
  (pid, old) => {
    if (statusOptions.value.some((s) => s.id === draft.statusId)) return;
    const category = store.workflows.statusOf(old ?? null, draft.statusId)?.category ?? 'todo';
    draft.statusId = store.workflows.resolve(pid, category).id;
  },
);

// Live validation after the first submit attempt.
watch(
  draft,
  () => {
    if (submitted.value) errors.value = validateTaskDraft(draft);
  },
  { deep: true },
);

function addTagsFromInput(): void {
  if (!tagInput.value.trim()) return;
  draft.tags = normalizeTags([...draft.tags, ...tagInput.value.split(',')]);
  tagInput.value = '';
}

function onTagKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTagsFromInput();
  } else if (e.key === 'Backspace' && !tagInput.value && draft.tags.length) {
    draft.tags = draft.tags.slice(0, -1);
  }
}

function removeTag(tag: string): void {
  draft.tags = draft.tags.filter((t) => t !== tag);
}

function onSubmit(): void {
  addTagsFromInput();
  submitted.value = true;
  errors.value = validateTaskDraft(draft);
  if (hasErrors(errors.value)) {
    nextTick(() => {
      const firstInvalid = document.querySelector<HTMLElement>(`#${CSS.escape(props.formId)} [aria-invalid="true"]`);
      firstInvalid?.focus();
    });
    return;
  }
  emit('submit', {
    title: draft.title.trim(),
    description: draft.description,
    statusId: draft.statusId,
    priority: draft.priority,
    projectId: draft.projectId,
    tags: normalizeTags(draft.tags),
    dueDate: draft.dueDate || null,
    estimateMinutes: draft.estimate.trim() ? Number(draft.estimate) : null,
    // a member deleted while the form was open falls back to unassigned
    assigneeId: draft.assigneeId && store.memberById.has(draft.assigneeId) ? draft.assigneeId : null,
    recurrence: draft.recurrence,
  });
}

function reset(): void {
  Object.assign(draft, initialDraft());
  errors.value = {};
  submitted.value = false;
}

defineExpose({ reset });

const id = (name: string): string => `${uidBase}-${name}`;
</script>

<template>
  <form :id="formId" class="form" novalidate @submit.prevent="onSubmit">
    <div class="field">
      <label :for="id('title')">Title <span aria-hidden="true" class="req">*</span></label>
      <input
        :id="id('title')"
        v-model="draft.title"
        class="input"
        type="text"
        :data-testid="testids ? 'task-title-input' : undefined"
        placeholder="What needs to be done?"
        :aria-invalid="errors.title ? 'true' : 'false'"
        :aria-describedby="errors.title ? id('title-err') : undefined"
        :data-autofocus="autofocus ? '' : undefined"
        required
        autocomplete="off"
      >
      <p v-if="errors.title" :id="id('title-err')" class="field-error" role="alert">{{ errors.title }}</p>
    </div>

    <div class="field">
      <label :for="id('desc')">Description</label>
      <textarea
        :id="id('desc')"
        v-model="draft.description"
        class="textarea"
        rows="4"
        placeholder="Add more details…"
        :aria-invalid="errors.description ? 'true' : 'false'"
        :aria-describedby="id('desc-hint')"
      />
      <div class="row-between">
        <p v-if="errors.description" class="field-error" role="alert">{{ errors.description }}</p>
        <span v-else />
        <p :id="id('desc-hint')" class="field-hint" :class="{ over: draft.description.length > LIMITS.description }">
          {{ draft.description.length }}/{{ LIMITS.description }}
        </p>
      </div>
    </div>

    <div class="grid">
      <div class="field">
        <label :for="id('status')">Status</label>
        <select :id="id('status')" v-model="draft.statusId" class="select" data-testid="task-status-select">
          <option v-for="s in statusOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div class="field">
        <label :for="id('priority')">Priority</label>
        <select :id="id('priority')" v-model="draft.priority" class="select">
          <option v-for="p in PRIORITIES" :key="p" :value="p">{{ PRIORITY_LABELS[p] }}</option>
        </select>
      </div>
      <div class="field">
        <label :for="id('project')">Project</label>
        <select :id="id('project')" v-model="draft.projectId" class="select">
          <option :value="null">No project</option>
          <option v-for="p in store.projectOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </div>
      <div class="field">
        <label :for="id('due')">Due date</label>
        <input :id="id('due')" v-model="draft.dueDate" class="input" type="date" :aria-invalid="errors.dueDate ? 'true' : 'false'" >
        <p v-if="errors.dueDate" class="field-error" role="alert">{{ errors.dueDate }}</p>
      </div>
      <div class="field">
        <label :for="id('estimate')">Estimate (minutes)</label>
        <input
          :id="id('estimate')"
          v-model="draft.estimate"
          class="input"
          type="text"
          inputmode="numeric"
          placeholder="e.g. 60"
          :aria-invalid="errors.estimate ? 'true' : 'false'"
          :aria-describedby="errors.estimate ? id('est-err') : undefined"
        >
        <p v-if="errors.estimate" :id="id('est-err')" class="field-error" role="alert">{{ errors.estimate }}</p>
      </div>
      <div class="field">
        <label :for="id('assignee')">Assignee</label>
        <select :id="id('assignee')" v-model="draft.assigneeId" class="select" data-testid="task-assignee-select">
          <option :value="null">Unassigned</option>
          <option v-for="m in store.members" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </div>
      <div class="field">
        <label :for="id('recurrence')">Repeat</label>
        <select :id="id('recurrence')" v-model="draft.recurrence" class="select" :aria-describedby="draft.recurrence !== 'none' ? id('rec-hint') : undefined" data-testid="task-recurrence-select">
          <option v-for="r in RECURRENCES" :key="r" :value="r">{{ RECURRENCE_LABELS[r] }}</option>
        </select>
        <p v-if="draft.recurrence !== 'none'" :id="id('rec-hint')" class="field-hint">Completing it creates the next one.</p>
      </div>
    </div>

    <div class="field">
      <label :for="id('tags')">Tags</label>
      <div class="tag-box" :class="{ invalid: errors.tags }">
        <span v-for="t in draft.tags" :key="t" class="tag tag-chip">
          {{ t }}
          <button type="button" class="chip-x" :aria-label="`Remove tag ${t}`" @click="removeTag(t)">
            <AppIcon name="x" :size="12" />
          </button>
        </span>
        <input
          :id="id('tags')"
          v-model="tagInput"
          class="tag-input"
          type="text"
          :placeholder="draft.tags.length ? '' : 'Type a tag and press Enter'"
          list="taskpilot-tag-suggestions"
          :aria-invalid="errors.tags ? 'true' : 'false'"
          :aria-describedby="id('tags-hint')"
          autocomplete="off"
          @keydown="onTagKeydown"
          @blur="addTagsFromInput"
        >
        <datalist id="taskpilot-tag-suggestions">
          <option v-for="t in store.allTags" :key="t" :value="t" />
        </datalist>
      </div>
      <p v-if="errors.tags" class="field-error" role="alert">{{ errors.tags }}</p>
      <p v-else :id="id('tags-hint')" class="field-hint">Lower-case, up to {{ LIMITS.tags }} tags. Separate with Enter or comma.</p>
    </div>
  </form>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}

.req {
  color: var(--danger);
}

.row-between {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.over {
  color: var(--danger);
  font-weight: 600;
}

.tag-box {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-height: 36px;
  padding: 5px 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.tag-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

.tag-box.invalid {
  border-color: var(--danger);
}

.tag-chip {
  gap: 2px;
  padding-right: 2px;
}

.chip-x {
  display: inline-flex;
  border: 0;
  background: none;
  padding: 2px;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
}

.chip-x:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.tag-input {
  flex: 1;
  min-width: 120px;
  border: 0;
  outline: none;
  background: transparent;
  height: 24px;
}
</style>
