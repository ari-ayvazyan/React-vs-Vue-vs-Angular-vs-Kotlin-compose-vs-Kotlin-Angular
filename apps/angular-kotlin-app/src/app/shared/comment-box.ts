import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { Limits, Member, MentionQuery, applyMention, mentionAt, mentionSuggestions } from '../core/kt';
import { StoreService } from '../core/store.service';
import { UiService } from '../core/ui.service';
import { Avatar } from './avatar';

/** Comment composer with @mention autocomplete (mention parsing/insertion in Kotlin). */
@Component({
  selector: 'app-comment-box',
  imports: [Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.currentUser(); as me) {
      <form class="comment-form" (submit)="submit($event)" novalidate>
        <app-avatar [member]="me" size="sm" />
        <div class="comment-input">
          <label class="sr-only" for="comment-body">Comment as {{ me.name }}</label>
          <textarea
            #box
            id="comment-body"
            data-testid="comment-input"
            rows="3"
            placeholder="Write a comment… Type @ to mention someone. Ctrl+Enter to send."
            role="combobox"
            aria-autocomplete="list"
            aria-controls="mention-list"
            [attr.aria-expanded]="suggestions().length > 0"
            [attr.aria-activedescendant]="suggestions().length ? 'mention-opt-' + active() : null"
            [attr.aria-invalid]="error() ? 'true' : null"
            [attr.aria-describedby]="error() ? 'comment-err' : null"
            [value]="text()"
            (input)="update()"
            (click)="update()"
            (keyup)="onKeyup($event)"
            (keydown)="onKeydown($event)"
            (blur)="mention.set(null)"
          ></textarea>
          @if (suggestions().length) {
            <ul class="picker-list mention-list" id="mention-list" role="listbox" aria-label="Mention a member" data-testid="mention-list">
              @for (m of suggestions(); track m.id; let i = $index) {
                <li
                  role="option"
                  class="picker-option"
                  [id]="'mention-opt-' + i"
                  [class.active]="i === active()"
                  [attr.aria-selected]="i === active()"
                  (mousedown)="$event.preventDefault(); insert(m)"
                >
                  <app-avatar [member]="m" size="sm" /> {{ m.name }}
                </li>
              }
            </ul>
          }
          @if (error()) {
            <p class="field-error" id="comment-err">{{ error() }}</p>
          }
          <div class="comment-actions">
            <span class="counter" [class.over]="text().length > max">{{ text().length }}/{{ max }}</span>
            <button type="submit" class="btn btn-primary btn-sm" data-testid="comment-submit">Comment</button>
          </div>
        </div>
      </form>
    } @else {
      <p class="muted small">Choose the current user in Settings to comment.</p>
    }
  `,
})
export class CommentBox {
  readonly taskId = input.required<string>();
  protected readonly store = inject(StoreService);
  private readonly ui = inject(UiService);
  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');
  protected readonly max = Limits.COMMENT_MAX;
  protected readonly text = signal('');
  protected readonly error = signal('');
  protected readonly mention = signal<MentionQuery | null>(null);
  protected readonly active = signal(0);
  protected readonly suggestions = computed(() => {
    const m = this.mention();
    return m ? mentionSuggestions(this.store.members(), m.query, 6) : [];
  });

  protected update(): void {
    const el = this.box()?.nativeElement;
    if (!el) return;
    this.text.set(el.value);
    this.error.set('');
    const m = mentionAt(el.value, el.selectionStart ?? el.value.length) ?? null;
    if (m?.start !== this.mention()?.start || m?.query !== this.mention()?.query) this.active.set(0);
    this.mention.set(m);
  }

  protected onKeyup(e: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) this.update();
  }

  protected onKeydown(e: KeyboardEvent): void {
    const list = this.suggestions();
    if (list.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.active.set((this.active() + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.insert(list[this.active()]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.mention.set(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.send();
    }
  }

  protected insert(member: Member): void {
    const el = this.box()?.nativeElement;
    const m = this.mention();
    if (!el || !m) return;
    const r = applyMention(el.value, m, el.selectionStart ?? el.value.length, member);
    el.value = r.text;
    el.setSelectionRange(r.caret, r.caret);
    el.focus();
    this.text.set(r.text);
    this.mention.set(null);
  }

  protected submit(e: Event): void {
    e.preventDefault();
    this.send();
  }

  private send(): void {
    const err = this.store.addComment(this.taskId(), this.text());
    this.error.set(err);
    if (err) return;
    this.text.set('');
    const el = this.box()?.nativeElement;
    if (el) el.value = '';
    this.ui.toast('Comment added', { tone: 'success' });
  }
}
