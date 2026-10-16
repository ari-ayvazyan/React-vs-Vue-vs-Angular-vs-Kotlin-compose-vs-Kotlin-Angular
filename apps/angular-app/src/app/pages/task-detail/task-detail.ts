import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { StoreService } from '../../services/store.service';
import { ToastService } from '../../services/toast.service';
import { PomodoroService } from '../../services/pomodoro.service';
import { PRIORITY_LABELS, RECURRENCE_LABELS, STATUS_LABELS } from '../../core/models';
import { formatMinutes, relativeDue } from '../../core/dates';
import { isOverdue } from '../../core/filters';
import { TaskForm } from '../../components/task-form';
import { Icon } from '../../components/icon';
import { Avatar } from '../../components/avatar';
import { DependencyPicker } from '../../components/dependency-picker';
import { CommentThread } from '../../components/comment-thread';
import { ActivityList } from '../../components/activity-list';
import { openBlockers } from '../../core/dependencies';

@Component({
  selector: 'app-task-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TaskForm, Icon, Avatar, DependencyPicker, CommentThread, ActivityList],
  templateUrl: './task-detail.html',
  styleUrl: './task-detail.css',
})
export class TaskDetailPage {
  protected readonly store = inject(StoreService);
  protected readonly pomodoro = inject(PomodoroService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly id = input.required<string>();

  /** The task's (effective) workflow: one button per status. */
  protected readonly workflow = computed(() => {
    const t = this.task();
    return t ? this.store.workflowOf()(t.projectId) : [];
  });
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly recurrenceLabels = RECURRENCE_LABELS;
  protected readonly task = computed(() => this.store.taskMap().get(this.id()));
  protected readonly project = computed(() => {
    const pid = this.task()?.projectId;
    return pid ? this.store.projectMap().get(pid) : undefined;
  });
  protected readonly assignee = computed(() => {
    const id = this.task()?.assigneeId;
    return id ? this.store.memberMap().get(id) : undefined;
  });
  protected readonly openBlockers = computed(() => {
    const t = this.task();
    return t && t.status !== 'done' ? openBlockers(t, this.store.taskMap()) : [];
  });
  protected readonly blockedLabel = computed(
    () =>
      `Blocked by ${this.openBlockers()
        .map((b) => b.title)
        .join(', ')}`,
  );
  /** This task's log entries, newest first. */
  protected readonly timeline = computed(() => {
    const id = this.id();
    return this.store
      .activity()
      .filter((e) => e.taskId === id)
      .reverse();
  });
  protected readonly showAllActivity = signal(false);
  protected readonly visibleTimeline = computed(() =>
    this.showAllActivity() ? this.timeline() : this.timeline().slice(0, 15),
  );
  protected readonly newSubtask = signal('');
  protected readonly editingSub = signal<string | null>(null);
  protected readonly subDone = computed(
    () => this.task()?.subtasks.filter((s) => s.done).length ?? 0,
  );
  protected readonly overdue = computed(() => {
    const t = this.task();
    return !!t && isOverdue(t, this.store.today());
  });
  protected readonly active = computed(() => this.pomodoro.taskId() === this.id());
  protected readonly ringDash = computed(() => {
    const c = 2 * Math.PI * 54;
    const p = this.active() ? this.pomodoro.progress() : 0;
    return `${(c * p).toFixed(2)} ${c.toFixed(2)}`;
  });
  protected readonly timerLabel = computed(() => {
    if (this.active()) return this.pomodoro.label();
    return `${String(this.store.settings().pomodoroMinutes).padStart(2, '0')}:00`;
  });

  protected readonly fmtMinutes = formatMinutes;
  protected readonly Math = Math;

  protected fmtDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected dueLabel(key: string): string {
    return relativeDue(key, this.store.today());
  }

  /** Sets a workflow status (its category decides done-ness; blocked tasks are refused). */
  protected setStatus(statusId: string): void {
    if (this.task()?.statusId === statusId) return; // no empty undo step
    this.store.updateTask(this.id(), { statusId });
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected addSubtask(e: Event): void {
    e.preventDefault();
    this.store.addSubtask(this.id(), this.newSubtask());
    this.newSubtask.set('');
  }

  protected saveSub(subId: string, title: string): void {
    this.store.renameSubtask(this.id(), subId, title);
    this.editingSub.set(null);
  }

  protected removeSub(subId: string): void {
    this.store.removeSubtask(this.id(), subId);
  }

  protected toggleTimer(): void {
    if (this.active() && this.pomodoro.running()) this.pomodoro.pause();
    else this.pomodoro.start(this.id());
  }

  protected resetTimer(): void {
    if (this.active()) this.pomodoro.reset();
  }

  protected delete(): void {
    const t = this.task();
    if (!t) return;
    if (this.active()) this.pomodoro.reset();
    this.store.deleteTasks([t.id]);
    void this.router.navigate(['/tasks']);
    this.toast.show(`Deleted “${t.title}”`, {
      actionLabel: 'Undo',
      action: () => {
        this.store.undo();
        void this.router.navigate(['/tasks', t.id]);
      },
    });
  }

  protected onSaved(): void {
    this.toast.show('Changes saved', { kind: 'success', duration: 2500 });
  }
}
