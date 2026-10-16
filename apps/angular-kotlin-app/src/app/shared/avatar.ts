import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Member } from '../core/kt';

/** Member avatar: initials on the member colour (text colour chosen in Kotlin for contrast). */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (member(); as m) {
      <span
        class="avatar"
        data-testid="avatar"
        [class.avatar-sm]="size() === 'sm'"
        [class.avatar-lg]="size() === 'lg'"
        [style.background]="m.color"
        [style.color]="m.textColor"
        [attr.title]="m.name"
        role="img"
        [attr.aria-label]="label()"
        >{{ m.initials }}</span
      >
    } @else if (showEmpty()) {
      <span class="avatar avatar-empty" [class.avatar-sm]="size() === 'sm'" title="Unassigned" role="img" aria-label="Unassigned">–</span>
    }
  `,
})
export class Avatar {
  readonly member = input<Member | null>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly showEmpty = input(false);
  protected readonly label = computed(() => `Assigned to ${this.member()?.name ?? 'nobody'}`);
}
