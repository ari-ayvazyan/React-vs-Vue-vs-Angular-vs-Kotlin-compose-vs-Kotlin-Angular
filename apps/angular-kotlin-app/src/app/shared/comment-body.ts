import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { renderComment } from '../core/kt';
import { StoreService } from '../core/store.service';

/** Renders a comment with highlighted @mentions (segmentation in Kotlin). */
@Component({
  selector: 'app-comment-body',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="comment-text">@for (s of segments(); track $index) {@if (s.memberId) {<mark class="mention" data-testid="mention" [title]="store.member(s.memberId)?.name ?? ''">{{ s.text }}</mark>} @else {{{ s.text }}}}</p>`,
})
export class CommentBody {
  readonly body = input.required<string>();
  protected readonly store = inject(StoreService);
  protected readonly segments = computed(() => renderComment(this.body(), this.store.members()));
}
