<script setup lang="ts">
import { ICONS } from '~/lib/icons';
import type { IconName } from '~/lib/icons';

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 18 });


const d = computed(() => ICONS[props.name]);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    class="icon"
  >
    <path :d="d" />
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
  display: block;
}
</style>
