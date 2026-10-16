<script setup lang="ts">
import type { Priority } from '~/lib/types';
import { PRIORITY_LABELS } from '~/lib/types';

defineProps<{ priority: Priority }>();
</script>

<template>
  <span class="badge" :class="`badge-${priority}`">
    <span class="pdot" aria-hidden="true" />
    {{ PRIORITY_LABELS[priority] }}
  </span>
</template>

<style scoped>
.pdot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
</style>
