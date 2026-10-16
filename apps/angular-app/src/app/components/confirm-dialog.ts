import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Modal } from './modal';

@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Modal],
  template: `
    <app-modal [heading]="heading()" (closed)="cancelled.emit()">
      <p class="msg">{{ message() }}</p>
      <div class="actions">
        <button type="button" class="btn btn-ghost" (click)="cancelled.emit()">Cancel</button>
        <button
          type="button"
          class="btn"
          [class.btn-danger]="danger()"
          [class.btn-primary]="!danger()"
          data-autofocus
          (click)="confirmed.emit()"
        >
          {{ confirmLabel() }}
        </button>
      </div>
    </app-modal>
  `,
  styles: `
    .msg {
      margin: 0 0 20px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class ConfirmDialog {
  readonly heading = input('Are you sure?');
  readonly message = input.required<string>();
  readonly confirmLabel = input('Confirm');
  readonly danger = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
