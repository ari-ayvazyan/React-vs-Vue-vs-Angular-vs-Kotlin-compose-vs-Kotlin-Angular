<script setup lang="ts">
import { parseComment } from '~/lib/mentions';
import { useTaskStore } from '~/stores/tasks';

const props = defineProps<{ body: string }>();
const store = useTaskStore();
const segments = computed(() => parseComment(props.body, store.members));
</script>

<template>
  <p class="body">
    <template v-for="(s, i) in segments" :key="i">
      <template v-if="s.kind === 'text'">{{ s.text }}</template>
      <span v-else class="mention" :class="{ me: s.memberId === store.currentUser?.id, gone: !s.name }" data-testid="mention">@{{ s.name ?? 'former member' }}</span>
    </template>
  </p>
</template>

<style scoped>
.body {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.mention {
  padding: 0 3px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 600;
}

.mention.me {
  background: var(--warning-soft);
  color: var(--warning);
}

.mention.gone {
  background: var(--surface-2);
  color: var(--text-subtle);
}
</style>
