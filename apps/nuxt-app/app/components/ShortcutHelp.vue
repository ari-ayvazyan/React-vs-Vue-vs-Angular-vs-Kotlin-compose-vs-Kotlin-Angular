<script setup lang="ts">
import { useUiStore } from '~/stores/ui';

const ui = useUiStore();

const groups = [
  {
    title: 'General',
    items: [
      { keys: ['n'], label: 'New task' },
      { keys: ['/'], label: 'Focus search' },
      { keys: ['?'], label: 'Show this help' },
      { keys: ['Esc'], label: 'Close dialog' },
      { keys: ['Ctrl', 'Z'], label: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo' },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { keys: ['g', 'd'], label: 'Go to dashboard' },
      { keys: ['g', 't'], label: 'Go to tasks' },
      { keys: ['g', 'b'], label: 'Go to board' },
      { keys: ['g', 'c'], label: 'Go to calendar' },
      { keys: ['g', 'l'], label: 'Go to timeline' },
      { keys: ['g', 'a'], label: 'Go to activity' },
    ],
  },
  {
    title: 'Board (card focused)',
    items: [
      { keys: ['Shift', '←/→'], label: 'Move to previous / next column' },
      { keys: ['Shift', '↑/↓'], label: 'Reorder within column' },
    ],
  },
];
</script>

<template>
  <BaseModal :open="ui.helpOpen" title="Keyboard shortcuts" size="md" @close="ui.helpOpen = false">
    <div class="groups">
      <section v-for="g in groups" :key="g.title">
        <h3 class="gtitle">{{ g.title }}</h3>
        <dl class="list">
          <div v-for="item in g.items" :key="item.label" class="row">
            <dt class="keys">
              <template v-for="(k, i) in item.keys" :key="k">
                <kbd>{{ k }}</kbd><span v-if="i < item.keys.length - 1" class="then">{{ g.title === 'Navigation' ? 'then' : '+' }}</span>
              </template>
            </dt>
            <dd>{{ item.label }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </BaseModal>
</template>

<style scoped>
.groups {
  display: grid;
  gap: 18px;
}

.gtitle {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-subtle);
  margin-bottom: 8px;
}

.list {
  margin: 0;
  display: grid;
  gap: 6px;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--border);
}

.keys {
  display: flex;
  align-items: center;
  gap: 4px;
  order: 2;
}

dd {
  margin: 0;
}

.then {
  font-size: 11px;
  color: var(--text-subtle);
}
</style>
