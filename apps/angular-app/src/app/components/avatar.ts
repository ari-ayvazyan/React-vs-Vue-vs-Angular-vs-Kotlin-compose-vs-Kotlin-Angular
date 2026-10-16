import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Member } from '../core/models';
import { avatarTextColor, initials } from '../core/members';

/** Round avatar with the member's initials on their colour. Renders a dashed "nobody" circle for null. */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'avatar',
    role: 'img',
    '[class.avatar-none]': '!member()',
    '[attr.aria-label]': 'label()',
    '[attr.title]': 'label()',
    '[style.--size]': "size() + 'px'",
    '[style.background]': 'member()?.color ?? null',
    '[style.color]': 'fg()',
  },
  template: `{{ text() }}`,
  styles: `
    :host {
      --size: 24px;
      display: inline-grid;
      place-items: center;
      flex-shrink: 0;
      width: var(--size);
      height: var(--size);
      border-radius: 50%;
      font-size: calc(var(--size) * 0.42);
      font-weight: 700;
      letter-spacing: 0.02em;
      line-height: 1;
      user-select: none;
    }
    :host(.avatar-none) {
      border: 1.5px dashed var(--border-strong);
      color: var(--text-muted);
    }
  `,
})
export class Avatar {
  readonly member = input<Member | null | undefined>(null);
  readonly size = input(24);
  /** Override the accessible label (defaults to "Assigned to <name>" / "Unassigned"). */
  readonly labelPrefix = input('Assigned to');

  protected readonly text = computed(() => {
    const m = this.member();
    return m ? initials(m.name) : '';
  });
  protected readonly fg = computed(() => {
    const m = this.member();
    return m ? avatarTextColor(m.color) : null;
  });
  protected readonly label = computed(() => {
    const m = this.member();
    if (!m) return 'Unassigned';
    return this.labelPrefix() ? `${this.labelPrefix()} ${m.name}` : m.name;
  });
}
