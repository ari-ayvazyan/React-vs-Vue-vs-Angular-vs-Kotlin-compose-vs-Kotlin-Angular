import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Task } from '../core/kt';
import { StoreService } from '../core/store.service';

/** A task's workflow status (name + colour); resolution against the project's workflow happens in Kotlin. */
@Component({
  selector: 'app-status-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="status-pill" [attr.data-status]="status().category" [style.--status-color]="status().color">{{ status().name }}</span>`,
})
export class StatusPill {
  readonly task = input.required<Task>();
  private readonly store = inject(StoreService);
  protected readonly status = computed(() => this.store.statusOf(this.task()));
}
