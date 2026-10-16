import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { DayCount } from '../core/stats';
import { formatShortDate } from '../core/dates';
import { niceScale, scaleTicks } from '../core/chart-scale';

/** Width before the first measurement (and on the server). */
const DEFAULT_W = 640;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 30, left: 36 };

@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart-wrap">
      <svg
        [attr.viewBox]="'0 0 ' + w() + ' ' + h"
        role="img"
        [attr.aria-label]="ariaLabel()"
        (mousemove)="onMove($event)"
        (mouseleave)="hover.set(null)"
      >
        <defs>
          <linearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--chart-1)" stop-opacity="0.32" />
            <stop offset="1" stop-color="var(--chart-1)" stop-opacity="0" />
          </linearGradient>
        </defs>
        @for (t of yTicks(); track t.value) {
          <line
            class="grid"
            [attr.x1]="pad.left"
            [attr.x2]="w() - pad.right"
            [attr.y1]="t.y"
            [attr.y2]="t.y"
          />
          <text class="axis" [attr.x]="pad.left - 8" [attr.y]="t.y + 4" text-anchor="end">
            {{ t.value }}
          </text>
        }
        @for (t of xTicks(); track t.x) {
          <text class="axis" [attr.x]="t.x" [attr.y]="h - 8" text-anchor="middle">
            {{ t.label }}
          </text>
        }
        <path class="area" [attr.d]="areaPath()" fill="url(#lc-fill)" />
        <path class="line" [attr.d]="linePath()" />
        @if (hover(); as hv) {
          <line
            class="cursor"
            [attr.x1]="hv.x"
            [attr.x2]="hv.x"
            [attr.y1]="pad.top"
            [attr.y2]="h - pad.bottom"
          />
          <circle class="point" [attr.cx]="hv.x" [attr.cy]="hv.y" r="5" />
        }
      </svg>
      @if (hover(); as hv) {
        <div class="tooltip" [style.left.%]="(hv.x / w()) * 100" [style.top.%]="(hv.y / h) * 100">
          <strong>{{ hv.count }}</strong> {{ valueLabel() }}<br /><span>{{ hv.label }}</span>
        </div>
      }
    </div>
    <div class="sr-only">
      <table>
        <caption>
          {{
            ariaLabel()
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">{{ valueLabel() }}</th>
          </tr>
        </thead>
        <tbody>
          @for (d of data(); track d.date) {
            <tr>
              <td>{{ d.date }}</td>
              <td>{{ d.count }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .chart-wrap {
      position: relative;
    }
    svg {
      display: block;
      width: 100%;
      height: 240px;
      overflow: visible;
    }
    .grid {
      stroke: var(--chart-grid);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    .axis {
      fill: var(--text-muted);
      font-size: 11px;
    }
    .line {
      fill: none;
      stroke: var(--chart-1);
      stroke-width: 2.5;
      vector-effect: non-scaling-stroke;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .cursor {
      stroke: var(--border-strong);
      stroke-dasharray: 3 3;
      vector-effect: non-scaling-stroke;
    }
    .point {
      fill: var(--surface);
      stroke: var(--chart-1);
      stroke-width: 2.5;
      vector-effect: non-scaling-stroke;
    }
    .tooltip {
      position: absolute;
      transform: translate(-50%, calc(-100% - 12px));
      pointer-events: none;
      background: var(--toast-bg);
      color: var(--toast-text);
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 0.78rem;
      line-height: 1.35;
      white-space: nowrap;
      box-shadow: var(--shadow-lg);
      text-align: center;
    }
    .tooltip span {
      opacity: 0.75;
    }
  `,
})
export class LineChart {
  readonly data = input.required<DayCount[]>();
  readonly ariaLabel = input('Tasks completed per day');
  /** Noun after the value in the tooltip / table header, e.g. "completed" or "open". */
  readonly valueLabel = input('completed');

  /**
   * The viewBox tracks the rendered width (1 unit = 1 CSS px), so axis text is never stretched
   * however wide the chart is drawn.
   */
  protected readonly w = signal(DEFAULT_W);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const measure = () => {
        const width = Math.round(host.clientWidth);
        if (width > 0 && width !== this.w()) this.w.set(width);
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(measure);
      ro.observe(host);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }
  protected readonly h = H;
  protected readonly pad = PAD;
  protected readonly hover = signal<{ x: number; y: number; count: number; label: string } | null>(
    null,
  );

  private readonly scale = computed(() =>
    niceScale(Math.max(0, ...this.data().map((d) => d.count))),
  );
  private readonly maxY = computed(() => this.scale().max);

  private x(i: number): number {
    const n = this.data().length;
    return PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * (this.w() - PAD.left - PAD.right));
  }

  private y(v: number): number {
    return PAD.top + (1 - v / this.maxY()) * (H - PAD.top - PAD.bottom);
  }

  protected readonly yTicks = computed(() =>
    scaleTicks(this.scale()).map((value) => ({ value, y: this.y(value) })),
  );

  protected readonly xTicks = computed(() => {
    const d = this.data();
    const out: { x: number; label: string }[] = [];
    for (let i = d.length - 1; i >= 0; i -= 7)
      out.unshift({ x: this.x(i), label: formatShortDate(d[i].date) });
    return out;
  });

  protected readonly linePath = computed(() =>
    this.data()
      .map((d, i) => `${i ? 'L' : 'M'}${this.x(i).toFixed(1)},${this.y(d.count).toFixed(1)}`)
      .join(' '),
  );

  protected readonly areaPath = computed(() => {
    const d = this.data();
    if (!d.length) return '';
    const base = this.y(0);
    return `${this.linePath()} L${this.x(d.length - 1).toFixed(1)},${base} L${this.x(0).toFixed(1)},${base} Z`;
  });

  protected onMove(e: MouseEvent): void {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * this.w();
    const d = this.data();
    if (!d.length) return;
    const n = d.length;
    const i = Math.round(((px - PAD.left) / (this.w() - PAD.left - PAD.right)) * (n - 1));
    const idx = Math.max(0, Math.min(n - 1, i));
    this.hover.set({
      x: this.x(idx),
      y: this.y(d[idx].count),
      count: d[idx].count,
      label: formatShortDate(d[idx].date),
    });
  }
}
