<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 6 });
</script>

<template>
  <div class="loading" aria-busy="true" aria-live="polite">
    <span class="sr-only">Loading your data…</span>
    <div class="skeleton head" />
    <div v-for="i in rows" :key="i" class="skeleton row" :style="{ opacity: 1 - i * 0.1 }" />
  </div>
</template>

<style scoped>
.loading {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  height: 80px;
}

.row {
  height: 44px;
}
</style>
