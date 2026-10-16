import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectProgress } from '../core/kt';

/** Horizontal bar chart: completion % per project. */
@Component({
  selector: 'app-project-bars',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="bars" role="list">
      @for (p of projects(); track p.projectId) {
        <li class="bar-row">
          <a class="bar-label" [routerLink]="['/tasks']" [queryParams]="{ project: p.projectId }">{{ p.name }}</a>
          <div
            class="bar-track"
            role="progressbar"
            [attr.aria-label]="p.name + ' completion'"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="p.percent"
          >
            <div class="bar-fill" [style.width.%]="p.percent" [style.background]="p.color"></div>
          </div>
          <span class="bar-value">{{ p.percent }}%</span>
          <span class="bar-sub muted">{{ p.done }}/{{ p.total }}</span>
        </li>
      } @empty {
        <li class="muted">No projects yet.</li>
      }
    </ul>
  `,
})
export class ProjectBarsComponent {
  readonly projects = input.required<ProjectProgress[]>();
}
