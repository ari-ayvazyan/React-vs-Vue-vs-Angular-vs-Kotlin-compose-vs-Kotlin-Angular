import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BarDatum, buildHBars } from '../core/kt';

/** Generic hand-drawn SVG horizontal bar chart (geometry from Kotlin `buildHBars`). */
@Component({
  selector: 'app-hbar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = chart();
    <svg class="hbar-chart" [attr.viewBox]="'0 0 ' + c.width + ' ' + c.height" role="img" [attr.aria-label]="ariaLabel()">
      @for (t of c.xTicks; track $index) {
        <line class="grid" [attr.x1]="t.position" [attr.x2]="t.position" y1="0" [attr.y2]="c.height - 22" />
        <text class="axis" [attr.x]="t.position" [attr.y]="c.height - 6" text-anchor="middle">{{ t.label }}</text>
      }
      @for (r of c.rows; track r.key) {
        <g>
          <title>{{ r.label }}: {{ r.valueLabel }}</title>
          <text class="bar-name" [attr.x]="c.left - 10" [attr.y]="r.y + c.barHeight / 2 + 5" text-anchor="end">{{ r.label }}</text>
          <rect class="bar-bg" [attr.x]="c.left" [attr.y]="r.y" [attr.width]="c.width - c.left - c.right" [attr.height]="c.barHeight" rx="5" />
          <rect [attr.x]="c.left" [attr.y]="r.y" [attr.width]="r.width" [attr.height]="c.barHeight" rx="5" [attr.fill]="r.color" />
          <text class="bar-num" [attr.x]="c.left + r.width + 6" [attr.y]="r.y + c.barHeight / 2 + 5">{{ r.valueLabel }}</text>
        </g>
      }
    </svg>
  `,
})
export class HBarChartComponent {
  readonly data = input.required<BarDatum[]>();
  readonly description = input('');
  protected readonly chart = computed(() => buildHBars(this.data(), 600));
  protected readonly ariaLabel = computed(
    () => `${this.description()}: ` + this.data().map((d) => `${d.label} ${d.valueLabel}`).join(', '),
  );
}
