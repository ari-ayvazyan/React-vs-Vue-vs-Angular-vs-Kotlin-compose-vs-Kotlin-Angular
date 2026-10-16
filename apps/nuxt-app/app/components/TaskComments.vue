<script setup lang="ts">
import type { Member, Task, TaskComment } from '~/lib/types';
import { COMMENT_MAX, activeMention, insertMention, matchMembers } from '~/lib/mentions';
import type { MentionQuery } from '~/lib/mentions';
import { formatDateTime, formatRelativeTime } from '~/lib/dates';
import { useTaskStore } from '~/stores/tasks';
import { useUiStore } from '~/stores/ui';

const props = defineProps<{ task: Task }>();
const store = useTaskStore();
const ui = useUiStore();
const uidBase = useId();

const authorName = (c: TaskComment): string => store.memberById.get(c.authorId)?.name ?? 'Former member';

// ----- composer with @mention autocomplete -----
const text = ref('');
const error = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);
const mention = ref<MentionQuery | null>(null);
const active = ref(0);
const suggestions = computed<Member[]>(() => (mention.value ? matchMembers(store.members, mention.value.query) : []));
const listOpen = computed(() => suggestions.value.length > 0);
const optionId = (i: number): string => `${uidBase}-mention-${i}`;

function refreshMention(): void {
  const el = textarea.value;
  if (!el || el.selectionStart !== el.selectionEnd) {
    mention.value = null;
    return;
  }
  const next = activeMention(text.value, el.selectionStart);
  if (next?.start !== mention.value?.start || next?.query !== mention.value?.query) active.value = 0;
  mention.value = next;
}

async function pick(m: Member): Promise<void> {
  const el = textarea.value;
  if (!el || !mention.value) return;
  const r = insertMention(text.value, mention.value, el.selectionStart, m);
  text.value = r.text;
  mention.value = null;
  await nextTick();
  el.focus();
  el.setSelectionRange(r.caret, r.caret);
}

function onKeydown(e: KeyboardEvent): void {
  if (listOpen.value) {
    const n = suggestions.value.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      void pick(suggestions.value[active.value] as Member);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      mention.value = null;
      return;
    }
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    submit();
  }
}

function submit(): void {
  const msg = store.addComment(props.task.id, text.value);
  error.value = msg;
  if (msg) return;
  text.value = '';
  mention.value = null;
}

function remove(c: TaskComment): void {
  store.deleteComment(props.task.id, c.id);
  ui.toast('Comment deleted', { actionLabel: 'Undo', action: () => store.undo() });
}
</script>

<template>
  <section class="card" aria-labelledby="comments-title" data-testid="task-comments">
    <div class="card-header">
      <h2 id="comments-title" class="card-title">Comments</h2>
      <span v-if="task.comments.length" class="muted small">{{ task.comments.length }}</span>
    </div>
    <div class="card-body">
      <ol v-if="task.comments.length" class="comments">
        <li v-for="c in task.comments" :key="c.id" class="comment" data-testid="comment">
          <MemberAvatar :member-id="c.authorId" :size="28" placeholder />
          <div class="c-main">
            <div class="c-head">
              <strong>{{ authorName(c) }}</strong>
              <time :datetime="c.createdAt" :title="formatDateTime(c.createdAt)" class="muted small">{{ formatRelativeTime(c.createdAt) }}</time>
              <button type="button" class="btn btn-ghost btn-icon btn-sm c-del" :aria-label="`Delete comment by ${authorName(c)}`" @click="remove(c)">
                <AppIcon name="trash" :size="13" />
              </button>
            </div>
            <CommentBody :body="c.body" />
          </div>
        </li>
      </ol>
      <p v-else class="muted none">No comments yet.</p>

      <form class="composer" novalidate @submit.prevent="submit">
        <div class="as">
          <template v-if="store.currentUser">
            <MemberAvatar :member-id="store.currentUser.id" :size="24" />
            <span class="muted small">Commenting as <strong>{{ store.currentUser.name }}</strong></span>
          </template>
          <span v-else class="muted small">No current user set. <NuxtLink to="/settings#team">Choose who you are</NuxtLink> to comment.</span>
        </div>
        <label :for="`${uidBase}-comment`" class="sr-only">New comment</label>
        <div class="ta-wrap">
          <textarea
            :id="`${uidBase}-comment`"
            ref="textarea"
            v-model="text"
            class="textarea"
            rows="3"
            :maxlength="COMMENT_MAX"
            placeholder="Write a comment… type @ to mention someone"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="listOpen"
            :aria-controls="`${uidBase}-mentions`"
            :aria-activedescendant="listOpen ? optionId(active) : undefined"
            :aria-invalid="error ? 'true' : 'false'"
            :aria-describedby="error ? `${uidBase}-comment-err` : `${uidBase}-comment-hint`"
            data-testid="comment-input"
            @input="refreshMention"
            @click="refreshMention"
            @keyup="(e: KeyboardEvent) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && refreshMention()"
            @keydown="onKeydown"
            @blur="mention = null"
          />
          <ul v-show="listOpen" :id="`${uidBase}-mentions`" class="mentions" role="listbox" aria-label="Mention a team member" data-testid="mention-list">
            <li
              v-for="(m, i) in suggestions"
              :id="optionId(i)"
              :key="m.id"
              role="option"
              class="opt"
              :class="{ active: i === active }"
              :aria-selected="i === active"
              @mousedown.prevent="pick(m)"
              @mousemove="active = i"
            >
              <MemberAvatar :member-id="m.id" :size="22" />
              {{ m.name }}
            </li>
          </ul>
        </div>
        <p v-if="error" :id="`${uidBase}-comment-err`" class="field-error" role="alert">{{ error }}</p>
        <div class="c-actions">
          <span :id="`${uidBase}-comment-hint`" class="muted small">Ctrl+Enter to post</span>
          <button type="submit" class="btn btn-primary btn-sm" :disabled="!store.currentUser" data-testid="comment-submit">
            <AppIcon name="message" :size="14" />
            Comment
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.small {
  font-size: 12.5px;
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
  align-items: flex-start;
}

.c-main {
  flex: 1;
  min-width: 0;
}

.c-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.c-del {
  margin-left: auto;
  opacity: 0.55;
}

.c-del:hover,
.c-del:focus-visible {
  opacity: 1;
}

.none {
  margin: 0 0 14px;
}

.composer {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.as {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ta-wrap {
  position: relative;
}

.mentions {
  position: absolute;
  z-index: 30;
  left: 8px;
  top: calc(100% + 4px);
  min-width: 220px;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
}

.opt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
}

.opt.active {
  background: var(--accent-soft);
}

.c-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
</style>
