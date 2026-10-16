import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  Priority,
  RECURRENCES,
  RECURRENCE_LABELS,
  Status,
  Task,
} from '../core/models';
import {
  LIMITS,
  TaskDraft,
  TaskDraftErrors,
  parseEstimate,
  parseTags,
  validateTaskDraft,
} from '../core/validation';
import { StoreService } from '../services/store.service';
import { openBlockers } from '../core/dependencies';
import { Icon } from './icon';

export interface TaskFormDefaults {
  status?: Status;
  statusId?: string;
  dueDate?: string;
  projectId?: string | null;
  assigneeId?: string | null;
}

function draftFrom(task: Task | null, d: TaskFormDefaults | undefined): TaskDraft {
  return task
    ? {
        title: task.title,
        description: task.description,
        statusId: task.statusId,
        status: task.status,
        priority: task.priority,
        projectId: task.projectId,
        assigneeId: task.assigneeId,
        recurrence: task.recurrence,
        tags: [...task.tags],
        dueDate: task.dueDate,
        estimate: task.estimateMinutes === null ? '' : String(task.estimateMinutes),
      }
    : {
        title: '',
        description: '',
        statusId: d?.statusId ?? '',
        status: d?.status ?? 'todo',
        priority: 'medium',
        projectId: d?.projectId ?? null,
        assigneeId: d?.assigneeId ?? null,
        recurrence: 'none',
        tags: [],
        dueDate: d?.dueDate ?? null,
        estimate: '',
      };
}

let formSeq = 0;

@Component({
  selector: 'app-task-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './task-form.html',
  styleUrl: './task-form.css',
})
export class TaskForm {
  protected readonly store = inject(StoreService);

  readonly task = input<Task | null>(null);
  readonly defaults = input<TaskFormDefaults | undefined>(undefined);
  readonly inline = input(false);
  readonly saved = output<Task>();
  readonly cancelled = output<void>();

  protected readonly id = `tf${++formSeq}`;
  protected readonly limits = LIMITS;
  /** Statuses of the selected project's (effective) workflow. */
  protected readonly statusOptions = computed(() =>
    this.store.workflowOf()(this.draft().projectId),
  );
  /** The draft's status id, resolved against the current workflow. */
  protected readonly selectedStatusId = computed(() => {
    const d = this.draft();
    const wf = this.statusOptions();
    return (
      wf.find((s) => s.id === d.statusId)?.id ??
      wf.find((s) => s.category === d.status)?.id ??
      wf[0]?.id ??
      ''
    );
  });
  protected readonly priorities = PRIORITIES;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly recurrences = RECURRENCES;
  protected readonly recurrenceLabels = RECURRENCE_LABELS;
  protected readonly members = this.store.members;
  protected readonly allTags = this.store.allTags;

  /** Form-relevant projection of the task; only changes when editable fields change (not e.g. time spent). */
  private readonly source = computed(() => draftFrom(this.task(), this.defaults()), {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  /** Re-initialises whenever the bound task's editable fields change (e.g. after undo). */
  protected readonly draft = linkedSignal(() => this.source());
  protected readonly tagInput = signal('');
  protected readonly submitted = signal(false);
  protected readonly errors = computed<TaskDraftErrors>(() => {
    const errs = validateTaskDraft(this.draft());
    const blocked = this.blockedError();
    return blocked ? { ...errs, status: blocked } : errs;
  });
  /** Completing an existing task that still waits for open blockers is not allowed. */
  private readonly blockedError = computed(() => {
    const t = this.task();
    if (!t || t.status === 'done' || this.draft().status !== 'done') return '';
    const open = openBlockers(t, this.store.taskMap());
    return open.length
      ? `Blocked by ${open.map((b) => `“${b.title}”`).join(', ')}. Finish those first.`
      : '';
  });
  protected readonly shownErrors = computed<TaskDraftErrors>(() =>
    this.submitted() ? this.errors() : liveErrors(this.errors(), this.draft()),
  );
  protected readonly dirty = computed(
    () => JSON.stringify(this.draft()) !== JSON.stringify(this.source()),
  );

  protected cancel(): void {
    this.draft.set(this.source());
    this.tagInput.set('');
    this.submitted.set(false);
    this.cancelled.emit();
  }

  protected patch(p: Partial<TaskDraft>): void {
    this.draft.update((d) => ({ ...d, ...p }));
  }

  protected setStatusId(id: string): void {
    const s = this.statusOptions().find((x) => x.id === id);
    if (s) this.patch({ statusId: s.id, status: s.category });
  }

  /** Another project may use another workflow: keep the category, pick that workflow's status. */
  protected setProject(projectId: string | null): void {
    const d = this.draft();
    const wf = this.store.workflowOf()(projectId);
    const keep = wf.find((s) => s.id === d.statusId) ?? wf.find((s) => s.category === d.status);
    this.patch({ projectId, statusId: keep?.id ?? '', status: keep?.category ?? d.status });
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected onTagKey(e: KeyboardEvent): void {
    const el = e.target as HTMLInputElement;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      this.commitTags();
    } else if (e.key === 'Backspace' && !el.value && this.draft().tags.length) {
      this.patch({ tags: this.draft().tags.slice(0, -1) });
    }
  }

  protected commitTags(): void {
    const add = parseTags(this.tagInput());
    if (add.length) {
      const tags = [...this.draft().tags];
      for (const t of add) if (!tags.includes(t)) tags.push(t);
      this.patch({ tags });
    }
    this.tagInput.set('');
  }

  protected removeTag(tag: string): void {
    this.patch({ tags: this.draft().tags.filter((t) => t !== tag) });
  }

  protected submit(e: Event): void {
    e.preventDefault();
    this.commitTags();
    this.submitted.set(true);
    const errs = this.errors();
    if (Object.keys(errs).length) {
      const firstKey = Object.keys(errs)[0];
      setTimeout(() => document.getElementById(`${this.id}-${firstKey}`)?.focus());
      return;
    }
    const d = this.draft();
    const data = {
      title: d.title.trim(),
      description: d.description,
      statusId: this.selectedStatusId(),
      status: d.status,
      priority: d.priority as Priority,
      projectId: d.projectId,
      assigneeId: d.assigneeId,
      recurrence: d.recurrence,
      tags: d.tags,
      dueDate: d.dueDate || null,
      estimateMinutes: parseEstimate(d.estimate),
    };
    const existing = this.task();
    if (existing) {
      this.store.updateTask(existing.id, data);
      this.submitted.set(false);
      this.saved.emit(this.store.getTask(existing.id) ?? existing);
    } else {
      this.saved.emit(this.store.createTask(data));
    }
  }
}

/** Before first submit only show errors that are "obviously" wrong (over limits), not "required". */
function liveErrors(errs: TaskDraftErrors, d: TaskDraft): TaskDraftErrors {
  const out: TaskDraftErrors = { ...errs };
  if (!d.title.trim()) delete out.title;
  return out;
}
