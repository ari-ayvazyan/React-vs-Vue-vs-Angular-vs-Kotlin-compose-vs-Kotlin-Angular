import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  DateFmt,
  Priority,
  Recurrence,
  TaskDraft,
  blockedTasks,
  blockerTasks,
  isTaskOverdue,
  openBlockers,
  taskActivity,
} from '../../core/kt';
import { PomodoroService } from '../../core/pomodoro.service';
import { StoreService } from '../../core/store.service';
import { UiService } from '../../core/ui.service';
import { ActivityList } from '../../shared/activity-list';
import { Avatar } from '../../shared/avatar';
import { StatusPill } from '../../shared/status-pill';
import { BlockerPicker } from '../../shared/blocker-picker';
import { CommentBody } from '../../shared/comment-body';
import { CommentBox } from '../../shared/comment-box';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';
import { TaskForm } from '../../shared/task-form';
import { Autofocus } from '../../shared/autofocus';

@Component({
  selector: 'app-task-detail',
  imports: [RouterLink, Icon, TaskForm, Skeleton, Autofocus, Avatar, BlockerPicker, CommentBox, CommentBody, ActivityList, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './task-detail.html',
})
export class TaskDetailPage {
  /** Route param, bound via `withComponentInputBinding`. */
  readonly id = input.required<string>();

  protected readonly store = inject(StoreService);
  protected readonly ui = inject(UiService);
  protected readonly pomodoro = inject(PomodoroService);
  private readonly router = inject(Router);

  protected readonly fmt = DateFmt;
  protected readonly priorityLabel = (p: string) => Priority.label(p);
  protected readonly recurrenceLabel = (r: string) => Recurrence.label(r);
  protected readonly assignee = computed(() => this.store.member(this.task()?.assigneeId));

  protected readonly blockers = computed(() => {
    const t = this.task();
    return t ? blockerTasks(this.store.state(), t) : [];
  });
  protected readonly openBlockerCount = computed(() => {
    const t = this.task();
    return t ? openBlockers(this.store.state(), t).length : 0;
  });
  protected readonly blocking = computed(() => blockedTasks(this.store.state(), this.id()));
  protected readonly timeline = computed(() => taskActivity(this.store.activity(), this.id()));
  protected readonly task = computed(() => this.store.task(this.id()));
  protected readonly project = computed(() => {
    const pid = this.task()?.projectId;
    return pid ? (this.store.projectMap().get(pid) ?? null) : null;
  });
  protected readonly overdue = computed(() => {
    const t = this.task();
    return t ? isTaskOverdue(t, this.store.today()) : false;
  });
  protected readonly subtaskProgress = computed(() => {
    const t = this.task();
    return t && t.subtasks.length ? Math.round((t.subtasksDone / t.subtasks.length) * 100) : 0;
  });

  /** The pomodoro belongs to this task (or is idle). */
  protected readonly timerHere = computed(() => !this.pomodoro.active() || this.pomodoro.taskId() === this.id());
  protected readonly newSubtask = signal('');
  protected readonly editingSubtask = signal<string | null>(null);
  protected readonly subtaskError = signal('');

  protected save(draft: TaskDraft): void {
    if (this.store.updateTask(this.id(), draft)) this.ui.toast('Changes saved', { tone: 'success' });
  }

  protected remove(): void {
    const t = this.task();
    if (!t) return;
    if (this.pomodoro.taskId() === t.id) this.pomodoro.reset();
    this.store.deleteTask(t.id);
    void this.router.navigateByUrl('/tasks');
    this.ui.toast(`Deleted “${t.title}”`, {
      actionLabel: 'Undo',
      action: () => {
        this.store.undo();
        void this.router.navigate(['/tasks', t.id]);
      },
    });
  }

  protected addSubtask(event: Event): void {
    event.preventDefault();
    if (this.store.addSubtask(this.id(), this.newSubtask())) {
      this.newSubtask.set('');
      this.subtaskError.set('');
    } else {
      this.subtaskError.set('Subtask title is required (max 120 characters).');
    }
  }

  protected renameSubtask(subId: string, title: string): void {
    if (this.store.renameSubtask(this.id(), subId, title)) this.editingSubtask.set(null);
  }

  protected timerToggle(): void {
    if (this.pomodoro.running()) this.pomodoro.pause();
    else this.pomodoro.start(this.id());
  }
}
