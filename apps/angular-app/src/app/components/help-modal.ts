import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Modal } from './modal';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-help-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Modal],
  template: `
    @if (ui.helpOpen()) {
      <app-modal heading="Keyboard shortcuts" (closed)="ui.helpOpen.set(false)">
        <dl class="shortcuts">
          @for (s of shortcuts; track s.label) {
            <div class="row">
              <dt>{{ s.label }}</dt>
              <dd>
                @for (k of s.keys; track $index) {
                  @if ($index > 0) {
                    <span class="then">{{ s.sep ?? 'then' }}</span>
                  }
                  <kbd>{{ k }}</kbd>
                }
              </dd>
            </div>
          }
        </dl>
      </app-modal>
    }
  `,
  styles: `
    .shortcuts {
      margin: 0;
      display: grid;
      gap: 2px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
    }
    .row:last-child {
      border-bottom: 0;
    }
    dt {
      color: var(--text);
    }
    dd {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }
    .then {
      color: var(--text-muted);
      font-size: 0.75rem;
    }
  `,
})
export class HelpModal {
  protected readonly ui = inject(UiService);
  protected readonly shortcuts: { label: string; keys: string[]; sep?: string }[] = [
    { label: 'New task', keys: ['n'] },
    { label: 'Focus search', keys: ['/'] },
    { label: 'Go to dashboard', keys: ['g', 'd'] },
    { label: 'Go to tasks', keys: ['g', 't'] },
    { label: 'Go to board', keys: ['g', 'b'] },
    { label: 'Go to calendar', keys: ['g', 'c'] },
    { label: 'Go to timeline', keys: ['g', 'l'] },
    { label: 'Go to reports', keys: ['g', 'r'] },
    { label: 'Go to activity', keys: ['g', 'a'] },
    { label: 'Undo', keys: ['Ctrl/⌘', 'Z'], sep: '+' },
    { label: 'Redo', keys: ['Ctrl/⌘', 'Shift', 'Z'], sep: '+' },
    { label: 'Board: move card to column', keys: ['Shift', '← / →'], sep: '+' },
    { label: 'Board: reorder card', keys: ['Shift', '↑ / ↓'], sep: '+' },
    { label: 'Show this help', keys: ['?'] },
    { label: 'Close dialog', keys: ['Esc'] },
  ];
}
