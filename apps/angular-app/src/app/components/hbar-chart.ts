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
import { niceScale, scaleTicks } from '../core/chart-scale';

export interface HBarDatum {
  id: string;
  label: string;
  value: number;
  color: string;
  /**
   * Round badge drawn before the label: member initials, `null` for an empty dashed circle
   * (e.g. "Unassigned"), or omitted for no badge at all.
   */
  badge?: { text: string; fg: string } | null;
  /** Value as displayed (defaults to the number), e.g. "3.5 d". */
  display?: string;
}

const ROW = 34;
const BAR = 16;
const PAD = { top: 4, right: 40, bottom: 26 };
const BADGE_R = 11;

/**
 * Horizontal bar chart of absolute counts, in hand-written SVG. The viewBox tracks the rendered
 * width (ResizeObserver), so 1 unit = 1 CSS px and labels never get stretched or shrunk.
 */
@Component({
  selector: 'app-hbar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart-wrap">
      <svg
        [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
        [attr.height]="height()"
        role="img"
        [attr.aria-label]="ariaLabel()"
        (mouseleave)="hover.set(null)"
      >
        @for (t of ticks(); track t.value) {
          <line
            class="grid"
            [attr.x1]="t.x"
            [attr.x2]="t.x"
            [attr.y1]="pad.top"
            [attr.y2]="height() - pad.bottom"
          />
          <text class="axis" [attr.x]="t.x" [attr.y]="height() - 8" text-anchor="middle">
            {{ t.value }}
          </text>
        }
        @for (r of rows(); track r.id; let i = $index) {
          <g
            class="row"
            [class.dim]="hover() !== null && hover() !== i"
            (mouseenter)="hover.set(i)"
          >
            <rect
              class="hit"
              x="0"
              [attr.y]="r.y"
              [attr.width]="width()"
              [attr.height]="row"
              rx="6"
            />
            @if (r.badge) {
              <circle [attr.cx]="badgeR" [attr.cy]="r.cy" [attr.r]="badgeR" [attr.fill]="r.color" />
              <text
                class="badge-text"
                [attr.x]="badgeR"
                [attr.y]="r.cy + 3.5"
                text-anchor="middle"
                [attr.fill]="r.badge.fg"
              >
                {{ r.badge.text }}
              </text>
            } @else if (r.badge === null) {
              <circle
                class="badge-empty"
                [attr.cx]="badgeR"
                [attr.cy]="r.cy"
                [attr.r]="badgeR - 1"
              />
            }
            <text
              class="label"
              [attr.x]="r.badge === undefined ? 0 : badgeR * 2 + 8"
              [attr.y]="r.cy + 4"
            >
              {{ r.shortLabel }}
            </text>
            <rect
              class="track"
              [attr.x]="plotX()"
              [attr.y]="r.cy - bar / 2"
              [attr.width]="plotW()"
              [attr.height]="bar"
              rx="4"
            />
            @if (r.w > 0) {
              <rect
                class="fill"
                [attr.x]="plotX()"
                [attr.y]="r.cy - bar / 2"
                [attr.width]="r.w"
                [attr.height]="bar"
                rx="4"
                [attr.fill]="r.color"
              />
            }
            <text class="value" [attr.x]="plotX() + r.w + 6" [attr.y]="r.cy + 4">
              {{ r.display ?? r.value }}
            </text>
          </g>
        }
      </svg>
      @if (hover() !== null && rows()[hover()!]; as r) {
        <div class="tooltip" [style.left.px]="plotX() + r.w / 2" [style.top.px]="r.y">
          <strong>{{ r.display ?? r.value }}</strong> {{ unit() }}<br /><span>{{ r.label }}</span>
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
            <th scope="col">Name</th>
            <th scope="col">{{ unit() }}</th>
          </tr>
        </thead>
        <tbody>
          @for (d of data(); track d.id) {
            <tr>
              <td>{{ d.label }}</td>
              <td>{{ d.display ?? d.value }}</td>
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
      overflow: visible;
    }
    .grid {
      stroke: var(--chart-grid);
      stroke-width: 1;
    }
    .axis {
      fill: var(--text-muted);
      font-size: 11px;
    }
    .hit {
      fill: transparent;
    }
    .row:hover .hit {
      fill: var(--hover);
    }
    .row {
      transition: opacity 0.12s;
    }
    .row.dim {
      opacity: 0.55;
    }
    .badge-text {
      font-size: 9.5px;
      font-weight: 700;
    }
    .badge-empty {
      fill: none;
      stroke: var(--border-strong);
      stroke-width: 1.5;
      stroke-dasharray: 3 2;
    }
    .label {
      fill: var(--text);
      font-size: 13px;
    }
    .track {
      fill: var(--surface-2);
    }
    .value {
      fill: var(--text);
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .tooltip {
      position: absolute;
      transform: translate(-50%, calc(-100% - 4px));
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
export class HBarChart {
  readonly data = input.required<HBarDatum[]>();
  readonly ariaLabel = input('Bar chart');
  /** Noun for the values, used in the tooltip and the screen-reader table. */
  readonly unit = input('tasks');

  protected readonly pad = PAD;
  protected readonly row = ROW;
  protected readonly bar = BAR;
  protected readonly badgeR = BADGE_R;
  protected readonly width = signal(480);
  protected readonly hover = signal<number | null>(null);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const measure = () => {
        const w = Math.round(host.clientWidth);
        if (w > 0 && w !== this.width()) this.width.set(w);
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(measure);
      ro.observe(host);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  protected readonly height = computed(() => PAD.top + this.data().length * ROW + PAD.bottom);
  /** Label column: ~40% of the width, between 110 and 180px. */
  protected readonly plotX = computed(() =>
    Math.round(Math.min(180, Math.max(110, this.width() * 0.4))),
  );
  protected readonly plotW = computed(() => Math.max(20, this.width() - this.plotX() - PAD.right));
  private readonly scale = computed(() =>
    niceScale(Math.max(0, ...this.data().map((d) => d.value))),
  );

  protected readonly ticks = computed(() => {
    const s = this.scale();
    const { step } = s;
    // fewer gridlines when narrow
    const every = this.plotW() / (s.max / step) < 28 ? 2 : 1;
    return scaleTicks(s)
      .filter((_, i) => i % every === 0)
      .map((value) => ({ value, x: this.plotX() + (value / s.max) * this.plotW() }));
  });

  protected readonly rows = computed(() => {
    const max = this.scale().max;
    // ~6.5px per character at 13px; long names are ellipsised (full name in tooltip/table)
    const labelChars = Math.max(6, Math.floor((this.plotX() - BADGE_R * 2 - 16) / 6.5));
    return this.data().map((d, i) => {
      const y = PAD.top + i * ROW;
      return {
        ...d,
        y,
        cy: y + ROW / 2,
        w: (Math.max(0, d.value) / max) * this.plotW(),
        shortLabel: d.label.length > labelChars ? `${d.label.slice(0, labelChars - 1)}…` : d.label,
      };
    });
  });
}
