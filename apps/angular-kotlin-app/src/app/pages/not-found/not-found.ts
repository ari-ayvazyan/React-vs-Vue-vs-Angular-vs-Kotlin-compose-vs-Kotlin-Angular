import { ChangeDetectionStrategy, Component, RESPONSE_INIT, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="empty-page">
      <p class="big-code" aria-hidden="true">404</p>
      <h1>Page not found</h1>
      <p class="muted">The page you are looking for does not exist or has been moved.</p>
      <a class="btn btn-primary" routerLink="/dashboard">Back to dashboard</a>
    </section>
  `,
})
export class NotFoundPage {
  constructor() {
    const init = inject(RESPONSE_INIT, { optional: true });
    if (init) init.status = 404;
  }
}
