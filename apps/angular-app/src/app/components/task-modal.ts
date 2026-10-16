import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Modal } from './modal';
import { TaskForm } from './task-form';
import { UiService } from '../services/ui.service';
import { StoreService } from '../services/store.service';
import { ToastService } from '../services/toast.service';
import { Task } from '../core/models';

@Component({
  selector: 'app-task-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Modal, TaskForm],
  template: `
    @if (request(); as req) {
      <app-modal
        [heading]="task() ? 'Edit task' : 'New task'"
        testId="task-modal"
        [wide]="true"
        (closed)="ui.closeTaskModal()"
      >
        <app-task-form
          [task]="task() ?? null"
          [defaults]="req.defaults"
          (saved)="onSaved($event)"
          (cancelled)="ui.closeTaskModal()"
        />
      </app-modal>
    }
  `,
})
export class TaskModal {
  protected readonly ui = inject(UiService);
  private readonly store = inject(StoreService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly request = this.ui.taskModal;
  protected readonly task = computed(() => {
    const id = this.request()?.taskId;
    return id ? this.store.getTask(id) : undefined;
  });

  protected onSaved(task: Task): void {
    const isNew = !this.request()?.taskId;
    this.ui.closeTaskModal();
    if (isNew) {
      this.toast.show(`Task “${task.title}” created`, {
        kind: 'success',
        actionLabel: 'Open',
        action: () => this.router.navigate(['/tasks', task.id]),
      });
    } else {
      this.toast.show('Task updated', { kind: 'success' });
    }
  }
}
