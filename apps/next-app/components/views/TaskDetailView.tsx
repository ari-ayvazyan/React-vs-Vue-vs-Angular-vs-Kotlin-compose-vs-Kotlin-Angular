'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { formatLong, formatMinutes, formatShort, isoToDateKey, relativeDue } from '@/lib/dates';
import { isOverdue } from '@/lib/filters';
import { completionMessage, nextDueDate } from '@/lib/recurrence';
import { RECURRENCE_LABEL, STATUS_LABEL, type Settings, type Task } from '@/lib/types';
import { draftFromTask } from '@/lib/validation';
import { TaskForm } from '../TaskForm';
import { openBlockers, taskMap } from '@/lib/dependencies';
import { AssigneeChip, BlockedBadge, DueLabel, PageSkeleton, PriorityBadge, ProjectChip } from '../bits';
import { IconCheck, IconChevronLeft, IconPause, IconPlay, IconPlus, IconRepeat, IconReset, IconTrash, IconX } from '../icons';
import { formatClock, usePomodoro } from '../pomodoro';
import { dispatch, nowIso, useAppState, useToday } from '../store-hooks';
import { useToast } from '../toast';
import { useCompletionGuard } from '../completion';
import { ActivityTimeline, CommentsPanel, DependenciesPanel } from './TaskCollab';
import { categoryOf, newId } from '../ui';
import { effectiveWorkflow, findStatus, projectMap, projectPath } from '@/lib/workflow';
import styles from './detail.module.css';

function Subtasks({ task }: { task: Task }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = task.subtasks.filter((s) => s.done).length;
  const update = (subtasks: Task['subtasks']) => dispatch({ type: 'task/update', id: task.id, patch: { subtasks }, at: nowIso() });

  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setError('Enter a subtask title.');
      return;
    }
    if (t.length > 120) {
      setError('Subtask titles must be at most 120 characters.');
      return;
    }
    setError(null);
    update([...task.subtasks, { id: newId('s'), title: t, done: false }]);
    setTitle('');
  };

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="subtasks-title">
      <div className={styles.panelHead}>
        <h2 id="subtasks-title" className="section-title">
          Subtasks
        </h2>
        <span className="muted">
          {done}/{task.subtasks.length} done
        </span>
      </div>
      {task.subtasks.length > 0 && (
        <div className="progress" style={{ marginBottom: 12 }} aria-hidden="true">
          <span style={{ width: `${(done / task.subtasks.length) * 100}%`, background: 'var(--success)' }} />
        </div>
      )}
      <ul className={styles.subtasks}>
        {task.subtasks.map((s, i) => (
          <li key={s.id} className={`${styles.subtask} ${s.done ? styles.subDone : ''}`}>
            <label className={styles.subLabel}>
              <input
                type="checkbox"
                className="checkbox"
                checked={s.done}
                onChange={() => update(task.subtasks.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
              />
              <span>{s.title}</span>
            </label>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              onClick={() => update(task.subtasks.filter((x) => x.id !== s.id))}
              aria-label={`Remove subtask “${s.title}”`}
            >
              <IconX size={14} />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className={styles.addSub} noValidate>
        <label htmlFor="new-subtask" className="sr-only">
          New subtask
        </label>
        <input
          id="new-subtask"
          className="input"
          placeholder="Add a subtask…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? 'new-subtask-error' : undefined}
        />
        <button type="submit" className="btn">
          <IconPlus size={15} /> Add
        </button>
      </form>
      {error && (
        <p className="error-text" id="new-subtask-error" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
    </section>
  );
}

function PomodoroPanel({ task, settings, otherTitle }: { task: Task; settings: Settings; otherTitle: string | null }) {
  const pomo = usePomodoro();
  const mine = pomo.taskId === task.id;
  const remaining = mine ? pomo.remainingMs : settings.pomodoroMinutes * 60_000;
  const duration = mine ? pomo.durationMs : settings.pomodoroMinutes * 60_000;
  const progress = duration ? 1 - remaining / duration : 0;
  const R = 54;
  const C = 2 * Math.PI * R;

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="pomodoro-title">
      <div className={styles.panelHead}>
        <h2 id="pomodoro-title" className="section-title">
          Pomodoro
        </h2>
        <span className="muted">{settings.pomodoroMinutes} min focus</span>
      </div>
      <div className={styles.timer}>
        <svg viewBox="0 0 128 128" className={styles.timerRing} aria-hidden="true">
          <circle cx="64" cy="64" r={R} className={styles.ringTrack} />
          <circle
            cx="64"
            cy="64"
            r={R}
            className={`${styles.ringFill} ${mine && pomo.running ? styles.ringRunning : ''}`}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            transform="rotate(-90 64 64)"
          />
        </svg>
        <div className={styles.timerText}>
          <span className={styles.clock} role="timer" aria-live="off" aria-label={`${formatClock(remaining)} remaining`}>
            {formatClock(remaining)}
          </span>
          <span className="muted">{mine ? (pomo.running ? 'Focus time' : 'Paused') : 'Ready'}</span>
        </div>
      </div>
      {otherTitle && !mine && <p className={styles.timerNote}>A timer is active for “{otherTitle}”. Starting here will stop it and log its time.</p>}
      <div className={styles.timerButtons}>
        {mine && pomo.running ? (
          <button type="button" className="btn" onClick={pomo.pause}>
            <IconPause size={14} /> Pause
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => pomo.start(task.id)}>
            <IconPlay size={14} /> {mine ? 'Resume' : 'Start'}
          </button>
        )}
        <button type="button" className="btn" onClick={pomo.reset} disabled={!mine}>
          <IconReset size={14} /> Reset
        </button>
      </div>
      <p className={styles.timerFoot}>Elapsed time is added to “time spent” when you pause, reset or finish.</p>
    </section>
  );
}

export function TaskDetailView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const state = useAppState();
  const today = useToday();
  const toast = useToast();
  const pomo = usePomodoro();
  const guardDone = useCompletionGuard();

  if (!state || !today) return <PageSkeleton title="Task" rows={4} />;
  const task = state.tasks.find((t) => t.id === id);

  if (!task) {
    return (
      <div className="card empty" style={{ marginTop: 40 }}>
        <strong>Task not found</strong>
        <span>It may have been deleted, or the link is wrong.</span>
        <Link href="/tasks" className="btn" style={{ marginTop: 10 }}>
          Back to tasks
        </Link>
      </div>
    );
  }

  const project = task.projectId ? state.projects.find((p) => p.id === task.projectId) : null;
  const assignee = task.assigneeId ? state.members.find((m) => m.id === task.assigneeId) : null;
  const nextDue = nextDueDate(task, today);
  const done = task.category === 'done';
  const byProject = projectMap(state.projects);
  const status = findStatus(effectiveWorkflow(byProject, task.projectId), task.statusId);
  const projectLabel = project ? projectPath(byProject, project.id) : null;
  const initial = draftFromTask(task);
  const formKey = JSON.stringify(initial);
  const other = pomo.active && pomo.taskId !== task.id ? state.tasks.find((t) => t.id === pomo.taskId)?.title ?? null : null;
  const pct = task.estimateMinutes ? Math.min(100, Math.round((task.timeSpentMinutes / task.estimateMinutes) * 100)) : null;

  const remove = () => {
    if (pomo.taskId === task.id) pomo.reset();
    dispatch({ type: 'task/delete', ids: [task.id] });
    toast(`Deleted “${task.title}”`, { undo: true });
    router.push('/tasks');
  };

  return (
    <div>
      <Link href="/tasks" className={styles.back}>
        <IconChevronLeft size={16} /> All tasks
      </Link>
      <div className={`page-header ${styles.header}`}>
        <div className={styles.titleBlock}>
          <h1 className={`page-title ${styles.title}`}>{task.title}</h1>
          <div className={styles.badges}>
            <span className={`badge ${done ? styles.badgeDone : ''}`} title={`Category: ${STATUS_LABEL[task.category]}`} data-testid="task-detail-status">
              <span className="dot" style={{ background: status?.color ?? 'var(--border-strong)' }} aria-hidden="true" />
              {status?.name ?? task.statusId}
            </span>
            <PriorityBadge priority={task.priority} />
            <span title={projectLabel ?? undefined}>
              <ProjectChip project={project && projectLabel ? { ...project, name: projectLabel } : project} />
            </span>
            <span data-testid="task-detail-assignee">
              <AssigneeChip member={assignee} withName showUnassigned size={24} />
            </span>
            {task.recurrence !== 'none' && (
              <span className="badge" title={`Completing this task creates the next one${nextDue ? `, due ${formatShort(nextDue)}` : ''}`}>
                <IconRepeat size={12} /> {RECURRENCE_LABEL[task.recurrence]}
              </span>
            )}
            {!done && task.blockedBy.length > 0 && <BlockedBadge blockers={openBlockers(task, taskMap(state.tasks))} />}
            {isOverdue(task, today) && <span className="badge prio-urgent">Overdue</span>}
          </div>
        </div>
        <div className="row">
          <button
            type="button"
            className={`btn ${done ? '' : 'btn-primary'}`}
            onClick={() => {
              if (!done && !guardDone([task.id]).length) return;
              const at = nowIso();
              dispatch({ type: 'task/setCategory', ids: [task.id], category: done ? 'todo' : 'done', at });
              toast(done ? 'Task reopened' : completionMessage(task, at), { undo: true, tone: 'success' });
            }}
          >
            <IconCheck size={15} /> {done ? 'Reopen' : 'Mark done'}
          </button>
          <button type="button" className="btn btn-danger" onClick={remove}>
            <IconTrash size={15} /> Delete
          </button>
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.mainCol}>
          <section className={`card ${styles.panel}`} aria-labelledby="edit-title">
            <div className={styles.panelHead}>
              <h2 id="edit-title" className="section-title">
                Details
              </h2>
            </div>
            <TaskForm
              key={formKey}
              initial={initial}
              projects={state.projects}
              members={state.members}
              variant="page"
              submitLabel="Save changes"
              onSubmit={(fields) => {
                if (categoryOf(state.projects, fields) === 'done' && !done && !guardDone([task.id]).length) return;
                dispatch({ type: 'task/update', id: task.id, patch: fields, at: nowIso() });
                toast('Changes saved', { tone: 'success', undo: true });
              }}
            />
          </section>
          <Subtasks task={task} />
          <DependenciesPanel task={task} tasks={state.tasks} projects={state.projects} />
          <CommentsPanel task={task} members={state.members} currentUserId={state.settings.currentUserId} />
        </div>
        <aside className={styles.sideCol} aria-label="Task info">
          <PomodoroPanel task={task} settings={state.settings} otherTitle={other} />
          <section className={`card ${styles.panel}`} aria-labelledby="info-title">
            <h2 id="info-title" className="section-title" style={{ marginBottom: 12 }}>
              Activity
            </h2>
            <dl className={styles.info}>
              <div>
                <dt>Due</dt>
                <dd>
                  {task.dueDate ? (
                    <>
                      {formatLong(task.dueDate)}
                      {relativeDue(task.dueDate, today) !== formatShort(task.dueDate) && (
                        <>
                          {' · '}
                          <DueLabel due={task.dueDate} today={today} done={done} />
                        </>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt>Assignee</dt>
                <dd>{assignee ? assignee.name : 'Unassigned'}</dd>
              </div>
              <div>
                <dt>Repeats</dt>
                <dd>{task.recurrence === 'none' ? 'No' : RECURRENCE_LABEL[task.recurrence]}</dd>
              </div>
              <div>
                <dt>Time spent</dt>
                <dd>
                  {formatMinutes(task.timeSpentMinutes)}
                  {task.estimateMinutes ? <span className="muted"> of {formatMinutes(task.estimateMinutes)}</span> : null}
                </dd>
              </div>
              {pct !== null && (
                <div className={styles.full}>
                  <div className="progress" aria-hidden="true">
                    <span style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--warning)' : undefined }} />
                  </div>
                </div>
              )}
              <div>
                <dt>Created</dt>
                <dd>{formatLong(isoToDateKey(task.createdAt))}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{task.completedAt ? formatLong(isoToDateKey(task.completedAt)) : '—'}</dd>
              </div>
            </dl>
          </section>
          <ActivityTimeline task={task} state={state} />
        </aside>
      </div>
    </div>
  );
}
