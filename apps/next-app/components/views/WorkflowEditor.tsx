'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { STATUSES, STATUS_LABEL, type Project, type StatusCategory, type Task, type WorkflowStatus } from '@/lib/types';
import { STATUS_NAME_MAX, effectiveWorkflow, projectMap, validateWorkflow, workflowOwner, workflowResolver } from '@/lib/workflow';
import { ColorSwatch } from '../ColorSwatch';
import { Modal } from '../Modal';
import { IconChevronLeft, IconChevronRight, IconPlus, IconTrash } from '../icons';
import { dispatch, nowIso } from '../store-hooks';
import { useToast } from '../toast';
import { newId } from '../ui';
import styles from './workflow.module.css';

const NEW_STATUS_COLORS: Record<StatusCategory, string> = { todo: '#94a3b8', in_progress: '#3b82f6', done: '#22c55e' };

/** Inline name editor: commits on blur / Enter, reverts on Escape. */
function StatusName({ status, onCommit }: { status: WorkflowStatus; onCommit: (name: string) => string | null }) {
  const [text, setText] = useState(status.name);
  const [synced, setSynced] = useState(status.name);
  const [error, setError] = useState<string | null>(null);
  if (status.name !== synced) {
    setSynced(status.name);
    setText(status.name);
  }
  const commit = () => {
    if (text.trim() === status.name) return setError(null);
    const err = onCommit(text);
    setError(err);
    if (err) setText(status.name);
  };
  return (
    <span className={styles.nameWrap}>
      <label className="sr-only" htmlFor={`status-name-${status.id}`}>
        Status name
      </label>
      <input
        id={`status-name-${status.id}`}
        className={`input ${styles.nameInput}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setText(status.name);
            setError(null);
          }
        }}
        aria-invalid={!!error}
        title={error ?? undefined}
        data-testid="workflow-status-name"
      />
      {error && <span className={`error-text ${styles.inlineError}`}>{error}</span>}
    </span>
  );
}

/**
 * Projects page: a project's workflow. Inherited workflows are shown read-only with a
 * "Customize" action; customised ones can be edited (add, rename, recolor, recategorise,
 * reorder, delete with a target status for its tasks) or reset to the inherited one.
 */
export function WorkflowEditor({ project, projects, tasks }: { project: Project; projects: Project[]; tasks: Task[] }) {
  const toast = useToast();
  const byId = useMemo(() => projectMap(projects), [projects]);
  const workflow = effectiveWorkflow(byId, project.id);
  const owner = workflowOwner(byId, project.id);
  const custom = project.workflow !== null;
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<StatusCategory>('in_progress');
  const [deleting, setDeleting] = useState<WorkflowStatus | null>(null);
  const [target, setTarget] = useState('');

  /** Tasks whose effective workflow is this one (this project + inheriting sub-projects), per status id. */
  const counts = useMemo(() => {
    const resolve = workflowResolver(projects);
    const m = new Map<string, number>();
    for (const t of tasks) if (t.projectId && resolve(t.projectId) === workflow) m.set(t.statusId, (m.get(t.statusId) ?? 0) + 1);
    return m;
  }, [projects, tasks, workflow]);

  /** Validates and saves a new status list; returns the problem (also shown) or null. */
  const save = (next: WorkflowStatus[], message?: string): string | null => {
    const err = validateWorkflow(next);
    setError(err);
    if (err) return err;
    dispatch({ type: 'project/update', id: project.id, patch: { workflow: next }, at: nowIso() });
    if (message) toast(message, { undo: true, tone: 'success' });
    return null;
  };
  const patch = (id: string, p: Partial<WorkflowStatus>) => save(workflow.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const moveBy = (i: number, d: number) => {
    const next = [...workflow];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    save(next);
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    const err = save([...workflow, { id: newId('s'), name, color: NEW_STATUS_COLORS[newCategory], category: newCategory }], `Added status “${name}”`);
    if (!err) setNewName('');
  };

  const inheritedFrom = owner ? `“${owner.name}”` : 'the default workflow';
  const parentFrom = (() => {
    const parentOwner = project.parentId ? workflowOwner(byId, project.parentId) : null;
    return parentOwner ? `“${parentOwner.name}”` : 'the default workflow';
  })();

  return (
    <div className={styles.editor} data-testid="workflow-editor">
      {!custom ? (
        <>
          <ul className={styles.chips} aria-label="Statuses">
            {workflow.map((s) => (
              <li key={s.id} className={styles.chip}>
                <span className="dot" style={{ background: s.color }} aria-hidden="true" />
                {s.name}
              </li>
            ))}
          </ul>
          <div className={styles.footer}>
            <span className="muted">Inherited from {inheritedFrom}.</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => save(workflow.map((s) => ({ ...s })), `“${project.name}” now has its own workflow`)}
              data-testid="workflow-customize"
            >
              Customize
            </button>
          </div>
        </>
      ) : (
        <>
          <ol className={styles.list}>
            {workflow.map((s, i) => (
              <li key={s.id} className={styles.row} data-testid="workflow-status-row">
                <ColorSwatch color={s.color} label={`Colour of ${s.name}`} onCommit={(color) => patch(s.id, { color })} />
                <StatusName status={s} onCommit={(name) => patch(s.id, { name: name.trim() })} />
                <label className="sr-only" htmlFor={`status-cat-${s.id}`}>
                  Category of {s.name}
                </label>
                <select
                  id={`status-cat-${s.id}`}
                  className={`select ${styles.category}`}
                  value={s.category}
                  onChange={(e) => patch(s.id, { category: e.target.value as StatusCategory })}
                >
                  {STATUSES.map((c) => (
                    <option key={c} value={c}>
                      {STATUS_LABEL[c]}
                    </option>
                  ))}
                </select>
                <span className={styles.count} title="Tasks in this status">
                  {counts.get(s.id) ?? 0}
                </span>
                <span className={styles.rowActions}>
                  <button type="button" className="icon-btn icon-btn-sm" onClick={() => moveBy(i, -1)} disabled={i === 0} aria-label={`Move ${s.name} earlier`}>
                    <IconChevronLeft size={14} style={{ transform: 'rotate(90deg)' }} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    onClick={() => moveBy(i, 1)}
                    disabled={i === workflow.length - 1}
                    aria-label={`Move ${s.name} later`}
                  >
                    <IconChevronRight size={14} style={{ transform: 'rotate(90deg)' }} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    aria-label={`Delete status ${s.name}`}
                    data-testid="workflow-delete-status"
                    onClick={() => {
                      const rest = workflow.filter((x) => x.id !== s.id);
                      const err = validateWorkflow(rest);
                      if (err) return setError(`Can’t delete “${s.name}”: ${err.charAt(0).toLowerCase()}${err.slice(1)}`);
                      setError(null);
                      setTarget((rest.find((x) => x.category === s.category) ?? rest[0]).id);
                      setDeleting(s);
                    }}
                  >
                    <IconTrash size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <form onSubmit={add} className={styles.add} noValidate aria-label="Add status">
            <label className="sr-only" htmlFor={`new-status-${project.id}`}>
              New status name
            </label>
            <input
              id={`new-status-${project.id}`}
              className="input"
              placeholder="New status, e.g. Review"
              value={newName}
              maxLength={STATUS_NAME_MAX + 10}
              onChange={(e) => setNewName(e.target.value)}
              data-testid="workflow-add-name"
            />
            <label className="sr-only" htmlFor={`new-status-cat-${project.id}`}>
              Category
            </label>
            <select id={`new-status-cat-${project.id}`} className={`select ${styles.category}`} value={newCategory} onChange={(e) => setNewCategory(e.target.value as StatusCategory)}>
              {STATUSES.map((c) => (
                <option key={c} value={c}>
                  {STATUS_LABEL[c]}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-sm" data-testid="workflow-add-button">
              <IconPlus size={14} /> Add
            </button>
          </form>
          <div className={styles.footer}>
            <span className="muted">Custom workflow. Sub-projects without their own workflow use it too.</span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setError(null);
                dispatch({ type: 'project/update', id: project.id, patch: { workflow: null }, at: nowIso() });
                toast(`“${project.name}” uses ${parentFrom} again; tasks kept their categories`, { undo: true });
              }}
              data-testid="workflow-reset"
            >
              Use {parentFrom}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="error-text" role="alert" data-testid="workflow-error">
          {error}
        </p>
      )}

      {deleting && (
        <Modal
          title={`Delete status “${deleting.name}”?`}
          description={
            counts.get(deleting.id)
              ? `${counts.get(deleting.id)} task${counts.get(deleting.id) === 1 ? '' : 's'} use this status. Choose where to move them.`
              : 'No tasks use this status.'
          }
          onClose={() => setDeleting(null)}
          size="sm"
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger-solid"
                data-testid="status-delete-confirm"
                onClick={() => {
                  dispatch({ type: 'workflow/deleteStatus', projectId: project.id, statusId: deleting.id, targetId: target, at: nowIso() });
                  toast(`Deleted status “${deleting.name}”`, { undo: true });
                  setDeleting(null);
                }}
              >
                Delete status
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="status-delete-target" className="label">
              Move its tasks to
            </label>
            <select id="status-delete-target" className="select" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="status-delete-target">
              {workflow
                .filter((x) => x.id !== deleting.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({STATUS_LABEL[x.category]})
                  </option>
                ))}
            </select>
          </div>
        </Modal>
      )}
    </div>
  );
}
