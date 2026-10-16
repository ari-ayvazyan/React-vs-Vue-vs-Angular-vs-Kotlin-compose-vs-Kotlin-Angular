'use client';

import { useId, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { PRIORITIES, PRIORITY_LABEL, RECURRENCES, RECURRENCE_LABEL, type Member, type Project } from '@/lib/types';
import { effectiveWorkflow, findStatus, projectMap, projectTree, statusForCategory, treeLabel } from '@/lib/workflow';
import { LIMITS, draftToFields, parseTags, validateDraft, type DraftErrors, type TaskDraft } from '@/lib/validation';
import styles from './task-form.module.css';

interface TaskFormProps {
  initial: TaskDraft;
  projects: Project[];
  members: Member[];
  onSubmit: (fields: ReturnType<typeof draftToFields>) => void;
  onCancel?: () => void;
  submitLabel: string;
  titleRef?: RefObject<HTMLInputElement | null>;
  /** extra buttons rendered left of the action row */
  extraActions?: ReactNode;
  variant?: 'modal' | 'page';
}

export function TaskForm({ initial, projects, members, onSubmit, onCancel, submitLabel, titleRef, extraActions, variant = 'modal' }: TaskFormProps) {
  // A preset project (e.g. "add task" on a filtered board) may use a workflow without the default status ids.
  const [start] = useState(() => {
    const wf = effectiveWorkflow(projectMap(projects), initial.projectId || null);
    return findStatus(wf, initial.status) ? initial : { ...initial, status: statusForCategory(wf, 'todo') };
  });
  const [draft, setDraft] = useState(start);
  const [submitted, setSubmitted] = useState(false);
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const errors: DraftErrors = submitted ? validateDraft(draft) : {};
  const tags = parseTags(draft.tags);
  const dirty = JSON.stringify(draft) !== JSON.stringify(start);

  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const byId = projectMap(projects);
  const workflow = effectiveWorkflow(byId, draft.projectId || null);
  const tree = projectTree(projects);
  /** Changing the project can change the workflow: keep the status's category. */
  const setProject = (projectId: string) =>
    setDraft((d) => {
      const fromWf = effectiveWorkflow(byId, d.projectId || null);
      const toWf = effectiveWorkflow(byId, projectId || null);
      const category = findStatus(fromWf, d.status)?.category ?? 'todo';
      return { ...d, projectId, status: findStatus(toWf, d.status) ? d.status : statusForCategory(toWf, category) };
    });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const errs = validateDraft(draft);
    const firstError = Object.keys(errs)[0];
    if (firstError) {
      (document.getElementById(id(firstError)) as HTMLElement | null)?.focus();
      return;
    }
    onSubmit(draftToFields(draft));
    if (variant === 'page') setSubmitted(false);
  };

  const describedBy = (name: keyof TaskDraft, hint?: boolean) =>
    [errors[name] ? id(`${name}-error`) : null, hint ? id(`${name}-hint`) : null].filter(Boolean).join(' ') || undefined;

  const err = (name: keyof TaskDraft) =>
    errors[name] ? (
      <p className="error-text" id={id(`${name}-error`)}>
        {errors[name]}
      </p>
    ) : null;

  return (
    <form onSubmit={handleSubmit} noValidate className={`${styles.form} ${variant === 'page' ? styles.page : ''}`}>
      <div className="field">
        <label className="label" htmlFor={id('title')}>
          Title <span aria-hidden="true">*</span>
        </label>
        <input
          ref={titleRef}
          id={id('title')}
          className="input"
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="What needs to be done?"
          aria-invalid={!!errors.title}
          aria-describedby={describedBy('title')}
          aria-required="true"
          autoComplete="off"
          data-testid="task-title-input"
        />
        {err('title')}
      </div>

      <div className="field">
        <div className={styles.labelRow}>
          <label className="label" htmlFor={id('description')}>
            Description
          </label>
          <span className={`hint ${draft.description.length > LIMITS.description ? 'overdue-text' : ''}`} id={id('description-hint')}>
            {draft.description.length}/{LIMITS.description}
          </span>
        </div>
        <textarea
          id={id('description')}
          className="textarea"
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Add more detail…"
          rows={variant === 'page' ? 5 : 3}
          aria-invalid={!!errors.description}
          aria-describedby={describedBy('description', true)}
        />
        {err('description')}
      </div>

      <div className={styles.grid}>
        <div className="field">
          <label className="label" htmlFor={id('status')}>
            Status
          </label>
          <select id={id('status')} className="select" value={draft.status} onChange={(e) => set('status', e.target.value)} data-testid="task-status-select">
            {workflow.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor={id('priority')}>
            Priority
          </label>
          <select
            id={id('priority')}
            className="select"
            value={draft.priority}
            onChange={(e) => set('priority', e.target.value as TaskDraft['priority'])}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor={id('projectId')}>
            Project
          </label>
          <select id={id('projectId')} className="select" value={draft.projectId} onChange={(e) => setProject(e.target.value)}>
            <option value="">No project</option>
            {tree.map((row) => (
              <option key={row.project.id} value={row.project.id}>
                {treeLabel(row)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor={id('assigneeId')}>
            Assignee
          </label>
          <select
            id={id('assigneeId')}
            className="select"
            value={draft.assigneeId}
            onChange={(e) => set('assigneeId', e.target.value)}
            data-testid="task-assignee-select"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor={id('recurrence')}>
            Repeat
          </label>
          <select
            id={id('recurrence')}
            className="select"
            value={draft.recurrence}
            onChange={(e) => set('recurrence', e.target.value as TaskDraft['recurrence'])}
            aria-describedby={draft.recurrence !== 'none' ? id('recurrence-hint') : undefined}
            data-testid="task-recurrence-select"
          >
            {RECURRENCES.map((r) => (
              <option key={r} value={r}>
                {RECURRENCE_LABEL[r]}
              </option>
            ))}
          </select>
          {draft.recurrence !== 'none' && (
            <p className="hint" id={id('recurrence-hint')}>
              Completing it creates the next one.
            </p>
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor={id('dueDate')}>
            Due date
          </label>
          <input
            id={id('dueDate')}
            type="date"
            className="input"
            value={draft.dueDate}
            onChange={(e) => set('dueDate', e.target.value)}
            aria-invalid={!!errors.dueDate}
            aria-describedby={describedBy('dueDate')}
          />
          {err('dueDate')}
        </div>
        <div className="field">
          <label className="label" htmlFor={id('estimate')}>
            Estimate (minutes)
          </label>
          <input
            id={id('estimate')}
            className="input"
            inputMode="numeric"
            value={draft.estimate}
            onChange={(e) => set('estimate', e.target.value)}
            placeholder="e.g. 60"
            aria-invalid={!!errors.estimate}
            aria-describedby={describedBy('estimate')}
          />
          {err('estimate')}
        </div>
        <div className="field">
          <label className="label" htmlFor={id('tags')}>
            Tags
          </label>
          <input
            id={id('tags')}
            className="input"
            value={draft.tags}
            onChange={(e) => set('tags', e.target.value)}
            placeholder="bug, frontend"
            aria-invalid={!!errors.tags}
            aria-describedby={describedBy('tags', true)}
            autoComplete="off"
          />
          <p className="hint" id={id('tags-hint')}>
            Comma separated · {tags.length}/{LIMITS.tags}
          </p>
          {err('tags')}
        </div>
      </div>

      {tags.length > 0 && (
        <div className={styles.tagPreview} aria-hidden="true">
          {tags.map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
        </div>
      )}

      <div className={`${styles.actions} ${variant === 'modal' ? styles.modalActions : ''}`}>
        <div className={styles.extra}>{extraActions}</div>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" data-testid="task-save-button" disabled={variant === 'page' && !dirty}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
