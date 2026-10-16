<script setup lang="ts">
import type { Subtask } from '~/lib/types';
import { RECURRENCE_LABELS } from '~/lib/types';
import { ancestorIds } from '~/lib/projects';
import type { TaskFormValue } from '~/lib/validation';
import { formatDate, formatMinutes } from '~/lib/dates';
import { uid } from '~/lib/taskOps';
import { isOverdue } from '~/lib/filters';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

const route = useRoute();
const store = useTaskStore();
const ui = useUiStore();

const id = computed(() => String(route.params.id));
const task = computed(() => store.taskById.get(id.value));
const project = computed(() => (task.value?.projectId ? store.projectById.get(task.value.projectId) : undefined));
/** "Parent / Child" for sub-projects */
const projectPath = computed(() =>
  project.value
    ? [...ancestorIds(store.projectById, project.value.id).reverse().map((id) => store.projectById.get(id)?.name ?? ''), project.value.name].join(' / ')
    : '',
);
const workflow = computed(() => store.workflows.workflowOf(task.value?.projectId ?? null));
const statusName = computed(() => (task.value ? (store.workflows.statusOf(task.value.projectId, task.value.statusId)?.name ?? task.value.statusId) : ''));
const assignee = computed(() => (task.value?.assigneeId ? store.memberById.get(task.value.assigneeId) : undefined));

useHead({ title: () => (task.value ? `${task.value.title} · TaskPilot` : 'Task · TaskPilot') });

const formKey = ref(0);
function onSave(v: TaskFormValue): void {
  if (!task.value) return;
  if (store.updateTask(task.value.id, v)) ui.toast('Changes saved', { kind: 'success', duration: 3000 });
}

function resetForm(): void {
  formKey.value++;
}

function setStatus(e: Event): void {
  if (!task.value) return;
  const select = e.target as HTMLSelectElement;
  // refused (open blockers): put the select back, the store explains why in a toast
  if (!store.updateTask(task.value.id, { statusId: select.value })) select.value = task.value.statusId;
}

function remove(): void {
  if (!task.value) return;
  const title = task.value.title;
  store.deleteTasks([task.value.id]);
  void navigateTo('/tasks');
  ui.toast(`Deleted “${title}”`, { actionLabel: 'Undo', action: () => store.undo() });
}

// ----- subtasks -----
const newSubtask = ref('');
const subtaskError = ref('');
const subtasks = computed(() => task.value?.subtasks ?? []);
const subDone = computed(() => subtasks.value.filter((s) => s.done).length);

function saveSubtasks(list: Subtask[]): void {
  if (task.value) store.updateTask(task.value.id, { subtasks: list });
}

function addSubtask(): void {
  const title = newSubtask.value.trim();
  if (!title) {
    subtaskError.value = 'Subtask title is required.';
    return;
  }
  if (title.length > 120) {
    subtaskError.value = 'Subtask title must be at most 120 characters.';
    return;
  }
  subtaskError.value = '';
  saveSubtasks([...subtasks.value, { id: uid('s'), title, done: false }]);
  newSubtask.value = '';
}

function toggleSubtask(sid: string): void {
  saveSubtasks(subtasks.value.map((s) => (s.id === sid ? { ...s, done: !s.done } : s)));
}

function renameSubtask(sid: string, e: Event): void {
  const title = (e.target as HTMLInputElement).value.trim();
  const current = subtasks.value.find((s) => s.id === sid);
  if (!current) return;
  if (!title || title.length > 120) {
    (e.target as HTMLInputElement).value = current.title;
    return;
  }
  if (title !== current.title) saveSubtasks(subtasks.value.map((s) => (s.id === sid ? { ...s, title } : s)));
}

function removeSubtask(sid: string): void {
  saveSubtasks(subtasks.value.filter((s) => s.id !== sid));
}
</script>

<template>
  <div class="page">
    <NuxtLink to="/tasks" class="back">
      <AppIcon name="arrowLeft" :size="15" />
      All tasks
    </NuxtLink>

    <PageLoading v-if="!store.ready" />

    <div v-else-if="!task" class="card notfound">
      <h1 class="page-title">Task not found</h1>
      <p class="muted">The task <code>{{ id }}</code> doesn’t exist or was deleted.</p>
      <div class="nf-actions">
        <button v-if="store.canUndo" type="button" class="btn" @click="store.undo()">
          <AppIcon name="undo" :size="15" />
          Undo last change
        </button>
        <NuxtLink to="/tasks" class="btn btn-primary">Back to tasks</NuxtLink>
      </div>
    </div>

    <template v-else>
      <div class="head">
        <div class="head-main">
          <div class="crumbs">
            <span v-if="project" class="proj"><span class="dot" :style="{ background: project.color }" />{{ projectPath }}</span>
            <PriorityBadge :priority="task.priority" />
            <span v-if="isOverdue(task, store.today)" class="badge badge-danger">Overdue</span>
            <BlockedBadge v-if="store.blockedIds.has(task.id)" :task="task" />
            <RecurrenceIcon :recurrence="task.recurrence" show-label />
            <span v-if="assignee" class="who">
              <MemberAvatar :member-id="task.assigneeId" :size="22" />
              {{ assignee.name }}
            </span>
          </div>
          <h1 class="page-title title" :class="{ done: task.status === 'done' }">{{ task.title }}</h1>
        </div>
        <div class="head-actions">
          <label for="detail-status" class="sr-only">Status</label>
          <select id="detail-status" class="select status-select" :class="`st-${task.status}`" :value="task.statusId" @change="setStatus">
            <option v-for="s in workflow" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <button type="button" class="btn btn-danger" @click="remove">
            <AppIcon name="trash" :size="15" />
            Delete
          </button>
        </div>
      </div>

      <div class="layout">
        <div class="col-main">
          <section class="card" aria-labelledby="edit-title">
            <div class="card-header">
              <h2 id="edit-title" class="card-title">Details</h2>
            </div>
            <div class="card-body">
              <TaskForm :key="`${task.id}-${formKey}`" form-id="task-detail-form" :task="task" @submit="onSave" />
              <div class="form-actions">
                <button type="button" class="btn" @click="resetForm">Discard changes</button>
                <button type="submit" form="task-detail-form" class="btn btn-primary">Save changes</button>
              </div>
            </div>
          </section>

          <section class="card" aria-labelledby="sub-title">
            <div class="card-header">
              <h2 id="sub-title" class="card-title">Subtasks</h2>
              <span v-if="subtasks.length" class="muted small">{{ subDone }}/{{ subtasks.length }} done</span>
            </div>
            <div class="card-body">
              <div v-if="subtasks.length" class="sub-progress" role="progressbar" :aria-valuenow="subDone" aria-valuemin="0" :aria-valuemax="subtasks.length" aria-label="Subtask progress">
                <span :style="{ width: `${(subDone / subtasks.length) * 100}%` }" />
              </div>
              <ul class="subs">
                <li v-for="s in subtasks" :key="s.id" class="sub" :class="{ done: s.done }">
                  <input :id="`sub-${s.id}`" type="checkbox" class="checkbox" :checked="s.done" :aria-label="`Mark subtask “${s.title}” ${s.done ? 'not done' : 'done'}`" @change="toggleSubtask(s.id)" >
                  <input
                    class="sub-title"
                    type="text"
                    :value="s.title"
                    :aria-label="`Subtask title: ${s.title}`"
                    maxlength="120"
                    @change="renameSubtask(s.id, $event)"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  >
                  <button type="button" class="btn btn-ghost btn-icon btn-sm" :aria-label="`Delete subtask “${s.title}”`" @click="removeSubtask(s.id)">
                    <AppIcon name="trash" :size="14" />
                  </button>
                </li>
              </ul>
              <form class="add-sub" @submit.prevent="addSubtask">
                <label for="new-subtask" class="sr-only">New subtask</label>
                <input
                  id="new-subtask"
                  v-model="newSubtask"
                  class="input"
                  type="text"
                  placeholder="Add a subtask…"
                  :aria-invalid="subtaskError ? 'true' : 'false'"
                  :aria-describedby="subtaskError ? 'new-subtask-err' : undefined"
                >
                <button type="submit" class="btn">
                  <AppIcon name="plus" :size="15" />
                  Add
                </button>
              </form>
              <p v-if="subtaskError" id="new-subtask-err" class="field-error" role="alert">{{ subtaskError }}</p>
            </div>
          </section>
          <TaskDependencies :task="task" />
          <TaskComments :task="task" />
        </div>

        <aside class="col-side">
          <PomodoroTimer :task-id="task.id" />
          <section class="card" aria-labelledby="info-title">
            <div class="card-header">
              <h2 id="info-title" class="card-title">Info</h2>
            </div>
            <dl class="card-body info">
              <div><dt>Status</dt><dd>{{ statusName }}</dd></div>
              <div>
                <dt>Assignee</dt>
                <dd class="assignee-dd">
                  <template v-if="assignee"><MemberAvatar :member-id="task.assigneeId" :size="20" />{{ assignee.name }}</template>
                  <template v-else>Unassigned</template>
                </dd>
              </div>
              <div><dt>Repeats</dt><dd>{{ task.recurrence === 'none' ? 'No' : RECURRENCE_LABELS[task.recurrence] }}</dd></div>
              <div><dt>Due</dt><dd><DueLabel :due="task.dueDate" :status="task.status" /></dd></div>
              <div><dt>Estimate</dt><dd>{{ task.estimateMinutes ? formatMinutes(task.estimateMinutes) : '—' }}</dd></div>
              <div><dt>Time spent</dt><dd>{{ formatMinutes(task.timeSpentMinutes) }}</dd></div>
              <div><dt>Created</dt><dd>{{ formatDate(task.createdAt, { year: 'numeric', month: 'short', day: 'numeric' }) }}</dd></div>
              <div v-if="task.completedAt"><dt>Completed</dt><dd>{{ formatDate(task.completedAt, { year: 'numeric', month: 'short', day: 'numeric' }) }}</dd></div>
            </dl>
          </section>
          <TaskActivity :task-id="task.id" />
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-weight: 550;
  margin-bottom: 14px;
}

.notfound {
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.nf-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

code {
  font-family: var(--font-mono);
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: 4px;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.head-main {
  min-width: 0;
  flex: 1;
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.who,
.assignee-dd {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.who {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}

.proj {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}

.title {
  overflow-wrap: anywhere;
}

.title.done {
  text-decoration: line-through;
  color: var(--text-muted);
}

.head-actions {
  display: flex;
  gap: 8px;
}

.status-select {
  width: auto;
  font-weight: 600;
}

.st-done {
  color: var(--success);
}

.st-in_progress {
  color: var(--s-in_progress);
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 18px;
  align-items: start;
}

.col-main,
.col-side {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.small {
  font-size: 12.5px;
}

.sub-progress {
  height: 6px;
  border-radius: 3px;
  background: var(--surface-2);
  overflow: hidden;
  margin-bottom: 12px;
}

.sub-progress span {
  display: block;
  height: 100%;
  background: var(--s-done);
  transition: width 0.2s;
}

.subs {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sub {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px;
  border-radius: 8px;
}

.sub:hover {
  background: var(--surface-hover);
}

.sub-title {
  flex: 1;
  min-width: 0;
  border: 1px solid transparent;
  background: transparent;
  padding: 5px 8px;
  border-radius: 6px;
}

.sub-title:hover {
  border-color: var(--border);
}

.sub-title:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--surface);
}

.sub.done .sub-title {
  text-decoration: line-through;
  color: var(--text-subtle);
}

.add-sub {
  display: flex;
  gap: 8px;
}

.info {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.info div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.info dt {
  color: var(--text-muted);
}

.info dd {
  margin: 0;
  font-weight: 550;
  text-align: right;
}

@media (max-width: 1000px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .col-side {
    order: -1;
  }
}
</style>
