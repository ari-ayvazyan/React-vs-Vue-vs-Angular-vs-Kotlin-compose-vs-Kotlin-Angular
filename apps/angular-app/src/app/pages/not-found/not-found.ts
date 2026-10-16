import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="nf">
      <p class="code" aria-hidden="true">404</p>
      <h1>Page not found</h1>
      <p class="muted">The page you are looking for doesn't exist or has moved.</p>
      <div class="actions">
        <a class="btn btn-primary" routerLink="/dashboard">Go to dashboard</a>
        <a class="btn" routerLink="/tasks">View tasks</a>
      </div>
    </div>
  `,
  styles: `
    .nf {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 72px 16px;
    }
    .code {
      margin: 0;
      font-size: 6rem;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.04em;
      background: linear-gradient(135deg, #6366f1, #ec4899);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    h1 {
      margin: 12px 0 6px;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      flex-wrap: wrap;
      justify-content: center;
    }
  `,
})
export class NotFoundPage {}
