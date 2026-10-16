import { Injectable, signal } from '@angular/core';
import { Status } from '../core/models';

export interface TaskModalRequest {
  taskId: string | null;
  defaults?: {
    status?: Status;
    dueDate?: string;
    projectId?: string | null;
    assigneeId?: string | null;
  };
}

/** Global UI state: modals, drawer. */
@Injectable({ providedIn: 'root' })
export class UiService {
  readonly taskModal = signal<TaskModalRequest | null>(null);
  readonly helpOpen = signal(false);
  readonly sidebarCollapsed = signal(false);
  readonly drawerOpen = signal(false);

  openNewTask(defaults?: TaskModalRequest['defaults']): void {
    this.taskModal.set({ taskId: null, defaults });
  }

  openEditTask(taskId: string): void {
    this.taskModal.set({ taskId });
  }

  closeTaskModal(): void {
    this.taskModal.set(null);
  }

  get anyModalOpen(): boolean {
    return this.taskModal() !== null || this.helpOpen();
  }
}
