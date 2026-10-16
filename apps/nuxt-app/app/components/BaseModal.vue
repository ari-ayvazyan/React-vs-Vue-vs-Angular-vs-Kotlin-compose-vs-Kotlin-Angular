<script setup lang="ts">
/**
 * Accessible modal dialog: focus trap, Escape to close, focus restored to the opener on close,
 * background scroll locked. Only rendered client-side (when open), so it never affects hydration.
 */
const props = withDefaults(
  defineProps<{ open: boolean; title: string; size?: 'sm' | 'md' | 'lg'; testid?: string; description?: string }>(),
  { size: 'md', testid: undefined, description: undefined },
);
const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
const titleId = useId();
const descId = useId();
let previouslyFocused: HTMLElement | null = null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(): HTMLElement[] {
  if (!panel.value) return [];
  return [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    emit('close');
    return;
  }
  if (e.key !== 'Tab') return;
  const els = focusables();
  if (els.length === 0) {
    e.preventDefault();
    panel.value?.focus();
    return;
  }
  const first = els[0] as HTMLElement;
  const last = els[els.length - 1] as HTMLElement;
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

watch(
  () => props.open,
  async (open) => {
    if (!import.meta.client) return;
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      await nextTick();
      const auto = panel.value?.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      (auto ?? focusables()[0] ?? panel.value)?.focus();
    } else {
      document.body.style.overflow = '';
      const el = previouslyFocused;
      previouslyFocused = null;
      if (el && document.contains(el)) el.focus();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (import.meta.client && props.open) {
    document.body.style.overflow = '';
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="backdrop" @mousedown.self="emit('close')">
        <div
          ref="panel"
          class="panel"
          :class="`panel-${size}`"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="description ? descId : undefined"
          :data-testid="testid"
          tabindex="-1"
          @keydown="onKeydown"
        >
          <header class="head">
            <h2 :id="titleId" class="title">{{ title }}</h2>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Close dialog" @click="emit('close')">
              <AppIcon name="x" :size="16" />
            </button>
          </header>
          <p v-if="description" :id="descId" class="desc">{{ description }}</p>
          <div class="body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8vh 16px 16px;
  background: rgba(10, 14, 24, 0.5);
  backdrop-filter: blur(2px);
  overflow-y: auto;
}

.panel {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  max-height: 84vh;
}

.panel:focus {
  outline: none;
}

.panel-sm {
  max-width: 420px;
}

.panel-md {
  max-width: 560px;
}

.panel-lg {
  max-width: 720px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 0;
}

.title {
  font-size: 17px;
}

.desc {
  padding: 6px 18px 0;
  color: var(--text-muted);
}

.body {
  padding: 16px 18px;
  overflow-y: auto;
}

.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--border);
}

/* Animate in only; closing is instant so the UI responds immediately. */
.modal-enter-active {
  transition: opacity 0.14s ease;
}

.modal-enter-active .panel {
  transition: transform 0.14s ease;
}

.modal-enter-from {
  opacity: 0;
}

.modal-enter-from .panel {
  transform: translateY(8px) scale(0.98);
}

@media (max-width: 767px) {
  .backdrop {
    padding: 12px 8px;
    align-items: flex-end;
  }

  .panel {
    max-height: 92vh;
  }
}
</style>
