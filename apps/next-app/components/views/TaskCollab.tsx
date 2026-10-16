'use client';

import Link from 'next/link';
import { useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { describeEntry, entryTaskTitles, taskActivity, type ActivityLookup } from '@/lib/activity';
import { formatDateTime } from '@/lib/dates';
import { cycleMessage, findCycle, taskMap } from '@/lib/dependencies';
import { matchesSearch, searchTerms } from '@/lib/filters';
import { COMMENT_MAX, activeMention, encodeMentions, matchMembers, parseMentions, type MentionQuery } from '@/lib/mentions';
import { STATUS_LABEL, type ActivityEntry, type AppState, type Member, type Project, type Task } from '@/lib/types';
import { findStatus, workflowResolver } from '@/lib/workflow';
import { Avatar } from '../bits';
import { IconActivity, IconLock, IconMessage, IconX } from '../icons';
import { dispatch, nowIso } from '../store-hooks';
import { useToast } from '../toast';
import { newId } from '../ui';
import styles from './collab.module.css';
import detail from './detail.module.css';

// ---------------------------------------------------------------------------
// Shared bits

/** Renders a stored comment body, highlighting `@{id}` mentions with the member's current name. */
export function MentionText({ body, members }: { body: string; members: Member[] }) {
  return (
    <>
      {parseMentions(body).map((p, i) => {
        if (p.kind === 'text') return <span key={i}>{p.text}</span>;
        const m = members.find((x) => x.id === p.memberId);
        return (
          <span key={i} className={`${styles.mention} ${m ? '' : styles.mentionGone}`} data-testid="mention">
            @{m ? m.name : 'removed member'}
          </span>
        );
      })}
    </>
  );
}

function ActorAvatar({ member, size = 24 }: { member: Member | undefined; size?: number }) {
  if (member) return <Avatar member={member} size={size} />;
  return <span className={styles.ghostAvatar} style={{ width: size, height: size }} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Dependencies

const MAX_OPTIONS = 8;

export function DependenciesPanel({ task, tasks, projects }: { task: Task; tasks: Task[]; projects: Project[] }) {
  const toast = useToast();
  const workflowOf = useMemo(() => workflowResolver(projects), [projects]);
  const statusLabel = (t: Task) => findStatus(workflowOf(t.projectId), t.statusId)?.name ?? STATUS_LABEL[t.category];
  const uid = useId();
  const byId = useMemo(() => taskMap(tasks), [tasks]);
  const blocking = useMemo(() => tasks.filter((t) => t.blockedBy.includes(task.id)), [tasks, task.id]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => {
    const terms = searchTerms(text);
    if (!terms.length) return [];
    const out: Task[] = [];
    // Open tasks first: they are the useful blockers.
    for (const pass of [false, true]) {
      for (const t of tasks) {
        if (out.length >= MAX_OPTIONS) break;
        if (t.id === task.id || task.blockedBy.includes(t.id) || (t.category === 'done') !== pass) continue;
        if (matchesSearch(t, terms)) out.push(t);
      }
    }
    return out;
  }, [text, tasks, task.id, task.blockedBy]);

  const listId = `${uid}-options`;
  const showList = open && text.trim().length > 0;
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  const choose = (blocker: Task) => {
    const cycle = findCycle(byId, task.id, blocker.id);
    if (cycle) {
      setError(cycleMessage(cycle, byId));
      return;
    }
    dispatch({ type: 'task/addBlocker', id: task.id, blockerId: blocker.id });
    toast(`“${task.title}” is now blocked by “${blocker.title}”`, { undo: true, tone: 'success' });
    setError(null);
    setText('');
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (options.length) setActive((activeIndex + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showList && options[activeIndex]) choose(options[activeIndex]);
    } else if (e.key === 'Escape' && showList) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  const openBlockerCount = task.blockedBy.filter((id) => byId.get(id) && byId.get(id)!.category !== 'done').length;

  return (
    <section className={`card ${detail.panel}`} aria-labelledby="deps-title" data-testid="dependencies-panel">
      <div className={detail.panelHead}>
        <h2 id="deps-title" className="section-title">
          Dependencies
        </h2>
        <span className="muted">
          {task.category !== 'done' && openBlockerCount > 0 ? (
            <span className={styles.blockedNote}>
              <IconLock size={12} /> Blocked by {openBlockerCount} open task{openBlockerCount === 1 ? '' : 's'}
            </span>
          ) : (
            `${task.blockedBy.length} blocker${task.blockedBy.length === 1 ? '' : 's'}`
          )}
        </span>
      </div>

      <h3 className={styles.subhead}>Blocked by</h3>
      {task.blockedBy.length ? (
        <ul className={styles.depList}>
          {task.blockedBy.map((id) => {
            const b = byId.get(id);
            if (!b) return null;
            return (
              <li key={id} className={styles.depRow} data-testid="blocker-row">
                <span className={`${styles.depStatus} ${styles[`st_${b.category}`]}`}>{statusLabel(b)}</span>
                <Link href={`/tasks/${b.id}`} className={styles.depTitle}>
                  {b.title}
                </Link>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  aria-label={`Remove blocker “${b.title}”`}
                  onClick={() => {
                    dispatch({ type: 'task/removeBlocker', id: task.id, blockerId: id });
                    toast(`Removed blocker “${b.title}”`, { undo: true });
                  }}
                >
                  <IconX size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={`muted ${styles.empty}`}>Nothing blocks this task.</p>
      )}

      <div className={styles.picker}>
        <label htmlFor={`${uid}-search`} className="label">
          Add a blocker
        </label>
        <input
          id={`${uid}-search`}
          className="input"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && options.length ? `${listId}-${activeIndex}` : undefined}
          aria-invalid={!!error}
          aria-describedby={error ? `${uid}-error` : undefined}
          placeholder="Search tasks by title, description or tag…"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
            setError(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          data-testid="dependency-search"
        />
        {showList && (
          <ul id={listId} role="listbox" className={styles.options} aria-label="Matching tasks">
            {options.length ? (
              options.map((t, i) => (
                <li
                  key={t.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`${styles.option} ${i === activeIndex ? styles.optionActive : ''}`}
                  // mousedown (not click) so the input's blur doesn't close the list first
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(t);
                  }}
                  onMouseEnter={() => setActive(i)}
                  data-testid="dependency-option"
                >
                  <span className={styles.optionTitle}>{t.title}</span>
                  <span className={`${styles.depStatus} ${styles[`st_${t.category}`]}`}>{statusLabel(t)}</span>
                </li>
              ))
            ) : (
              <li className={styles.noOptions} role="presentation">
                No matching tasks
              </li>
            )}
          </ul>
        )}
        {error && (
          <p className="error-text" id={`${uid}-error`} role="alert" data-testid="dependency-error">
            {error}
          </p>
        )}
      </div>

      {blocking.length > 0 && (
        <>
          <h3 className={styles.subhead}>Blocking</h3>
          <ul className={styles.depList}>
            {blocking.map((t) => (
              <li key={t.id} className={styles.depRow}>
                <span className={`${styles.depStatus} ${styles[`st_${t.category}`]}`}>{statusLabel(t)}</span>
                <Link href={`/tasks/${t.id}`} className={styles.depTitle}>
                  {t.title}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Comments

export function CommentsPanel({ task, members, currentUserId }: { task: Task; members: Member[]; currentUserId: string | null }) {
  const toast = useToast();
  const uid = useId();
  const author = members.find((m) => m.id === currentUserId);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Caret position to restore after inserting a mention (applied right after React commits the new value). */
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const pos = pendingCaret.current;
    if (pos === null) return;
    pendingCaret.current = null;
    inputRef.current?.setSelectionRange(pos, pos);
  });

  const suggestions = mention ? matchMembers(members, mention.query) : [];
  const showSuggestions = suggestions.length > 0;
  const activeIndex = Math.min(active, Math.max(0, suggestions.length - 1));
  const listId = `${uid}-mentions`;

  const sync = (value: string, caret: number) => {
    setMention(activeMention(value, caret));
    setActive(0);
  };

  const insert = (m: Member) => {
    if (!mention) return;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${m.name} ${text.slice(caret)}`;
    pendingCaret.current = mention.start + m.name.length + 2;
    setText(next);
    setMention(null);
    el?.focus();
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!author) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Write something first.');
      return;
    }
    if (trimmed.length > COMMENT_MAX) {
      setError(`Comments can be at most ${COMMENT_MAX} characters (currently ${trimmed.length}).`);
      return;
    }
    dispatch({
      type: 'task/addComment',
      id: task.id,
      comment: { id: newId('c'), authorId: author.id, body: encodeMentions(trimmed, members), createdAt: nowIso() },
    });
    toast('Comment added', { undo: true, tone: 'success' });
    setText('');
    setMention(null);
    setError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((activeIndex + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insert(suggestions[activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section className={`card ${detail.panel}`} aria-labelledby="comments-title" data-testid="comments-panel">
      <div className={detail.panelHead}>
        <h2 id="comments-title" className="section-title">
          Comments
        </h2>
        <span className="muted">{task.comments.length}</span>
      </div>

      {task.comments.length ? (
        <ol className={styles.comments}>
          {task.comments.map((c) => {
            const m = members.find((x) => x.id === c.authorId);
            return (
              <li key={c.id} className={styles.comment} data-testid="comment-item">
                <ActorAvatar member={m} size={30} />
                <div className={styles.commentBody}>
                  <div className={styles.commentMeta}>
                    <strong>{m ? m.name : 'Removed member'}</strong>
                    <time dateTime={c.createdAt} className="muted">
                      {formatDateTime(c.createdAt)}
                    </time>
                  </div>
                  <p className={styles.commentText}>
                    <MentionText body={c.body} members={members} />
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={`muted ${styles.empty}`}>No comments yet.</p>
      )}

      {author ? (
        <form onSubmit={submit} className={styles.commentForm} noValidate>
          <ActorAvatar member={author} size={30} />
          <div className={styles.commentInputWrap}>
            <label htmlFor={`${uid}-input`} className="sr-only">
              Comment as {author.name}
            </label>
            <textarea
              ref={inputRef}
              id={`${uid}-input`}
              className="textarea"
              rows={3}
              value={text}
              placeholder={`Comment as ${author.name}… Type @ to mention someone.`}
              role="combobox"
              aria-expanded={showSuggestions}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={showSuggestions ? `${listId}-${activeIndex}` : undefined}
              aria-invalid={!!error}
              aria-describedby={`${uid}-hint${error ? ` ${uid}-error` : ''}`}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
                sync(e.target.value, e.target.selectionStart);
              }}
              onSelect={(e) => sync(e.currentTarget.value, e.currentTarget.selectionStart)}
              onBlur={() => setMention(null)}
              onKeyDown={onKeyDown}
              data-testid="comment-input"
            />
            {showSuggestions && (
              <ul id={listId} role="listbox" className={styles.mentionList} aria-label="Mention a member">
                {suggestions.map((m, i) => (
                  <li
                    key={m.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={`${styles.option} ${i === activeIndex ? styles.optionActive : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insert(m);
                    }}
                    onMouseEnter={() => setActive(i)}
                    data-testid="mention-option"
                  >
                    <Avatar member={m} size={20} />
                    <span>{m.name}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.commentActions}>
              <span className="hint" id={`${uid}-hint`}>
                @ to mention · Ctrl/⌘ + Enter to send
              </span>
              <button type="submit" className="btn btn-primary btn-sm" data-testid="comment-submit">
                <IconMessage size={14} /> Comment
              </button>
            </div>
            {error && (
              <p className="error-text" id={`${uid}-error`}>
                {error}
              </p>
            )}
          </div>
        </form>
      ) : (
        <p className={styles.noAuthor}>
          Choose who you are under <Link href="/settings#members">Settings → Current user</Link> to comment.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Activity

export function lookupFor(state: AppState): ActivityLookup {
  const workflowOf = workflowResolver(state.projects);
  const projectOf = new Map(state.tasks.map((t) => [t.id, t.projectId]));
  return {
    statusName: (taskId, statusId) => findStatus(workflowOf(projectOf.get(taskId) ?? null), statusId)?.name,
    tasks: new Map([...entryTaskTitles(state.activity, state.tasks)].map(([id, title]) => [id, { title }])),
    projects: new Map(state.projects.map((p) => [p.id, p])),
    members: state.members,
  };
}

export function ActivityLine({ entry, lookup, showTask }: { entry: ActivityEntry; lookup: ActivityLookup; showTask?: boolean }) {
  const actor = entry.actorId ? lookup.members.find((m) => m.id === entry.actorId) : undefined;
  const comment = entry.type === 'comment' ? (entry.to ?? entry.from) : null;
  const title = lookup.tasks.get(entry.taskId)?.title ?? 'a deleted task';
  const exists = showTask && entry.type !== 'delete';
  return (
    <>
      <ActorAvatar member={actor} size={24} />
      <div className={styles.entryBody}>
        <p className={styles.entryText}>
          <strong>{actor ? actor.name : entry.actorId ? 'Removed member' : 'Someone'}</strong> {describeEntry(entry, lookup)}
          {showTask && (
            <>
              {' '}
              {entry.type === 'comment' ? 'on' : '·'}{' '}
              {exists ? (
                <Link href={`/tasks/${entry.taskId}`} className={styles.entryTask} prefetch={false}>
                  {title}
                </Link>
              ) : (
                <span className={styles.entryTask}>{title}</span>
              )}
            </>
          )}
        </p>
        {typeof comment === 'string' && (
          <blockquote className={`${styles.entryQuote} ${entry.to === null ? styles.entryQuoteGone : ''}`}>
            <MentionText body={comment} members={lookup.members} />
          </blockquote>
        )}
        <time dateTime={entry.at} className={styles.entryTime}>
          {formatDateTime(entry.at)}
        </time>
      </div>
    </>
  );
}

const TIMELINE_INITIAL = 12;

export function ActivityTimeline({ task, state }: { task: Task; state: AppState }) {
  const [showAll, setShowAll] = useState(false);
  const entries = useMemo(() => taskActivity(state.activity, task.id), [state.activity, task.id]);
  const lookup = useMemo(() => lookupFor(state), [state]);
  const shown = showAll ? entries : entries.slice(0, TIMELINE_INITIAL);
  return (
    <section className={`card ${detail.panel}`} aria-labelledby="timeline-title" data-testid="activity-timeline">
      <div className={detail.panelHead}>
        <h2 id="timeline-title" className="section-title">
          History
        </h2>
        <Link href="/activity" className="link">
          All activity
        </Link>
      </div>
      {entries.length ? (
        <ol className={styles.timeline}>
          {shown.map((e) => (
            <li key={e.id} className={styles.entry} data-testid="timeline-entry">
              <ActivityLine entry={e} lookup={lookup} />
            </li>
          ))}
        </ol>
      ) : (
        <p className={`muted ${styles.empty}`}>
          <IconActivity size={14} /> No recorded changes yet. Edits from now on appear here.
        </p>
      )}
      {entries.length > TIMELINE_INITIAL && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)} style={{ marginTop: 8 }}>
          {showAll ? 'Show less' : `Show all ${entries.length}`}
        </button>
      )}
    </section>
  );
}
