import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { DayCount, buildLineChart, nearestPointIndex } from '../core/kt';

/** Hand-drawn SVG area chart; geometry is computed in Kotlin (`buildLineChart`). */
@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = chart();
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
        <defs>
          <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.35" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
          </linearGradient>
        </defs>
        @for (t of c.yTicks; track $index) {
          <line class="grid" [attr.x1]="c.left" [attr.x2]="c.width - c.right" [attr.y1]="t.position" [attr.y2]="t.position" />
          <text class="axis" [attr.x]="c.left - 8" [attr.y]="t.position + 4" text-anchor="end">{{ t.label }}</text>
        }
        @for (t of c.xTicks; track $index) {
          <text class="axis" [attr.x]="t.position" [attr.y]="c.height - 8" text-anchor="middle">{{ t.label }}</text>
        }
        <path class="area" [attr.d]="c.areaPath" fill="url(#area-fill)" />
        <path class="line" [attr.d]="c.linePath" />
        @if (active(); as p) {
          <line class="cursor" [attr.x1]="p.x" [attr.x2]="p.x" [attr.y1]="c.top" [attr.y2]="c.height - c.bottom" />
          <circle class="dot" [attr.cx]="p.x" [attr.cy]="p.y" r="5" />
        }
      </svg>
      @if (active(); as p) {
        <div class="chart-tooltip" [style.left.%]="(p.x / c.width) * 100" [style.top.%]="(p.y / c.height) * 100" role="presentation">
          <strong>{{ p.value }}</strong> completed<br /><span class="muted">{{ p.label }}</span>
        </div>
      }
    </div>
  `,
})
export class LineChartComponent {
  readonly series = input.required<DayCount[]>();
  protected readonly chart = computed(() => buildLineChart(this.series(), 640, 240));
  protected readonly hover = signal(-1);
  protected readonly active = computed(() => this.chart().points[this.hover()] ?? null);
  protected readonly ariaLabel = computed(() => {
    const c = this.chart();
    return `Tasks completed per day over the last 30 days: ${c.total} in total, at most ${Math.max(0, ...c.points.map((p) => p.value))} on a single day. Use arrow keys to inspect days.`;
  });

  protected onMove(e: MouseEvent): void {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * this.chart().width;
    this.hover.set(nearestPointIndex(this.chart(), x));
  }

  protected onKey(e: KeyboardEvent): void {
    const n = this.chart().points.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const cur = this.hover() < 0 ? n - 1 : this.hover();
      this.hover.set(Math.min(n - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1))));
    }
  }
}
