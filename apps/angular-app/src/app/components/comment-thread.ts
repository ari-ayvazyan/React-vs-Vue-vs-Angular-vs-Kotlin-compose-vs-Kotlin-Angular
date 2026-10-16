import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { StoreService } from '../services/store.service';
import { COMMENT_MAX, Comment, Member } from '../core/models';
import {
  MentionQuery,
  activeMention,
  insertMention,
  mentionCandidates,
  parseBody,
} from '../core/mentions';
import { Avatar } from './avatar';

/** Comments of a task (oldest first) and a composer with `@` member autocomplete. */
@Component({
  selector: 'app-comment-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Avatar],
  template: `
    <ol class="comments" data-testid="comment-list">
      @for (c of comments(); track c.id) {
        <li class="comment" data-testid="comment">
          <app-avatar [member]="author(c)" [size]="30" labelPrefix="" />
          <div class="comment-main">
            <div class="comment-head">
              <strong>{{ author(c)?.name ?? 'Former member' }}</strong>
              <time class="muted" [attr.datetime]="c.createdAt">{{ fmt(c.createdAt) }}</time>
            </div>
            <p class="body">
              @for (seg of segments(c); track $index) {
                @if (seg.kind === 'text') {
                  <span>{{ seg.text }}</span>
                } @else {
                  <span class="mention" data-testid="mention"
                    >@{{ seg.name ?? 'former member' }}</span
                  >
                }
              }
            </p>
          </div>
        </li>
      } @empty {
        <li class="muted no-comments">No comments yet.</li>
      }
    </ol>

    @if (store.currentUser(); as me) {
      <form class="composer" (submit)="submit($event)" novalidate>
        <app-avatar [member]="me" [size]="30" labelPrefix="Commenting as" />
        <div class="composer-main">
          <label class="sr-only" [for]="inputId">Add a comment</label>
          <div class="textarea-wrap">
            <textarea
              #box
              [id]="inputId"
              class="input"
              rows="3"
              placeholder="Write a comment… Type @ to mention someone. Ctrl+Enter to send."
              data-testid="comment-input"
              role="combobox"
              aria-autocomplete="list"
              [attr.aria-expanded]="candidates().length > 0"
              [attr.aria-controls]="listId"
              [attr.aria-activedescendant]="candidates().length ? optionId(active()) : null"
              [value]="text()"
              (input)="onInput()"
              (click)="refreshMention()"
              (keyup)="onKeyup($event)"
              (keydown)="onKeydown($event)"
              (blur)="mention.set(null)"
            ></textarea>
            @if (candidates().length) {
              <ul class="mentions" role="listbox" [id]="listId" aria-label="Mention a member">
                @for (m of candidates(); track m.id; let i = $index) {
                  <li
                    role="option"
                    [id]="optionId(i)"
                    [attr.aria-selected]="i === active()"
                    [class.active]="i === active()"
                    data-testid="mention-option"
                    (mousedown)="$event.preventDefault()"
                    tabindex="-1"
                    (click)="pick(m)"
                    (keydown.enter)="pick(m)"
                    (mouseenter)="active.set(i)"
                  >
                    <app-avatar [member]="m" [size]="20" labelPrefix="" />
                    {{ m.name }}
                  </li>
                }
              </ul>
            }
          </div>
          <div class="composer-foot">
            <span class="counter" [class.over]="text().length > max"
              >{{ text().length }}/{{ max }}</span
            >
            <button
              type="submit"
              class="btn btn-primary btn-sm"
              data-testid="comment-submit"
              [disabled]="!text().trim() || text().length > max"
            >
              Comment
            </button>
          </div>
        </div>
      </form>
    } @else {
      <p class="muted no-user">
        Choose a <a routerLink="/settings" fragment="current-user">current user</a> in Settings to
        comment.
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .comments {
      list-style: none;
      margin: 0 0 14px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .comment {
      display: flex;
      gap: 10px;
    }
    .comment-main {
      min-width: 0;
      flex: 1;
    }
    .comment-head {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: 0.86rem;
    }
    .comment-head time {
      font-size: 0.78rem;
    }
    .body {
      margin: 3px 0 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 0.9rem;
    }
    .mention {
      padding: 0 3px;
      border-radius: 4px;
      background: var(--primary-soft);
      color: var(--primary-strong);
      font-weight: 600;
    }
    .no-comments,
    .no-user {
      font-size: 0.86rem;
    }
    .composer {
      display: flex;
      gap: 10px;
    }
    .composer-main {
      flex: 1;
      min-width: 0;
    }
    .textarea-wrap {
      position: relative;
    }
    textarea {
      width: 100%;
      resize: vertical;
    }
    .mentions {
      position: absolute;
      z-index: 30;
      left: 0;
      top: 100%;
      margin: 4px 0 0;
      padding: 4px;
      min-width: 220px;
      list-style: none;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-lg);
    }
    .mentions li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.88rem;
    }
    .mentions li.active {
      background: var(--primary-soft);
    }
    .composer-foot {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 10px;
      margin-top: 6px;
    }
    .counter {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .counter.over {
      color: var(--danger);
    }
  `,
})
export class CommentThread {
  protected readonly store = inject(StoreService);
  readonly taskId = input.required<string>();

  private static seq = 0;
  private readonly uid = `ct${++CommentThread.seq}`;
  protected readonly inputId = `${this.uid}-input`;
  protected readonly listId = `${this.uid}-list`;
  protected readonly max = COMMENT_MAX;
  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');

  protected readonly text = signal('');
  protected readonly mention = signal<MentionQuery | null>(null);
  protected readonly active = signal(0);

  protected readonly comments = computed(
    () => this.store.taskMap().get(this.taskId())?.comments ?? [],
  );
  protected readonly candidates = computed(() => {
    const m = this.mention();
    return m ? mentionCandidates(m.query, this.store.members()) : [];
  });

  protected author(c: Comment): Member | undefined {
    return this.store.memberMap().get(c.authorId);
  }

  protected segments(c: Comment) {
    return parseBody(c.body, this.store.memberMap());
  }

  protected fmt(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected optionId(i: number): string {
    return `${this.uid}-opt-${i}`;
  }

  protected onInput(): void {
    const el = this.box()?.nativeElement;
    if (!el) return;
    this.text.set(el.value);
    this.refreshMention();
  }

  /** Re-detects the mention under the caret (after typing, clicking or moving with arrows). */
  protected refreshMention(): void {
    const el = this.box()?.nativeElement;
    if (!el) return;
    const m = activeMention(el.value, el.selectionStart ?? el.value.length);
    const prev = this.mention();
    if (!m || !prev || m.start !== prev.start || m.query !== prev.query) this.active.set(0);
    this.mention.set(m);
  }

  protected onKeyup(e: KeyboardEvent): void {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')
      this.refreshMention();
  }

  protected onKeydown(e: KeyboardEvent): void {
    const list = this.candidates();
    if (list.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        this.active.set((this.active() + d + list.length) % list.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.pick(list[this.active()]);
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

  protected pick(m: Member): void {
    const el = this.box()?.nativeElement;
    const mention = this.mention();
    if (!el || !mention) return;
    const res = insertMention(el.value, mention, el.selectionStart ?? el.value.length, m);
    el.value = res.text;
    this.text.set(res.text);
    this.mention.set(null);
    el.focus();
    el.setSelectionRange(res.caret, res.caret);
  }

  protected submit(e: Event): void {
    e.preventDefault();
    this.send();
  }

  private send(): void {
    if (this.store.addComment(this.taskId(), this.text())) {
      this.text.set('');
      this.mention.set(null);
      const el = this.box()?.nativeElement;
      if (el) el.value = '';
    }
  }
}
