<script setup lang="ts">
import { memberInitials, readableTextColor } from '~/lib/members';
import { useTaskStore } from '~/stores/tasks';

const props = withDefaults(
  defineProps<{
    memberId: string | null;
    size?: number;
    /** render a dashed "unassigned" circle instead of nothing when there is no (known) member */
    placeholder?: boolean;
  }>(),
  { size: 24, placeholder: false },
);

const store = useTaskStore();
const member = computed(() => (props.memberId ? store.memberById.get(props.memberId) : undefined));
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.max(9, Math.round(props.size * 0.42))}px`,
  ...(member.value ? { background: member.value.color, color: readableTextColor(member.value.color) } : {}),
}));
</script>

<template>
  <span v-if="member" class="avatar" :style="style" role="img" :aria-label="`Assigned to ${member.name}`" :title="member.name" data-testid="assignee-avatar">
    {{ memberInitials(member.name) }}
  </span>
  <span v-else-if="placeholder" class="avatar empty" :style="style" role="img" aria-label="Unassigned" title="Unassigned" />
</template>

<style scoped>
.avatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  user-select: none;
  box-shadow: 0 0 0 2px var(--surface);
}

.empty {
  border: 1.5px dashed var(--border-strong);
  box-shadow: none;
}
</style>
