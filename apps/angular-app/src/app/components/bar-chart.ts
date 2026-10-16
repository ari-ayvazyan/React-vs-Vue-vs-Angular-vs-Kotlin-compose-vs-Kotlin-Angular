import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface BarDatum {
  id: string;
  label: string;
  percent: number;
  color: string;
  detail: string;
}

@Component({
  selector: 'app-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="bars" role="list" [attr.aria-label]="ariaLabel()">
      @for (b of data(); track b.id) {
        <li class="bar-row" [attr.title]="b.label + ': ' + b.percent + '% (' + b.detail + ')'">
          <span class="label">{{ b.label }}</span>
          <span
            class="track"
            role="img"
            [attr.aria-label]="b.label + ' ' + b.percent + '% complete, ' + b.detail"
          >
            <span class="fill" [style.width.%]="b.percent" [style.background]="b.color"></span>
          </span>
          <span class="value">{{ b.percent }}%</span>
        </li>
      } @empty {
        <li class="muted">No projects yet.</li>
      }
    </ul>
  `,
  styles: `
    .bars {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 14px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: minmax(80px, 130px) 1fr 44px;
      align-items: center;
      gap: 12px;
      font-size: 0.88rem;
    }
    .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .track {
      height: 12px;
      background: var(--surface-2);
      border-radius: 999px;
      overflow: hidden;
    }
    .fill {
      display: block;
      height: 100%;
      border-radius: 999px;
      transition: width 0.4s ease;
    }
    .value {
      text-align: right;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class BarChart {
  readonly data = input.required<BarDatum[]>();
  readonly ariaLabel = input('Bar chart');
}
