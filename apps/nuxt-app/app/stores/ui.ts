import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  actionLabel?: string;
  action?: () => void;
}

export interface TaskModalState {
  open: boolean;
  /** null → create */
  taskId: string | null;
  /** `statusId` may be a workflow status id or a category */
  defaults: { statusId?: string; projectId?: string | null; dueDate?: string | null; assigneeId?: string | null };
}

let toastSeq = 0;

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([]);
  const taskModal = ref<TaskModalState>({ open: false, taskId: null, defaults: {} });
  const helpOpen = ref(false);
  const sidebarCollapsed = ref(false);
  const drawerOpen = ref(false);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id);
    const h = timers.get(id);
    if (h) clearTimeout(h);
    timers.delete(id);
  }

  function toast(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> & { duration?: number } = {}): number {
    const id = ++toastSeq;
    const { duration = 5000, ...rest } = opts;
    // Repeated identical errors (e.g. retrying a blocked move) replace each other instead of stacking up.
    if (rest.kind === 'error') toasts.value.filter((t) => t.kind === 'error' && t.message === message).forEach((t) => dismissToast(t.id));
    toasts.value = [...toasts.value.slice(-3), { id, message, kind: 'info', ...rest }];
    timers.set(
      id,
      setTimeout(() => dismissToast(id), duration),
    );
    return id;
  }

  function openNewTask(defaults: TaskModalState['defaults'] = {}): void {
    taskModal.value = { open: true, taskId: null, defaults };
  }

  function openEditTask(taskId: string): void {
    taskModal.value = { open: true, taskId, defaults: {} };
  }

  function closeTaskModal(): void {
    taskModal.value = { ...taskModal.value, open: false };
  }

  return { toasts, taskModal, helpOpen, sidebarCollapsed, drawerOpen, toast, dismissToast, openNewTask, openEditTask, closeTaskModal };
});
