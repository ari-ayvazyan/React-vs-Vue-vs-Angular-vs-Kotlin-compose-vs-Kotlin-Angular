'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { formatLong, isoToDateKey } from '@/lib/dates';
import { projectProgress, type ProjectProgress } from '@/lib/stats';
import type { Project, Task } from '@/lib/types';
import { descendantIds, projectTree, treeLabel, type TreeRow } from '@/lib/workflow';
import { ColorPalettePicker, ColorSwatch } from '../ColorSwatch';
import { Modal } from '../Modal';
import { PageSkeleton } from '../bits';
import { IconCheck, IconFolder, IconPencil, IconPlus, IconTrash, IconX } from '../icons';
import { dispatch, nowIso, useAppState } from '../store-hooks';
import { useToast } from '../toast';
import { newId } from '../ui';
import { WorkflowEditor } from './WorkflowEditor';
import styles from './projects.module.css';

const PALETTE = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b'];
const MAX_NAME = 60;

function validateName(name: string, projects: Project[], exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Name is required.';
  if (n.length > MAX_NAME) return `Name must be at most ${MAX_NAME} characters.`;
  if (projects.some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase())) return 'A project with this name already exists.';
  return null;
}

/** Parent options for `project`: every project except itself and its descendants (which would create a cycle). */
function ParentSelect({ project, tree, projects }: { project: Project; tree: TreeRow[]; projects: Project[] }) {
  const toast = useToast();
  const blocked = useMemo(() => descendantIds(projects, project.id), [projects, project.id]);
  return (
    <div className={styles.parent}>
      <label htmlFor={`parent-${project.id}`} className={styles.parentLabel}>
        Parent
      </label>
      <select
        id={`parent-${project.id}`}
        className={`select ${styles.parentSelect}`}
        value={project.parentId ?? ''}
        onChange={(e) => {
          const parentId = e.target.value || null;
          dispatch({ type: 'project/update', id: project.id, patch: { parentId }, at: nowIso() });
          const parent = projects.find((p) => p.id === parentId);
          toast(parent ? `Moved “${project.name}” under “${parent.name}”` : `“${project.name}” is now a top-level project`, { undo: true, tone: 'success' });
        }}
        data-testid="project-parent-select"
      >
        <option value="">— None (top level) —</option>
        {tree
          .filter((row) => !blocked.has(row.project.id))
          .map((row) => (
            <option key={row.project.id} value={row.project.id}>
              {treeLabel(row)}
            </option>
          ))}
      </select>
    </div>
  );
}

function ProjectCard({
  row,
  depth,
  childCount,
  state,
  tree,
  onDelete,
}: {
  row: ProjectProgress;
  depth: number;
  childCount: number;
  state: { projects: Project[]; tasks: Task[] };
  tree: TreeRow[];
  onDelete: (p: Project) => void;
}) {
  const { project, total, done, pct } = row;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [error, setError] = useState<string | null>(null);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const toast = useToast();

  const save = (e: FormEvent) => {
    e.preventDefault();
    const err = validateName(name, state.projects, project.id);
    setError(err);
    if (err) return;
    dispatch({ type: 'project/update', id: project.id, patch: { name: name.trim() }, at: nowIso() });
    toast('Project renamed', { undo: true, tone: 'success' });
    setEditing(false);
  };

  return (
    <li
      className={`card ${styles.card} ${depth ? styles.child : ''}`}
      style={{ ['--project' as string]: project.color, ['--depth' as string]: depth }}
      data-testid="project-card"
      data-project-id={project.id}
      data-depth={depth}
    >
      <div className={styles.cardHead}>
        <ColorSwatch
          color={project.color}
          label={`Colour for ${project.name}`}
          onCommit={(c) => dispatch({ type: 'project/update', id: project.id, patch: { color: c }, at: nowIso() })}
        />
        {editing ? (
          <form onSubmit={save} className={styles.renameForm} noValidate>
            <label htmlFor={`rename-${project.id}`} className="sr-only">
              Project name
            </label>
            <input
              id={`rename-${project.id}`}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? `rename-err-${project.id}` : undefined}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(false);
                  setName(project.name);
                  setError(null);
                }
              }}
            />
            <button type="submit" className="icon-btn" aria-label="Save name">
              <IconCheck />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Cancel rename"
              onClick={() => {
                setEditing(false);
                setName(project.name);
                setError(null);
              }}
            >
              <IconX />
            </button>
          </form>
        ) : (
          <>
            <h2 className={styles.name}>
              <Link href={`/tasks?project=${project.id}`}>{project.name}</Link>
              {childCount > 0 && (
                <span className={styles.subCount}>
                  {childCount} sub-project{childCount === 1 ? '' : 's'}
                </span>
              )}
            </h2>
            <div className={styles.actions}>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => {
                  setName(project.name);
                  setEditing(true);
                }}
                aria-label={`Rename ${project.name}`}
              >
                <IconPencil size={15} />
              </button>
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => onDelete(project)} aria-label={`Delete ${project.name}`}>
                <IconTrash size={15} />
              </button>
            </div>
          </>
        )}
      </div>
      {error && (
        <p className="error-text" id={`rename-err-${project.id}`}>
          {error}
        </p>
      )}
      <div className={styles.body}>
        <div className={styles.stats} title={childCount ? 'Including sub-projects' : undefined}>
          <div>
            <strong>{total}</strong>
            <span>tasks</span>
          </div>
          <div>
            <strong>{total - done}</strong>
            <span>open</span>
          </div>
          <div>
            <strong>{pct}%</strong>
            <span>done</span>
          </div>
        </div>
        <div className={styles.side}>
          <ParentSelect project={project} tree={tree} projects={state.projects} />
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${project.name} progress`}>
            <span style={{ width: `${pct}%`, background: project.color }} />
          </div>
          <p className={styles.created}>
            Created {formatLong(isoToDateKey(project.createdAt))}
            {childCount > 0 && ' · counts include sub-projects'}
          </p>
        </div>
      </div>
      <div className={styles.workflowSection}>
        <button
          type="button"
          className={styles.workflowToggle}
          aria-expanded={showWorkflow}
          onClick={() => setShowWorkflow((v) => !v)}
          data-testid="workflow-toggle"
        >
          Workflow{project.workflow ? ' · custom' : ''}
          <span aria-hidden="true">{showWorkflow ? '▴' : '▾'}</span>
        </button>
        {showWorkflow && <WorkflowEditor project={project} projects={state.projects} tasks={state.tasks} />}
      </div>
    </li>
  );
}

export function ProjectsView() {
  const state = useAppState();
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [deleteMode, setDeleteMode] = useState<'unassign' | 'delete'>('unassign');
  const [childMode, setChildMode] = useState<'lift' | 'delete'>('lift');

  const tasks = state?.tasks;
  const projects = state?.projects;
  const progress = useMemo(() => new Map((tasks && projects ? projectProgress(tasks, projects) : []).map((r) => [r.project.id, r])), [tasks, projects]);
  const tree = useMemo(() => projectTree(projects ?? []), [projects]);
  const unassigned = useMemo(() => (tasks ?? []).filter((t) => !t.projectId).length, [tasks]);

  if (!state) return <PageSkeleton title="Projects" />;

  const create = (e: FormEvent) => {
    e.preventDefault();
    const err = validateName(name, projects!);
    setError(err);
    if (err) return;
    const project: Project = { id: newId('p'), name: name.trim(), color, createdAt: new Date().toISOString(), parentId: parentId || null, workflow: null };
    dispatch({ type: 'project/create', project });
    const parent = projects!.find((p) => p.id === parentId);
    toast(parent ? `Created “${project.name}” under “${parent.name}”` : `Created project “${project.name}”`, { undo: true, tone: 'success' });
    setName('');
    setColor(PALETTE[(projects!.length + 1) % PALETTE.length]);
  };

  // Delete dialog numbers: the project's sub-projects, and the tasks affected by the chosen option.
  const deletingDesc = deleting ? descendantIds(projects!, deleting.id) : new Set<string>();
  const subCount = deletingDesc.size - (deleting ? 1 : 0);
  const removedProjects = childMode === 'delete' ? deletingDesc : new Set(deleting ? [deleting.id] : []);
  const deletingCount = deleting ? tasks!.filter((t) => t.projectId !== null && removedProjects.has(t.projectId)).length : 0;
  const parentName = deleting?.parentId ? projects!.find((p) => p.id === deleting.parentId)?.name : null;
  const childCount = (id: string) => projects!.filter((p) => p.parentId === id).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">
            {projects!.length} project{projects!.length === 1 ? '' : 's'} · {unassigned} task{unassigned === 1 ? '' : 's'} without a project
          </p>
        </div>
      </div>

      <form onSubmit={create} className={`card ${styles.createForm}`} noValidate aria-label="Create project">
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="new-project-name" className="label">
            New project
          </label>
          <input
            id="new-project-name"
            className="input"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'new-project-error' : undefined}
          />
          {error && (
            <p className="error-text" id="new-project-error">
              {error}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="new-project-parent" className="label">
            Parent
          </label>
          <select id="new-project-parent" className="select" value={parentId} onChange={(e) => setParentId(e.target.value)} data-testid="new-project-parent">
            <option value="">— None (top level) —</option>
            {tree.map((row) => (
              <option key={row.project.id} value={row.project.id}>
                {treeLabel(row)}
              </option>
            ))}
          </select>
        </div>
        <ColorPalettePicker value={color} onChange={setColor} palette={PALETTE} />
        <button type="submit" className={`btn btn-primary ${styles.createBtn}`}>
          <IconPlus size={16} /> Add project
        </button>
      </form>

      {tree.length ? (
        <ul className={styles.tree} aria-label="Project tree">
          {tree.map(({ project, depth }) => (
            <ProjectCard
              key={project.id}
              row={progress.get(project.id)!}
              depth={depth}
              childCount={childCount(project.id)}
              state={state}
              tree={tree}
              onDelete={(p) => {
                setDeleteMode('unassign');
                setChildMode('lift');
                setDeleting(p);
              }}
            />
          ))}
        </ul>
      ) : (
        <div className="card empty">
          <IconFolder size={28} />
          <strong>No projects yet</strong>
          <span>Create one above to group related tasks.</span>
        </div>
      )}

      {deleting && (
        <Modal
          title={`Delete “${deleting.name}”?`}
          description={
            [
              subCount ? `It has ${subCount} sub-project${subCount === 1 ? '' : 's'}.` : '',
              deletingCount ? `${deletingCount} task${deletingCount === 1 ? '' : 's'} would lose ${deletingCount === 1 ? 'its' : 'their'} project.` : 'No tasks are affected.',
            ]
              .filter(Boolean)
              .join(' ')
          }
          onClose={() => setDeleting(null)}
          size="sm"
          testId="project-delete-dialog"
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger-solid"
                data-testid="project-delete-confirm"
                onClick={() => {
                  dispatch({ type: 'project/delete', id: deleting.id, mode: deleteMode, children: childMode, at: nowIso() });
                  const parts = [`Deleted “${deleting.name}”`];
                  if (subCount) parts.push(childMode === 'delete' ? `and ${subCount} sub-project${subCount === 1 ? '' : 's'}` : `(sub-projects moved up)`);
                  if (deleteMode === 'delete' && deletingCount) parts.push(`with ${deletingCount} task${deletingCount === 1 ? '' : 's'}`);
                  toast(parts.join(' '), { undo: true });
                  setDeleting(null);
                }}
              >
                Delete project
              </button>
            </>
          }
        >
          {subCount > 0 && (
            <fieldset className={styles.choices} data-testid="project-delete-children">
              <legend className={styles.choiceLegend}>Sub-projects</legend>
              <label className={styles.choice}>
                <input type="radio" name="child-mode" checked={childMode === 'lift'} onChange={() => setChildMode('lift')} />
                <span>
                  <strong>Move them up one level</strong>
                  <span className="muted">They become {parentName ? `sub-projects of “${parentName}”` : 'top-level projects'}, with their tasks.</span>
                </span>
              </label>
              <label className={styles.choice}>
                <input type="radio" name="child-mode" checked={childMode === 'delete'} onChange={() => setChildMode('delete')} />
                <span>
                  <strong>Delete them too</strong>
                  <span className="muted">
                    Removes {subCount} sub-project{subCount === 1 ? '' : 's'}; their tasks follow the choice below.
                  </span>
                </span>
              </label>
            </fieldset>
          )}
          {deletingCount > 0 && (
            <fieldset className={styles.choices} style={{ marginTop: subCount ? 14 : 0 }}>
              <legend className={styles.choiceLegend}>Tasks</legend>
              <label className={styles.choice}>
                <input type="radio" name="delete-mode" checked={deleteMode === 'unassign'} onChange={() => setDeleteMode('unassign')} />
                <span>
                  <strong>Move tasks to “No project”</strong>
                  <span className="muted">Keep the tasks, just remove the project. Their statuses map to the default workflow.</span>
                </span>
              </label>
              <label className={styles.choice}>
                <input type="radio" name="delete-mode" checked={deleteMode === 'delete'} onChange={() => setDeleteMode('delete')} />
                <span>
                  <strong>Delete the tasks too</strong>
                  <span className="muted">
                    Permanently remove {deletingCount} task{deletingCount === 1 ? '' : 's'} (undo is available).
                  </span>
                </span>
              </label>
            </fieldset>
          )}
        </Modal>
      )}
    </div>
  );
}
