import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PrioritySlice, buildDonut } from '../core/kt';

/** SVG donut chart with legend; arcs are computed in Kotlin (`buildDonut`). */
@Component({
  selector: 'app-donut-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = donut();
    <div class="donut">
      <svg viewBox="0 0 200 200" role="img" [attr.aria-label]="ariaLabel()">
        @if (d.total === 0) {
          <circle cx="100" cy="100" r="66" fill="none" stroke="var(--border)" stroke-width="28" />
        }
        @for (a of d.arcs; track a.label) {
          <path [attr.d]="a.path" [attr.fill]="a.color" fill-rule="evenodd"><title>{{ a.label }}: {{ a.value }} ({{ a.percent }}%)</title></path>
        }
        <text x="100" y="98" text-anchor="middle" class="donut-total">{{ d.total }}</text>
        <text x="100" y="120" text-anchor="middle" class="donut-caption">open tasks</text>
      </svg>
      <ul class="legend">
        @for (s of slices(); track s.priority) {
          <li>
            <span class="swatch" [style.background]="s.color"></span>
            <span class="legend-label">{{ s.label }}</span>
            <span class="legend-value">{{ s.count }}</span>
          </li>
        }
      </ul>
    </div>
  `,
})
export class DonutChartComponent {
  readonly slices = input.required<PrioritySlice[]>();
  protected readonly donut = computed(() => buildDonut(this.slices(), 100, 100, 80, 52));
  protected readonly ariaLabel = computed(
    () => 'Open tasks by priority: ' + this.slices().map((s) => `${s.label} ${s.count}`).join(', '),
  );
}
