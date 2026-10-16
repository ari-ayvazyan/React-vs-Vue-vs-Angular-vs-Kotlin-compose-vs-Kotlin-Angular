<script setup lang="ts">
import type { ThemeSetting } from '~/lib/types';
import type { IconName } from '~/lib/icons';
import { validateImport } from '~/lib/validation';
import { generateDemoData } from '~/lib/demo';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

useHead({ title: 'Settings · TaskPilot' });

const store = useTaskStore();
const ui = useUiStore();

const THEMES: { value: ThemeSetting; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
];
const PAGE_SIZES = [10, 25, 50, 100];

// ----- pomodoro length -----
const pomoInput = ref('');
const pomoError = ref('');
watch(
  () => [store.ready, store.settings.pomodoroMinutes] as const,
  ([ready, m]) => {
    if (ready) pomoInput.value = String(m);
  },
  { immediate: true },
);

function savePomodoro(): void {
  const v = pomoInput.value.trim();
  if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 180) {
    pomoError.value = 'Enter a whole number of minutes between 1 and 180.';
    return;
  }
  pomoError.value = '';
  if (Number(v) !== store.settings.pomodoroMinutes) {
    store.updateSettings({ pomodoroMinutes: Number(v) });
    ui.toast(`Pomodoro length set to ${v} minutes`, { kind: 'success', duration: 2500 });
  }
}

function setPageSize(e: Event): void {
  store.updateSettings({ pageSize: Number((e.target as HTMLSelectElement).value) });
}

// ----- export -----
function exportJson(): void {
  const blob = new Blob([JSON.stringify(store.serialize(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `taskpilot-export-${store.today}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ui.toast(`Exported ${store.tasks.length} tasks`, { kind: 'success', duration: 3000 });
}

// ----- import -----
const fileInput = ref<HTMLInputElement | null>(null);
const importErrors = ref<string[]>([]);
const importing = ref(false);

async function onImport(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  importErrors.value = [];
  if (!file) return;
  importing.value = true;
  try {
    if (file.size > 20 * 1024 * 1024) {
      importErrors.value = ['File is too large (max 20 MB).'];
      return;
    }
    const res = validateImport(await file.text());
    if (!res.ok) {
      importErrors.value = res.errors;
      return;
    }
    store.replaceAll(res.state, { undoable: true });
    ui.toast(`Imported ${res.state.tasks.length} tasks, ${res.state.projects.length} projects and ${res.state.members.length} members`, {
      kind: 'success',
      actionLabel: 'Undo',
      action: () => store.undo(),
    });
  } catch (err) {
    importErrors.value = [`Could not read file: ${(err as Error).message}`];
  } finally {
    importing.value = false;
    input.value = '';
  }
}

// ----- reset -----
const confirmReset = ref(false);
function resetDemo(): void {
  const data = generateDemoData(300);
  store.replaceAll({ ...data, settings: store.settings }, { undoable: true, keepSettings: true });
  confirmReset.value = false;
  ui.toast('Demo data restored (300 tasks)', { kind: 'success', actionLabel: 'Undo', action: () => store.undo() });
}
</script>

<template>
  <div class="page narrow">
    <div class="page-header">
      <div>
        <h1 class="page-title">Settings</h1>
        <p class="page-subtitle">Preferences are saved in this browser.</p>
      </div>
    </div>

    <PageLoading v-if="!store.ready" :rows="4" />
    <div v-else class="sections">
      <section class="card" aria-labelledby="s-appearance">
        <div class="card-header">
          <h2 id="s-appearance" class="card-title">Appearance</h2>
        </div>
        <div class="card-body">
          <fieldset class="themes">
            <legend class="label">Theme</legend>
            <label v-for="t in THEMES" :key="t.value" class="theme" :class="{ on: store.settings.theme === t.value }">
              <input type="radio" name="theme" :value="t.value" :checked="store.settings.theme === t.value" class="sr-only" @change="store.updateSettings({ theme: t.value })" >
              <AppIcon :name="t.icon" :size="20" />
              <span>{{ t.label }}</span>
            </label>
          </fieldset>
        </div>
      </section>

      <section class="card" aria-labelledby="s-prefs">
        <div class="card-header">
          <h2 id="s-prefs" class="card-title">Preferences</h2>
        </div>
        <div class="card-body prefs">
          <form class="field" novalidate @submit.prevent="savePomodoro">
            <label for="pomo-minutes">Pomodoro length (minutes)</label>
            <div class="inline">
              <input
                id="pomo-minutes"
                v-model="pomoInput"
                class="input"
                type="number"
                min="1"
                max="180"
                step="1"
                :aria-invalid="pomoError ? 'true' : 'false'"
                :aria-describedby="pomoError ? 'pomo-err' : 'pomo-hint'"
                @blur="savePomodoro"
              >
              <button type="submit" class="btn">Save</button>
            </div>
            <p v-if="pomoError" id="pomo-err" class="field-error" role="alert">{{ pomoError }}</p>
            <p v-else id="pomo-hint" class="field-hint">Applies to the next timer you start.</p>
          </form>
          <div class="field">
            <label for="page-size">Tasks per page</label>
            <select id="page-size" class="select" :value="store.settings.pageSize" @change="setPageSize">
              <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}</option>
            </select>
            <p class="field-hint">Used by the task list pagination.</p>
          </div>
        </div>
      </section>

      <TeamSettings />

      <section class="card" aria-labelledby="s-data">
        <div class="card-header">
          <h2 id="s-data" class="card-title">Data</h2>
          <span class="muted small">{{ store.tasks.length }} tasks · {{ store.projects.length }} projects · {{ store.members.length }} members</span>
        </div>
        <div class="card-body data">
          <div class="data-row">
            <div>
              <h3 class="row-title">Export</h3>
              <p class="muted">Download all tasks, projects, team members and settings as JSON.</p>
            </div>
            <button type="button" class="btn" @click="exportJson">
              <AppIcon name="download" :size="15" />
              Export JSON
            </button>
          </div>
          <div class="data-row">
            <div>
              <h3 class="row-title">Import</h3>
              <p class="muted">Replace all data with a previously exported JSON file. You can undo this.</p>
            </div>
            <div>
              <input id="import-file" ref="fileInput" type="file" accept="application/json,.json" class="sr-only" @change="onImport" >
              <button type="button" class="btn" :disabled="importing" @click="fileInput?.click()">
                <AppIcon name="upload" :size="15" />
                {{ importing ? 'Importing…' : 'Import JSON' }}
              </button>
            </div>
          </div>
          <div v-if="importErrors.length" class="import-errors" role="alert">
            <p><strong>Import failed.</strong> The file doesn’t match the TaskPilot format:</p>
            <ul>
              <li v-for="(e, i) in importErrors" :key="i">{{ e }}</li>
            </ul>
          </div>
          <div class="data-row">
            <div>
              <h3 class="row-title">Reset demo data</h3>
              <p class="muted">Replace everything with the 300 generated demo tasks. Settings are kept.</p>
            </div>
            <button type="button" class="btn btn-danger" @click="confirmReset = true">
              <AppIcon name="reset" :size="15" />
              Reset demo data
            </button>
          </div>
        </div>
      </section>
    </div>

    <BaseModal :open="confirmReset" title="Reset demo data?" size="sm" @close="confirmReset = false">
      <p>All {{ store.tasks.length }} current tasks, {{ store.projects.length }} projects and {{ store.members.length }} team members will be replaced with fresh demo data. You can undo this with <kbd>Ctrl</kbd>+<kbd>Z</kbd>.</p>
      <template #footer>
        <button type="button" class="btn" @click="confirmReset = false">Cancel</button>
        <button type="button" class="btn btn-danger" @click="resetDemo">Reset data</button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.narrow {
  max-width: 860px;
  margin-left: 0;
}

.sections {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.small {
  font-size: 12.5px;
}

.themes {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.themes legend {
  padding: 0;
  margin-bottom: 8px;
}

.theme {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  cursor: pointer;
  font-weight: 600;
  color: var(--text-muted);
}

.theme:hover {
  background: var(--surface-hover);
}

.theme.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-text);
}

.theme:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.prefs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.inline {
  display: flex;
  gap: 8px;
}

.data {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-top: 4px;
}

.data-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}

.data-row:last-child {
  border-bottom: 0;
}

.row-title {
  font-size: 14px;
  margin-bottom: 2px;
}

.import-errors {
  margin: 4px 0 8px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
}

.import-errors ul {
  margin: 6px 0 0;
  padding-left: 18px;
}

@media (max-width: 767px) {
  .prefs {
    grid-template-columns: minmax(0, 1fr);
  }

  .data-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
