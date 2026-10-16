import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DateFmt,
  Limits,
  Priority,
  Recurrence,
  Task,
  TaskDraft,
  TaskDrafts,
  nextOccurrenceDate,
  remapStatus,
  workflowFor,
  parseTags,
  validateTaskDraft,
} from '../core/kt';
import { StoreService } from '../core/store.service';

let nextFormId = 0;

/** Create / edit form for a task. Validation rules come from Kotlin (`validateTaskDraft`). */
@Component({
  selector: 'app-task-form',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './task-form.html',
})
export class TaskForm {
  readonly task = input<Task | null>(null);
  readonly defaults = input<
    { dueDate?: string; status?: string; projectId?: string; assigneeId?: string } | undefined
  >(undefined);
  readonly submitLabel = input('Save');
  readonly showCancel = input(true);
  readonly saved = output<TaskDraft>();
  readonly cancelled = output<void>();

  protected readonly store = inject(StoreService);
  protected readonly id = `tf${nextFormId++}`;
  protected readonly priorities = Priority.all;
  protected readonly priorityLabel = (p: string) => Priority.label(p);
  protected readonly recurrences = Recurrence.all;
  protected readonly recurrenceLabel = (r: string) => Recurrence.label(r);
  protected readonly limits = Limits;

  private readonly initial = computed(() => {
    const t = this.task();
    if (t) return TaskDrafts.fromTask(t);
    const d = this.defaults();
    const e = TaskDrafts.empty();
    return new TaskDraft(
      '',
      '',
      d?.status ?? e.status,
      e.priority,
      d?.projectId ?? '',
      '',
      d?.dueDate ?? '',
      '',
      d?.assigneeId ?? '',
      e.recurrence,
    );
  });

  protected readonly title = linkedSignal(() => this.initial().title);
  protected readonly description = linkedSignal(() => this.initial().description);
  /** Default may be a category (e.g. from a board column); resolve it within the project's workflow once. */
  protected readonly status = linkedSignal(() => {
    const i = this.initial();
    return untracked(() => remapStatus(this.store.state(), i.projectId, i.status, 'todo'));
  });
  protected readonly priority = linkedSignal(() => this.initial().priority);
  protected readonly projectId = linkedSignal(() => this.initial().projectId);
  protected readonly tagsText = linkedSignal(() => this.initial().tagsText);
  protected readonly dueDate = linkedSignal(() => this.initial().dueDate);
  protected readonly estimate = linkedSignal(() => this.initial().estimateText);
  protected readonly assigneeId = linkedSignal(() => this.initial().assigneeId);
  protected readonly recurrence = linkedSignal(() => this.initial().recurrence);
  protected readonly submitted = signal(false);
  /** Statuses of the selected project's (inherited) workflow. */
  protected readonly statusOptions = computed(() => workflowFor(this.store.state(), this.projectId() || null));

  protected readonly draft = computed(
    () =>
      new TaskDraft(
        this.title(),
        this.description(),
        this.status(),
        this.priority(),
        this.projectId(),
        this.tagsText(),
        this.dueDate(),
        this.estimate(),
        this.assigneeId(),
        this.recurrence(),
      ),
  );
  protected readonly validation = computed(() => validateTaskDraft(this.draft()));
  protected readonly tagPreview = computed(() => parseTags(this.tagsText()));
  /** "Next: Fri, Oct 23" hint for recurring tasks (date rule lives in Kotlin). */
  protected readonly nextHint = computed(() => {
    const next = nextOccurrenceDate(this.dueDate() || null, this.recurrence(), this.store.today() || DateFmt.today());
    return next ? DateFmt.long(next) : '';
  });

  /** Changing the project maps the status into the new project's workflow (by category, in Kotlin). */
  protected onProjectChange(projectId: string): void {
    const current = this.statusOptions().find((s) => s.id === this.status());
    this.projectId.set(projectId);
    this.status.set(remapStatus(this.store.state(), projectId, this.status(), current?.category ?? 'todo'));
  }

  protected error(field: string): string {
    return this.submitted() ? this.validation().error(field) : '';
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    if (!this.validation().valid) {
      const firstInvalid = (event.target as HTMLElement).querySelector<HTMLElement>('[aria-invalid="true"]');
      firstInvalid?.focus();
      return;
    }
    this.saved.emit(this.draft());
  }
}
