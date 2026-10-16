import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AssigneeLoad, UNASSIGNED, buildAssigneeBars } from '../core/kt';

/** Hand-drawn SVG horizontal bar chart: open tasks per assignee (geometry from Kotlin `buildAssigneeBars`). */
@Component({
  selector: 'app-assignee-bars',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = chart();
    @if (c.rows.length) {
      <svg class="hbar-chart" [attr.viewBox]="'0 0 ' + c.width + ' ' + c.height" role="img" [attr.aria-label]="ariaLabel()">
        @for (t of c.xTicks; track $index) {
          <line class="grid" [attr.x1]="t.position" [attr.x2]="t.position" y1="0" [attr.y2]="c.height - 22" />
          <text class="axis" [attr.x]="t.position" [attr.y]="c.height - 6" text-anchor="middle">{{ t.label }}</text>
        }
        @for (r of c.rows; track r.key) {
          <a [routerLink]="['/tasks']" [queryParams]="{ assignee: r.key || unassigned, status: 'todo,in_progress' }">
            <title>{{ r.label }}: {{ r.value }} open</title>
            <text class="bar-name" [attr.x]="c.left - 10" [attr.y]="r.y + c.barHeight / 2 + 5" text-anchor="end">{{ r.label }}</text>
            <rect class="bar-bg" [attr.x]="c.left" [attr.y]="r.y" [attr.width]="c.width - c.left - 36" [attr.height]="c.barHeight" rx="5" />
            <rect [attr.x]="c.left" [attr.y]="r.y" [attr.width]="r.width" [attr.height]="c.barHeight" rx="5" [attr.fill]="r.color" />
            <text class="bar-num" [attr.x]="c.left + r.width + 6" [attr.y]="r.y + c.barHeight / 2 + 5">{{ r.value }}</text>
          </a>
        }
      </svg>
    } @else {
      <p class="muted small">No team members yet. Add them in Settings.</p>
    }
  `,
})
export class AssigneeBarsComponent {
  readonly loads = input.required<AssigneeLoad[]>();
  protected readonly unassigned = UNASSIGNED;
  protected readonly chart = computed(() => buildAssigneeBars(this.loads(), 600));
  protected readonly ariaLabel = computed(
    () => 'Open tasks per assignee: ' + this.loads().map((l) => `${l.name} ${l.open}`).join(', '),
  );
}
