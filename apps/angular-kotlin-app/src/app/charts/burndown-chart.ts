import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Burndown, nearestPointIndex } from '../core/kt';

/** Hand-drawn SVG burndown (open tasks per day + ideal line); geometry from Kotlin `buildBurndown`. */
@Component({
  selector: 'app-burndown-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = data().chart;
    <div class="line-chart">
      <svg
        [attr.viewBox]="'0 0 ' + c.width + ' ' + c.height"
        role="img"
        [attr.aria-label]="ariaLabel()"
        tabindex="0"
        (mousemove)="onMove($event)"
        (mouseleave)="hover.set(-1)"
        (blur)="hover.set(-1)"
        (keydown)="onKey($event)"
      >
        @for (t of c.yTicks; track $index) {
          <line class="grid" [attr.x1]="c.left" [attr.x2]="c.width - c.right" [attr.y1]="t.position" [attr.y2]="t.position" />
          <text class="axis" [attr.x]="c.left - 8" [attr.y]="t.position + 4" text-anchor="end">{{ t.label }}</text>
        }
        @for (t of c.xTicks; track $index) {
          <text class="axis" [attr.x]="t.position" [attr.y]="c.height - 8" text-anchor="middle">{{ t.label }}</text>
        }
        <path class="ideal" [attr.d]="data().idealPath" />
        <path class="area" [attr.d]="c.areaPath" fill="url(#area-fill-burndown)" />
        <defs>
          <linearGradient id="area-fill-burndown" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path class="line" [attr.d]="c.linePath" />
        @if (active(); as p) {
          <line class="cursor" [attr.x1]="p.x" [attr.x2]="p.x" [attr.y1]="c.top" [attr.y2]="c.height - c.bottom" />
          <circle class="dot" [attr.cx]="p.x" [attr.cy]="p.y" r="5" />
        }
      </svg>
      @if (active(); as p) {
        <div class="chart-tooltip" [style.left.%]="(p.x / c.width) * 100" [style.top.%]="(p.y / c.height) * 100" role="presentation">
          <strong>{{ p.value }}</strong> open<br /><span class="muted">{{ p.label }}</span>
        </div>
      }
    </div>
    <ul class="legend legend-inline" aria-hidden="true">
      <li><span class="swatch" style="background: var(--accent)"></span>Open tasks</li>
      <li><span class="swatch swatch-dashed"></span>Ideal</li>
    </ul>
  `,
})
export class BurndownChartComponent {
  readonly data = input.required<Burndown>();
  protected readonly hover = signal(-1);
  protected readonly active = computed(() => this.data().chart.points[this.hover()] ?? null);
  protected readonly ariaLabel = computed(() => {
    const d = this.data();
    return `Burndown over the last 30 days: ${d.start} open tasks 30 days ago, ${d.end} today. Use arrow keys to inspect days.`;
  });

  protected onMove(e: MouseEvent): void {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    if (rect.width === 0) return;
    const chart = this.data().chart;
    this.hover.set(nearestPointIndex(chart, ((e.clientX - rect.left) / rect.width) * chart.width));
  }

  protected onKey(e: KeyboardEvent): void {
    const n = this.data().chart.points.length;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const cur = this.hover() < 0 ? n - 1 : this.hover();
    this.hover.set(Math.min(n - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1))));
  }
}
