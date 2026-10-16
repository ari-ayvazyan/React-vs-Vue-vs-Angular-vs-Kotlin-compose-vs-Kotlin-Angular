import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Shortcuts } from '../core/kt';
import { UiService } from '../core/ui.service';
import { Dialog } from '../shared/dialog';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-help-modal',
  imports: [Dialog, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ui.helpOpen()) {
      <app-dialog labelId="help-title" (closed)="ui.helpOpen.set(false)">
        <header class="dialog-header">
          <h2 id="help-title">Keyboard shortcuts</h2>
          <button type="button" class="icon-btn" aria-label="Close dialog" (click)="ui.helpOpen.set(false)">
            <app-icon name="close" />
          </button>
        </header>
        <dl class="shortcut-list">
          @for (row of rows; track row.description) {
            <div class="shortcut-row">
              <dt>
                @for (k of row.keys; track $index) {
                  <kbd>{{ k }}</kbd>
                }
              </dt>
              <dd>{{ row.description }}</dd>
            </div>
          }
        </dl>
        <p class="muted small">Shortcuts are disabled while typing in a field.</p>
      </app-dialog>
    }
  `,
})
export class HelpModal {
  protected readonly ui = inject(UiService);
  protected readonly rows = Shortcuts.helpRows();
}
