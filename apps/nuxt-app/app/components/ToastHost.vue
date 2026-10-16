<script setup lang="ts">
import { useUiStore } from '~/stores/ui';
import type { Toast } from '~/stores/ui';

const ui = useUiStore();

function runAction(t: Toast): void {
  t.action?.();
  ui.dismissToast(t.id);
}
</script>

<template>
  <div class="toasts" role="status" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="`toast-${t.kind}`" data-testid="toast">
        <AppIcon :name="t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'undo'" :size="16" class="ticon" />
        <span class="msg">{{ t.message }}</span>
        <button v-if="t.actionLabel" type="button" class="action" @click="runAction(t)">{{ t.actionLabel }}</button>
        <button type="button" class="close" aria-label="Dismiss notification" @click="ui.dismissToast(t.id)">
          <AppIcon name="x" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(380px, calc(100vw - 32px));
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 14px;
  border-radius: var(--radius);
  background: #1c2130;
  color: #f2f4fa;
  box-shadow: var(--shadow-lg);
  font-size: 13.5px;
}

:root[data-theme='dark'] .toast {
  background: #2a3245;
  border: 1px solid #3a4459;
}

.ticon {
  color: #a5b4fc;
}

.toast-success .ticon {
  color: #6ee7b7;
}

.toast-error .ticon {
  color: #fca5a5;
}

.msg {
  flex: 1;
  min-width: 0;
}

.action {
  border: 0;
  background: rgba(255, 255, 255, 0.12);
  color: #c7d2fe;
  font-weight: 650;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.action:hover {
  background: rgba(255, 255, 255, 0.2);
}

.close {
  display: inline-flex;
  border: 0;
  background: none;
  color: #b4bbcc;
  padding: 4px;
  border-radius: 6px;
  cursor: pointer;
}

.close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 767px) {
  .toasts {
    right: 16px;
    bottom: 16px;
  }
}
</style>
