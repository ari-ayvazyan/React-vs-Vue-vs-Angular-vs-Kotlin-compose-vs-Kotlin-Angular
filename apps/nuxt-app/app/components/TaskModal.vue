<script setup lang="ts">
import type { TaskFormValue } from '~/lib/validation';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

const ui = useUiStore();
const store = useTaskStore();

const editing = computed(() => (ui.taskModal.taskId ? (store.taskById.get(ui.taskModal.taskId) ?? null) : null));
const title = computed(() => (editing.value ? 'Edit task' : 'New task'));

function onSubmit(v: TaskFormValue): void {
  if (editing.value) {
    // refused (e.g. completing a task with open blockers): the store shows why; keep the form open
    if (!store.updateTask(editing.value.id, v)) return;
    ui.toast('Task updated', { kind: 'success', duration: 3000 });
  } else {
    const t = store.createTask(v);
    ui.toast(`Created “${t.title}”`, {
      kind: 'success',
      actionLabel: 'Open',
      action: () => navigateTo(`/tasks/${t.id}`),
    });
  }
  ui.closeTaskModal();
}
</script>

<template>
  <BaseModal :open="ui.taskModal.open" :title="title" testid="task-modal" size="md" @close="ui.closeTaskModal()">
    <TaskForm
      v-if="ui.taskModal.open"
      form-id="task-modal-form"
      :task="editing"
      :defaults="ui.taskModal.defaults"
      autofocus
      testids
      @submit="onSubmit"
    />
    <template #footer>
      <button type="button" class="btn" @click="ui.closeTaskModal()">Cancel</button>
      <button type="submit" form="task-modal-form" class="btn btn-primary" data-testid="task-save-button">
        {{ editing ? 'Save changes' : 'Create task' }}
      </button>
    </template>
  </BaseModal>
</template>
