<script setup lang="ts">
import type { Member } from '~/lib/types';
import { MEMBER_COLORS, MEMBER_NAME_MAX, validateMemberName } from '~/lib/members';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

const store = useTaskStore();
const ui = useUiStore();

/** Task counts per member id, computed in one pass. */
const counts = computed(() => {
  const map = new Map<string, { total: number; open: number }>();
  for (const t of store.tasks) {
    if (!t.assigneeId) continue;
    const c = map.get(t.assigneeId) ?? { total: 0, open: 0 };
    c.total++;
    if (t.status !== 'done') c.open++;
    map.set(t.assigneeId, c);
  }
  return map;
});
const countFor = (id: string): { total: number; open: number } => counts.value.get(id) ?? { total: 0, open: 0 };

function setCurrentUser(e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  store.updateSettings({ currentUserId: v || null });
}

const nextPreset = (): string => MEMBER_COLORS[store.members.length % MEMBER_COLORS.length] as string;

// ----- add -----
const newName = ref('');
const newColor = ref(nextPreset());
const addError = ref('');

function add(): void {
  addError.value = validateMemberName(newName.value, store.members);
  if (addError.value) return;
  const m = store.createMember(newName.value, newColor.value);
  ui.toast(`Added “${m.name}” to the team`, { kind: 'success', actionLabel: 'Undo', action: () => store.undo() });
  newName.value = '';
  newColor.value = nextPreset();
}

// ----- rename -----
const editingId = ref<string | null>(null);
const editName = ref('');
const editError = ref('');

async function startEdit(m: Member): Promise<void> {
  editingId.value = m.id;
  editName.value = m.name;
  editError.value = '';
  await nextTick();
  document.getElementById(`member-rename-${m.id}`)?.focus();
}

function saveEdit(m: Member): void {
  editError.value = validateMemberName(editName.value, store.members, m.id);
  if (editError.value) return;
  if (editName.value.trim() !== m.name) store.updateMember(m.id, { name: editName.value });
  editingId.value = null;
}

function recolor(m: Member, e: Event): void {
  const color = (e.target as HTMLInputElement).value;
  if (color !== m.color) store.updateMember(m.id, { color });
}

// ----- delete -----
const deleting = ref<Member | null>(null);

function confirmDelete(): void {
  const m = deleting.value;
  if (!m) return;
  const n = countFor(m.id).total;
  store.deleteMember(m.id);
  deleting.value = null;
  ui.toast(n ? `Removed “${m.name}” and unassigned ${n} task${n === 1 ? '' : 's'}` : `Removed “${m.name}”`, {
    actionLabel: 'Undo',
    action: () => store.undo(),
  });
}
</script>

<template>
  <section id="team" class="card" aria-labelledby="s-team">
    <div class="card-header">
      <h2 id="s-team" class="card-title">Team members</h2>
      <span class="muted small">{{ store.members.length }} member{{ store.members.length === 1 ? '' : 's' }}</span>
    </div>
    <div class="card-body">
      <div class="field me">
        <label for="current-user">Current user</label>
        <select id="current-user" class="select" :value="store.currentUser?.id ?? ''" data-testid="current-user-select" @change="setCurrentUser">
          <option value="">Nobody (comments disabled)</option>
          <option v-for="m in store.members" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
        <p class="field-hint">Comments are posted as this member and changes are recorded under their name in the activity log.</p>
      </div>
      <ul v-if="store.members.length" class="members">
        <li v-for="m in store.members" :key="m.id" class="member" data-testid="member-row">
          <label class="avatar-btn" :title="`Change colour of ${m.name}`">
            <MemberAvatar :member-id="m.id" :size="32" />
            <span class="sr-only">Colour for {{ m.name }}</span>
            <input type="color" class="color-input" :value="m.color" @change="recolor(m, $event)" >
          </label>
          <form v-if="editingId === m.id" class="rename" novalidate @submit.prevent="saveEdit(m)">
            <label :for="`member-rename-${m.id}`" class="sr-only">Member name</label>
            <input
              :id="`member-rename-${m.id}`"
              v-model="editName"
              class="input"
              type="text"
              :maxlength="MEMBER_NAME_MAX + 20"
              :aria-invalid="editError ? 'true' : 'false'"
              :aria-describedby="editError ? `member-rename-err-${m.id}` : undefined"
              @keydown.esc.stop="editingId = null"
            >
            <button type="submit" class="btn btn-primary btn-sm">Save</button>
            <button type="button" class="btn btn-sm" @click="editingId = null">Cancel</button>
            <p v-if="editError" :id="`member-rename-err-${m.id}`" class="field-error full" role="alert">{{ editError }}</p>
          </form>
          <template v-else>
            <div class="who">
              <span class="name">{{ m.name }}</span>
              <NuxtLink :to="`/tasks?assignee=${m.id}`" class="small">
                {{ countFor(m.id).open }} open · {{ countFor(m.id).total }} total
              </NuxtLink>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-ghost btn-icon btn-sm" :aria-label="`Rename ${m.name}`" @click="startEdit(m)">
                <AppIcon name="edit" :size="15" />
              </button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm" :aria-label="`Remove ${m.name}`" @click="deleting = m">
                <AppIcon name="trash" :size="15" />
              </button>
            </div>
          </template>
        </li>
      </ul>
      <p v-else class="muted empty-team">No team members yet. Add someone below to start assigning tasks.</p>

      <form class="add" novalidate @submit.prevent="add">
        <div class="field grow">
          <label for="new-member-name">Add member</label>
          <input
            id="new-member-name"
            v-model="newName"
            class="input"
            type="text"
            placeholder="Full name"
            :maxlength="MEMBER_NAME_MAX + 20"
            autocomplete="off"
            data-testid="member-name-input"
            :aria-invalid="addError ? 'true' : 'false'"
            :aria-describedby="addError ? 'new-member-err' : undefined"
          >
        </div>
        <fieldset class="colors">
          <legend class="label">Colour</legend>
          <div class="swatches">
            <label v-for="c in MEMBER_COLORS" :key="c" class="swatch" :style="{ background: c }" :class="{ on: newColor === c }">
              <input v-model="newColor" type="radio" name="new-member-color" :value="c" class="sr-only" :aria-label="`Colour ${c}`" >
            </label>
            <label class="swatch custom" :class="{ on: !MEMBER_COLORS.includes(newColor) }" :style="{ background: MEMBER_COLORS.includes(newColor) ? undefined : newColor }" title="Custom colour">
              <input v-model="newColor" type="color" class="color-input" aria-label="Custom colour" >
              <AppIcon v-if="MEMBER_COLORS.includes(newColor)" name="plus" :size="12" />
            </label>
          </div>
        </fieldset>
        <button type="submit" class="btn btn-primary" data-testid="member-add-button">
          <AppIcon name="plus" :size="15" />
          Add
        </button>
        <p v-if="addError" id="new-member-err" class="field-error full" role="alert">{{ addError }}</p>
      </form>
    </div>

    <BaseModal :open="!!deleting" :title="`Remove “${deleting?.name ?? ''}”?`" size="sm" @close="deleting = null">
      <p v-if="deleting && countFor(deleting.id).total">
        {{ countFor(deleting.id).total }} task{{ countFor(deleting.id).total === 1 ? ' is' : 's are' }} assigned to {{ deleting.name }}.
        {{ countFor(deleting.id).total === 1 ? 'It' : 'They' }} will become unassigned. You can undo this.
      </p>
      <p v-else>No tasks are assigned to this member. You can undo this.</p>
      <template #footer>
        <button type="button" class="btn" @click="deleting = null">Cancel</button>
        <button type="button" class="btn btn-danger" data-testid="member-delete-confirm" @click="confirmDelete">Remove member</button>
      </template>
    </BaseModal>
  </section>
</template>

<style scoped>
.small {
  font-size: 12.5px;
}

.me {
  max-width: 340px;
  margin-bottom: 12px;
}

.members {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
}

.member {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  min-height: 56px;
}

.avatar-btn {
  position: relative;
  display: inline-flex;
  border-radius: 50%;
  cursor: pointer;
  flex: none;
}

.avatar-btn:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
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

.who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 2px;
}

.rename {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.rename .input {
  flex: 1 1 160px;
  width: auto;
}

.full {
  flex-basis: 100%;
}

.empty-team {
  margin: 0 0 12px;
}

.add {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 16px;
  padding-top: 14px;
}

.grow {
  flex: 1 1 200px;
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
  width: 26px;
  height: 26px;
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
</style>
