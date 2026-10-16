import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  action?: () => void;
  tone: 'info' | 'success' | 'error';
}

export interface TaskModalRequest {
  taskId: string | null;
  defaults?: { dueDate?: string; status?: string; projectId?: string; assigneeId?: string };
}

/** Pure UI state: dialogs, toasts, drawer and focus requests. */
@Injectable({ providedIn: 'root' })
export class UiService {
  readonly taskModal = signal<TaskModalRequest | null>(null);
  readonly helpOpen = signal(false);
  readonly drawerOpen = signal(false);
  readonly sidebarCollapsed = signal(false);
  readonly toasts = signal<Toast[]>([]);
  /** Incremented to ask the top bar to focus its search box. */
  readonly searchFocusRequest = signal(0);

  private nextToastId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  openTaskModal(taskId: string | null = null, defaults?: TaskModalRequest['defaults']): void {
    this.taskModal.set({ taskId, defaults });
  }

  closeTaskModal(): void {
    this.taskModal.set(null);
  }

  focusSearch(): void {
    this.searchFocusRequest.update((n) => n + 1);
  }

  toast(message: string, options: Partial<Pick<Toast, 'actionLabel' | 'action' | 'tone'>> = {}): void {
    const toast: Toast = { id: this.nextToastId++, message, tone: options.tone ?? 'info', ...options };
    this.toasts.update((list) => [...list.slice(-3), toast]);
    this.timers.set(
      toast.id,
      setTimeout(() => this.dismiss(toast.id), 5000),
    );
  }

  dismiss(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Esc handling: close the top-most overlay. Returns true when something was closed. */
  closeTopmost(): boolean {
    if (this.taskModal()) {
      this.closeTaskModal();
      return true;
    }
    if (this.helpOpen()) {
      this.helpOpen.set(false);
      return true;
    }
    if (this.drawerOpen()) {
      this.drawerOpen.set(false);
      return true;
    }
    return false;
  }
}
