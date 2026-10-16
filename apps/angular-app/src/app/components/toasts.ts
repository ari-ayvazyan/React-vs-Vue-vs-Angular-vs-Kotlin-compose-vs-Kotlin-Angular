import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../services/toast.service';
import { Icon } from './icon';

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="toasts" aria-live="polite" aria-atomic="false" role="status">
      @for (t of svc.toasts(); track t.id) {
        <div
          class="toast"
          [class.toast-success]="t.kind === 'success'"
          [class.toast-error]="t.kind === 'error'"
          data-testid="toast"
        >
          <span class="msg">{{ t.message }}</span>
          @if (t.actionLabel) {
            <button type="button" class="toast-action" (click)="svc.runAction(t)">
              {{ t.actionLabel }}
            </button>
          }
          <button
            type="button"
            class="icon-btn sm"
            (click)="svc.dismiss(t.id)"
            aria-label="Dismiss notification"
          >
            <app-icon name="close" [size]="14" />
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .toasts {
      position: fixed;
      z-index: 200;
      bottom: 16px;
      right: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-end;
      pointer-events: none;
      max-width: calc(100vw - 32px);
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 260px;
      max-width: 420px;
      padding: 10px 10px 10px 14px;
      border-radius: var(--radius);
      background: var(--toast-bg);
      color: var(--toast-text);
      box-shadow: var(--shadow-lg);
      border-left: 4px solid var(--primary);
      animation: slide 0.18s ease-out;
      font-size: 0.9rem;
    }
    .toast-success {
      border-left-color: var(--success);
    }
    .toast-error {
      border-left-color: var(--danger);
    }
    .msg {
      flex: 1;
    }
    .toast-action {
      border: 0;
      background: transparent;
      color: var(--toast-accent);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
    }
    .toast-action:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .icon-btn {
      color: inherit;
    }
    @keyframes slide {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }
    @media (max-width: 480px) {
      .toasts {
        left: 16px;
        right: 16px;
        align-items: stretch;
      }
      .toast {
        min-width: 0;
        max-width: none;
      }
    }
  `,
})
export class Toasts {
  protected readonly svc = inject(ToastService);
}
