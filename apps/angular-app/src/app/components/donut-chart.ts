import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

const R = 60;
const C = 2 * Math.PI * R;

@Component({
  selector: 'app-donut-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="donut">
      <svg viewBox="0 0 160 160" role="img" [attr.aria-label]="ariaLabel()">
        <g transform="rotate(-90 80 80)">
          <circle cx="80" cy="80" [attr.r]="r" class="track" />
          @for (s of arcs(); track s.label) {
            <circle
              cx="80"
              cy="80"
              [attr.r]="r"
              class="seg"
              [class.dim]="active() !== null && active() !== s.label"
              [attr.stroke]="s.color"
              [attr.stroke-dasharray]="s.dash + ' ' + (c - s.dash)"
              [attr.stroke-dashoffset]="-s.offset"
              (mouseenter)="active.set(s.label)"
              (mouseleave)="active.set(null)"
            />
          }
        </g>
        <text x="80" y="80" text-anchor="middle" class="big">{{ activeValue() }}</text>
        <text x="80" y="100" text-anchor="middle" class="small">
          {{ active() ?? centerLabel() }}
        </text>
      </svg>
      <ul class="legend">
        @for (s of arcs(); track s.label) {
          <li (mouseenter)="active.set(s.label)" (mouseleave)="active.set(null)">
            <span class="dot" [style.background]="s.color"></span>
            <span class="lbl">{{ s.label }}</span>
            <span class="val">{{ s.value }}</span>
            <span class="pct">{{ s.pct }}%</span>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .donut {
      display: flex;
      align-items: center;
      gap: 24px;
      flex-wrap: wrap;
      justify-content: center;
    }
    svg {
      width: 168px;
      height: 168px;
      flex-shrink: 0;
    }
    .track {
      fill: none;
      stroke: var(--surface-2);
      stroke-width: 20;
    }
    .seg {
      fill: none;
      stroke-width: 20;
      transition:
        opacity 0.15s,
        stroke-width 0.15s;
      cursor: pointer;
    }
    .seg:hover {
      stroke-width: 24;
    }
    .seg.dim {
      opacity: 0.35;
    }
    .big {
      font-size: 26px;
      font-weight: 700;
      fill: var(--text);
    }
    .small {
      font-size: 11px;
      fill: var(--text-muted);
    }
    .legend {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
      min-width: 160px;
      flex: 1;
    }
    .legend li {
      display: grid;
      grid-template-columns: 10px 1fr auto 44px;
      align-items: center;
      gap: 10px;
      font-size: 0.88rem;
    }
    .lbl {
      color: var(--text);
    }
    .val {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .pct {
      color: var(--text-muted);
      text-align: right;
      font-size: 0.8rem;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class DonutChart {
  readonly segments = input.required<DonutSegment[]>();
  readonly ariaLabel = input('Donut chart');
  readonly centerLabel = input('total');
  protected readonly r = R;
  protected readonly c = C;
  protected readonly active = signal<string | null>(null);

  protected readonly total = computed(() => this.segments().reduce((a, s) => a + s.value, 0));
  protected readonly activeValue = computed(() => {
    const a = this.active();
    return a === null ? this.total() : (this.segments().find((s) => s.label === a)?.value ?? 0);
  });
  protected readonly arcs = computed(() => {
    const total = this.total();
    let offset = 0;
    return this.segments().map((s) => {
      const dash = total ? (s.value / total) * C : 0;
      const arc = { ...s, dash, offset, pct: total ? Math.round((s.value / total) * 100) : 0 };
      offset += dash;
      return arc;
    });
  });
}
