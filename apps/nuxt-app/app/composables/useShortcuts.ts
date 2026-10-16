import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return false;
}

const G_ROUTES: Record<string, string> = { d: '/dashboard', t: '/tasks', b: '/board', c: '/calendar', l: '/timeline', a: '/activity' };

/** Global keyboard shortcuts. Registered once by the default layout. */
export function useShortcuts(): void {
  const ui = useUiStore();
  const store = useTaskStore();
  let gPending = false;
  let gTimer: ReturnType<typeof setTimeout> | null = null;

  const modalOpen = (): boolean => ui.taskModal.open || ui.helpOpen || document.querySelector('[aria-modal="true"]') !== null;

  function onKeydown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    // Undo / redo work everywhere except inside text fields (native text undo wins there).
    if (mod && !e.altKey && e.key.toLowerCase() === 'z') {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      const ok = e.shiftKey ? store.redo() : store.undo();
      ui.toast(ok ? (e.shiftKey ? 'Redone' : 'Undone') : e.shiftKey ? 'Nothing to redo' : 'Nothing to undo', { duration: 2000 });
      return;
    }
    if (mod && !e.altKey && e.key.toLowerCase() === 'y') {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      ui.toast(store.redo() ? 'Redone' : 'Nothing to redo', { duration: 2000 });
      return;
    }
    if (mod || e.altKey || isTypingTarget(e.target) || e.defaultPrevented) return;
    if (modalOpen()) return;

    if (gPending) {
      gPending = false;
      if (gTimer) clearTimeout(gTimer);
      const to = G_ROUTES[e.key.toLowerCase()];
      if (to) {
        e.preventDefault();
        void navigateTo(to);
        return;
      }
    }

    switch (e.key) {
      case 'n':
      case 'N':
        if (e.shiftKey) return;
        e.preventDefault();
        ui.openNewTask();
        break;
      case '/': {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>('[data-testid="task-list-search"]') ?? document.querySelector<HTMLInputElement>('[data-testid="global-search"]');
        el?.focus();
        el?.select();
        break;
      }
      case '?':
        e.preventDefault();
        ui.helpOpen = true;
        break;
      case 'g':
        gPending = true;
        gTimer = setTimeout(() => (gPending = false), 1200);
        break;
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
}
