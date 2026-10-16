<script setup lang="ts">
import type { TaskQuery } from '~/lib/filters';
import type { SavedView } from '~/lib/types';
import { VIEW_NAME_MAX, boardQueryOf, describeQuery, findMatchingView, ignoredOnBoard, suggestViewName, validateViewName, viewQueryOf } from '~/lib/views';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

/** Saved-view controls for the task list: save the current query, or rename/delete/open-on-board the matching view. */
const props = defineProps<{ query: TaskQuery }>();
const store = useTaskStore();
const ui = useUiStore();

const lookups = computed(() => ({ projects: store.projectById, members: store.memberById }));
const active = computed(() => findMatchingView(store.views, props.query));
const currentQuery = computed(() => viewQueryOf(props.query));
const summary = computed(() => describeQuery(currentQuery.value, lookups.value));
const boardLink = computed(() => (active.value ? { path: '/board', query: boardQueryOf(active.value.query) } : null));
const boardNote = computed(() => {
  const ignored = active.value ? ignoredOnBoard(active.value.query) : [];
  return ignored.length ? `The board ignores the view's ${ignored.join(' and ')}.` : '';
});

// ----- name dialog (save / rename) -----
const dialog = ref<{ mode: 'save' | 'rename'; view?: SavedView } | null>(null);
const name = ref('');
const error = ref('');

function openSave(): void {
  dialog.value = { mode: 'save' };
  name.value = suggestViewName(currentQuery.value, lookups.value);
  error.value = '';
}

function openRename(v: SavedView): void {
  dialog.value = { mode: 'rename', view: v };
  name.value = v.name;
  error.value = '';
}

function submit(): void {
  const d = dialog.value;
  if (!d) return;
  error.value = validateViewName(name.value, store.views, d.view?.id);
  if (error.value) return;
  if (d.mode === 'save') {
    const v = store.createView(name.value, currentQuery.value);
    ui.toast(`Saved view “${v.name}”`, { kind: 'success', actionLabel: 'Undo', action: () => store.undo() });
  } else if (d.view && name.value.trim() !== d.view.name) {
    store.renameView(d.view.id, name.value);
    ui.toast('View renamed', { kind: 'success', duration: 3000, actionLabel: 'Undo', action: () => store.undo() });
  }
  dialog.value = null;
}

function remove(v: SavedView): void {
  store.deleteView(v.id);
  ui.toast(`Deleted view “${v.name}”`, { actionLabel: 'Undo', action: () => store.undo() });
}
</script>

<template>
  <div class="viewbar" :class="{ on: active }" data-testid="view-bar">
    <template v-if="active">
      <AppIcon name="bookmark" :size="15" />
      <span class="vname" data-testid="active-view-name">{{ active.name }}</span>
      <span class="summary muted" :title="summary">{{ summary }}</span>
      <div class="actions">
        <NuxtLink v-if="boardLink" :to="boardLink" class="btn btn-sm btn-ghost" :title="boardNote || undefined" data-testid="view-open-board">
          <AppIcon name="board" :size="14" />
          Open on board
        </NuxtLink>
        <button type="button" class="btn btn-sm btn-ghost" :aria-label="`Rename view “${active.name}”`" data-testid="view-rename" @click="openRename(active)">
          <AppIcon name="edit" :size="14" />
          <span class="txt">Rename</span>
        </button>
        <button type="button" class="btn btn-sm btn-ghost" :aria-label="`Delete view “${active.name}”`" data-testid="view-delete" @click="remove(active)">
          <AppIcon name="trash" :size="14" />
          <span class="txt">Delete</span>
        </button>
      </div>
    </template>
    <template v-else>
      <span class="summary muted" :title="summary">{{ summary }}</span>
      <div class="actions">
        <button type="button" class="btn btn-sm" data-testid="save-view-button" @click="openSave">
          <AppIcon name="bookmark" :size="14" />
          Save view
        </button>
      </div>
    </template>

    <BaseModal :open="!!dialog" :title="dialog?.mode === 'rename' ? 'Rename view' : 'Save view'" size="sm" @close="dialog = null">
      <form id="view-name-form" novalidate @submit.prevent="submit">
        <div class="field">
          <label for="view-name">Name</label>
          <input
            id="view-name"
            v-model="name"
            class="input"
            type="text"
            :maxlength="VIEW_NAME_MAX + 20"
            autocomplete="off"
            data-autofocus
            data-testid="view-name-input"
            :aria-invalid="error ? 'true' : 'false'"
            :aria-describedby="error ? 'view-name-err' : 'view-name-hint'"
          >
          <p v-if="error" id="view-name-err" class="field-error" role="alert">{{ error }}</p>
          <p v-else id="view-name-hint" class="field-hint">{{ dialog?.mode === 'rename' ? describeQuery(dialog.view?.query ?? {}, lookups) : summary }}</p>
        </div>
      </form>
      <template #footer>
        <button type="button" class="btn" @click="dialog = null">Cancel</button>
        <button type="submit" form="view-name-form" class="btn btn-primary" data-testid="view-name-save">{{ dialog?.mode === 'rename' ? 'Rename' : 'Save view' }}</button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.viewbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  min-width: 0;
}

.viewbar.on {
  padding: 4px 4px 4px 12px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent-text);
}

.vname {
  font-weight: 650;
  white-space: nowrap;
}

.summary {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 4px;
  flex: none;
}

@media (max-width: 767px) {
  .viewbar {
    flex-wrap: wrap;
  }

  .summary {
    flex-basis: 100%;
    order: 3;
  }

  .actions {
    margin-left: auto;
  }

  .txt {
    display: none;
  }
}
</style>
