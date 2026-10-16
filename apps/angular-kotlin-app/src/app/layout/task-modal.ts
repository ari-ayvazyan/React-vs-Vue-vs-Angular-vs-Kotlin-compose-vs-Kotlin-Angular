import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TaskDraft } from '../core/kt';
import { StoreService } from '../core/store.service';
import { UiService } from '../core/ui.service';
import { Dialog } from '../shared/dialog';
import { Icon } from '../shared/icon';
import { TaskForm } from '../shared/task-form';

@Component({
  selector: 'app-task-modal',
  imports: [Dialog, TaskForm, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as req) {
      <app-dialog labelId="task-modal-title" testId="task-modal" [wide]="true" (closed)="ui.closeTaskModal()">
        <header class="dialog-header">
          <h2 id="task-modal-title">{{ task() ? 'Edit task' : 'New task' }}</h2>
          <button type="button" class="icon-btn" aria-label="Close dialog" (click)="ui.closeTaskModal()">
            <app-icon name="close" />
          </button>
        </header>
        <app-task-form
          [task]="task()"
          [defaults]="req.defaults"
          [submitLabel]="task() ? 'Save changes' : 'Create task'"
          (saved)="save($event)"
          (cancelled)="ui.closeTaskModal()"
        />
      </app-dialog>
    }
  `,
})
export class TaskModal {
  protected readonly ui = inject(UiService);
  private readonly store = inject(StoreService);
  private readonly router = inject(Router);
  protected readonly request = this.ui.taskModal;
  protected readonly task = computed(() => {
    const id = this.request()?.taskId;
    return id ? this.store.task(id) : null;
  });

  protected save(draft: TaskDraft): void {
    const existing = this.task();
    if (existing) {
      if (this.store.updateTask(existing.id, draft)) this.ui.toast('Task updated', { tone: 'success' });
    } else {
      const id = this.store.createTask(draft);
      if (id) {
        this.ui.toast(`Created “${draft.title.trim()}”`, {
          tone: 'success',
          actionLabel: 'Open',
          action: () => void this.router.navigate(['/tasks', id]),
        });
      }
    }
    this.ui.closeTaskModal();
  }
}
