import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Toast, UiService } from '../core/ui.service';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-toasts',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toast-region" role="status" aria-live="polite" aria-atomic="false">
      @for (t of ui.toasts(); track t.id) {
        <div class="toast" [class]="'toast toast-' + t.tone" data-testid="toast">
          <span class="toast-msg">{{ t.message }}</span>
          @if (t.actionLabel) {
            <button type="button" class="toast-action" (click)="run(t)">{{ t.actionLabel }}</button>
          }
          <button type="button" class="icon-btn icon-btn-sm" aria-label="Dismiss notification" (click)="ui.dismiss(t.id)">
            <app-icon name="close" [size]="14" />
          </button>
        </div>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly ui = inject(UiService);

  protected run(t: Toast): void {
    t.action?.();
    this.ui.dismiss(t.id);
  }
}
