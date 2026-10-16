import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Placeholder shown during SSR and until localStorage data is loaded on the client. */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="skeleton" aria-busy="true" aria-label="Loading">
      @for (r of rowsArr(); track $index) {
        <div class="skeleton-row"></div>
      }
    </div>
  `,
})
export class Skeleton {
  readonly rows = input(6);
  protected rowsArr(): number[] {
    return Array.from({ length: this.rows() }, (_, i) => i);
  }
}
