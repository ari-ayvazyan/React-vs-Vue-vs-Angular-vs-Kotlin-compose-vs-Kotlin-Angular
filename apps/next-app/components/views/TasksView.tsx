'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  DUE_FILTERS,
  DUE_LABEL,
  NO_PROJECT,
  SORT_KEYS,
  SORT_LABEL,
  filterTasks,
  isOverdue,
  paginate,
  parseQuery,
  queryToSearch,
  sortTasks,
  type TaskQuery,
} from '@/lib/filters';
import { NO_ASSIGNEE } from '@/lib/members';
import { completionMessage } from '@/lib/recurrence';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, type Member, type Project, type Task } from '@/lib/types';
import { openBlockers, taskMap } from '@/lib/dependencies';
import { findStatus, projectTree, treeLabel, workflowResolver } from '@/lib/workflow';
import { tasksToCsv } from '@/lib/csv';
import { boardSearch, describeQuery, matchingView, viewSearch } from '@/lib/views';
import { ViewNameDialog } from '../ViewDialog';
import { AssigneeChip, BlockedBadge, DueLabel, PageSkeleton, PriorityBadge, ProjectChip, RecurrenceIcon } from '../bits';
import { useCompletionGuard } from '../completion';
import { IconBoard, IconBookmark, IconDownload, IconCheck, IconChevronLeft, IconChevronRight, IconPencil, IconPlus, IconSearch, IconTrash, IconX } from '../icons';
import { dispatch, nowIso, useAppState, useToday } from '../store-hooks';
import { newId } from '../ui';
import { useToast } from '../toast';
import { useUI } from '../ui';
import styles from './tasks.module.css';

const NO_TASKS: Task[] = [];

function navigate(query: TaskQuery, replace = false) {
  const url = `/tasks${queryToSearch(query)}`;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

interface RowProps {
  task: Task;
  project: Project | undefined;
  assignee: Member | undefined;
  /** name of the task's workflow status */
  statusName: string;
  /** open blockers (empty unless the task is open and blocked) */
  blockers: Task[];
  today: string;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggleDone: (task: Task) => void;
  onEdit: (task: Task) => void;
}

const TaskRow = memo(function TaskRow({ task, project, assignee, statusName, blockers, today, selected, onSelect, onToggleDone, onEdit }: RowProps) {
  const done = task.category === 'done';
  const overdue = isOverdue(task, today);
  const subDone = task.subtasks.filter((s) => s.done).length;
  return (
    <li
      className={`${styles.row} ${overdue ? styles.overdue : ''} ${selected ? styles.selected : ''} ${done ? styles.done : ''}`}
      data-testid="task-row"
    >
      <span className={styles.cellSelect}>
        <input type="checkbox" className="checkbox" checked={selected} onChange={() => onSelect(task.id)} aria-label={`Select “${task.title}”`} />
      </span>
      <span className={styles.cellDone}>
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          className={styles.doneToggle}
          onClick={() => onToggleDone(task)}
          aria-label={done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
        >
          {done && <IconCheck size={13} />}
        </button>
      </span>
      <span className={styles.cellTitle}>
        <Link href={`/tasks/${task.id}`} className={styles.title}>
          {task.title}
        </Link>
        <span className={styles.meta}>
          {overdue && <span className={styles.overdueFlag}>Overdue</span>}
          <BlockedBadge blockers={blockers} />
          <RecurrenceIcon recurrence={task.recurrence} size={12} />
          {task.subtasks.length > 0 && (
            <span className={styles.subtasks} title="Subtasks done">
              <IconCheck size={12} /> {subDone}/{task.subtasks.length}
            </span>
          )}
          {task.tags.map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
        </span>
      </span>
      <span className={styles.cellProject}>
        <ProjectChip project={project} />
      </span>
      <span className={styles.cellAssignee}>
        <AssigneeChip member={assignee} />
      </span>
      <span className={styles.cellPriority}>
        <PriorityBadge priority={task.priority} />
      </span>
      <span className={styles.cellStatus}>
        <span className={`${styles.status} ${styles[`status_${task.category}`]}`} title={`${statusName} (${STATUS_LABEL[task.category]})`}>
          {statusName}
        </span>
      </span>
      <span className={styles.cellDue}>
        <DueLabel due={task.dueDate} today={today} done={done} />
      </span>
      <span className={styles.cellActions}>
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => onEdit(task)} aria-label={`Edit “${task.title}”`}>
          <IconPencil size={15} />
        </button>
      </span>
    </li>
  );
});

function SearchField({ query }: { query: TaskQuery }) {
  const [text, setText] = useState(query.q);
  const [syncedQ, setSyncedQ] = useState(query.q);
  // External URL change (back button, global search): adopt the new value.
  if (query.q !== syncedQ) {
    setSyncedQ(query.q);
    setText(query.q);
  }
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });

  useEffect(() => {
    if (text === queryRef.current.q) return;
    const id = window.setTimeout(() => navigate({ ...queryRef.current, q: text, page: 1 }, true), 200);
    return () => window.clearTimeout(id);
  }, [text]);

  return (
    <div className={styles.searchWrap}>
      <IconSearch size={16} className={styles.searchIcon} />
      <label htmlFor="task-list-search" className="sr-only">
        Search tasks
      </label>
      <input
        id="task-list-search"
        type="search"
        className={`input ${styles.search}`}
        placeholder="Search title, description, tags…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        data-testid="task-list-search"
        autoComplete="off"
      />
      {text && (
        <button type="button" className={`icon-btn icon-btn-sm ${styles.clearSearch}`} onClick={() => setText('')} aria-label="Clear search">
          <IconX size={14} />
        </button>
      )}
    </div>
  );
}

export function TasksView() {
  const state = useAppState();
  const today = useToday();
  const params = useSearchParams();
  const query = useMemo(() => parseQuery(params), [params]);
  const { openTaskModal } = useUI();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [moveTarget, setMoveTarget] = useState('');
  const [viewDialog, setViewDialog] = useState<'save' | 'rename' | null>(null);

  const tasks = state?.tasks;
  const projects = state?.projects;
  const pageSize = state?.settings.pageSize ?? 25;

  const members = state?.members;
  const projectMap = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);
  const memberMap = useMemo(() => new Map((members ?? []).map((m) => [m.id, m])), [members]);
  const byId = useMemo(() => taskMap(tasks ?? []), [tasks]);
  const workflowOf = useMemo(() => workflowResolver(projects ?? []), [projects]);
  const tree = useMemo(() => projectTree(projects ?? []), [projects]);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks ?? []) for (const tag of t.tags) set.add(tag);
    return [...set].sort();
  }, [tasks]);

  const filtered = useMemo(
    () => (tasks && today ? sortTasks(filterTasks(tasks, query, today, projects), query.sort, query.dir) : []),
    [tasks, query, today, projects],
  );
  const page = paginate(filtered, query.page, pageSize);

  const onSelect = useMemo(
    () => (id: string) =>
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );
  const guardDone = useCompletionGuard();
  const onToggleDone = useMemo(
    () => (task: Task) => {
      const done = task.category !== 'done';
      if (done && !guardDone([task.id]).length) return;
      const at = nowIso();
      // "Done" / "reopen" pick the first status of that category in the task's own workflow.
      dispatch({ type: 'task/setCategory', ids: [task.id], category: done ? 'done' : 'todo', at });
      toast(done ? completionMessage(task, at) : `Reopened “${task.title}”`, { undo: true, tone: 'success' });
    },
    [toast, guardDone],
  );
  const onEdit = useMemo(() => (task: Task) => openTaskModal({ task }), [openTaskModal]);

  if (!state || !today) return <PageSkeleton title="Tasks" />;

  const set = (patch: Partial<TaskQuery>, replace = false) => navigate({ ...query, page: 1, ...patch }, replace);
  const selectedIds = [...selected].filter((id) => tasks!.some((t) => t.id === id));
  const pageIds = page.items.map((t) => t.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const activeFilters =
    query.status.length + query.priority.length + (query.project ? 1 : 0) + (query.assignee ? 1 : 0) + (query.tag ? 1 : 0) + (query.due !== 'all' ? 1 : 0) + (query.q ? 1 : 0);
  const views = state.views;
  const activeView = matchingView(views, query);
  const summary = describeQuery(query, {
    project: (id) => (id === NO_PROJECT ? 'No project' : (projectMap.get(id)?.name ?? 'Unknown project')),
    member: (id) => (id === NO_ASSIGNEE ? 'Unassigned' : (memberMap.get(id)?.name ?? 'Unknown member')),
    status: (x) => STATUS_LABEL[x as Task['category']],
    priority: (x) => PRIORITY_LABEL[x as Task['priority']],
    due: (x) => DUE_LABEL[x as TaskQuery['due']],
    sort: (x) => SORT_LABEL[x as TaskQuery['sort']],
  });
  const first = page.total ? (page.page - 1) * pageSize + 1 : 0;
  const last = Math.min(page.page * pageSize, page.total);

  /** Exactly the filtered + sorted list the user sees (all pages, not just the current one). */
  const exportCsv = () => {
    const csv = tasksToCsv(filtered, projects!, state.members);
    // BOM so spreadsheet apps detect UTF-8 (curly quotes, accents in titles).
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `taskpilot-tasks-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${filtered.length} task${filtered.length === 1 ? '' : 's'} as CSV`, { tone: 'success' });
  };

  const bulkDone = () => {
    const allowed = guardDone(selectedIds);
    if (allowed.length) {
      dispatch({ type: 'task/setCategory', ids: allowed, category: 'done', at: nowIso() });
      toast(`Marked ${allowed.length} task${allowed.length === 1 ? '' : 's'} as done`, { undo: true, tone: 'success' });
    }
    // Keep refused (blocked) tasks selected so the user can see which ones were left.
    setSelected(new Set(selectedIds.filter((id) => !allowed.includes(id))));
  };
  const bulkDelete = () => {
    dispatch({ type: 'task/delete', ids: selectedIds });
    toast(`Deleted ${selectedIds.length} task${selectedIds.length === 1 ? '' : 's'}`, { undo: true });
    setSelected(new Set());
  };
  const bulkMove = (target: string) => {
    if (!target) return;
    const projectId = target === NO_PROJECT ? null : target;
    dispatch({ type: 'task/bulkUpdate', ids: selectedIds, patch: { projectId }, at: nowIso() });
    const name = projectId ? projectMap.get(projectId)?.name : 'No project';
    toast(`Moved ${selectedIds.length} task${selectedIds.length === 1 ? '' : 's'} to ${name}`, { undo: true, tone: 'success' });
    setSelected(new Set());
    setMoveTarget('');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle" aria-live="polite">
            {page.total === tasks!.length ? `${page.total} tasks` : `${page.total} of ${tasks!.length} tasks match`}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className="btn"
            onClick={exportCsv}
            disabled={!filtered.length}
            title={`Download the ${filtered.length} matching tasks, in the current sort order, as CSV`}
            data-testid="export-csv-button"
          >
            <IconDownload size={16} /> Export CSV
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setViewDialog('save')}
            disabled={!!activeView}
            title={activeView ? `These filters are saved as “${activeView.name}”` : 'Save the current filters, search and sort'}
            data-testid="save-view-button"
          >
            <IconBookmark size={16} /> Save view
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openTaskModal()}>
            <IconPlus size={16} /> New task
          </button>
        </div>
      </div>

      {activeView && (
        <div className={styles.viewBar} role="region" aria-label="Saved view" data-testid="active-view">
          <IconBookmark size={16} />
          <span className={styles.viewName}>
            <strong>{activeView.name}</strong>
            <span className="muted">{summary}</span>
          </span>
          <Link href={`/board${boardSearch(query)}`} className="btn btn-sm btn-ghost" data-testid="view-open-board">
            <IconBoard size={14} /> Open on board
          </Link>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setViewDialog('rename')} data-testid="view-rename">
            <IconPencil size={14} /> Rename
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            data-testid="view-delete"
            onClick={() => {
              dispatch({ type: 'view/delete', id: activeView.id });
              toast(`Deleted view “${activeView.name}”`, { undo: true });
            }}
          >
            <IconTrash size={14} /> Delete
          </button>
        </div>
      )}

      {viewDialog && (
        <ViewNameDialog
          views={views}
          view={viewDialog === 'rename' ? activeView : undefined}
          summary={viewDialog === 'save' ? summary : undefined}
          onClose={() => setViewDialog(null)}
          onSubmit={(name) => {
            if (viewDialog === 'rename' && activeView) {
              dispatch({ type: 'view/update', id: activeView.id, patch: { name } });
              toast(`Renamed view to “${name}”`, { undo: true, tone: 'success' });
            } else {
              dispatch({ type: 'view/create', view: { id: newId('v'), name, search: viewSearch(query), createdAt: nowIso() } });
              toast(`Saved view “${name}”`, { undo: true, tone: 'success' });
            }
            setViewDialog(null);
          }}
        />
      )}

      <section className={`card ${styles.toolbar}`} aria-label="Filters and sorting">
        <div className={styles.toolbarRow}>
          <SearchField query={query} />
          <div className={styles.sortGroup}>
            <label htmlFor="sort" className="sr-only">
              Sort by
            </label>
            <select id="sort" className={`select ${styles.compact}`} value={query.sort} onChange={(e) => set({ sort: e.target.value as TaskQuery['sort'] })}>
              {SORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  Sort: {SORT_LABEL[k]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              onClick={() => set({ dir: query.dir === 'asc' ? 'desc' : 'asc' })}
              aria-label={`Sort direction: ${query.dir === 'asc' ? 'ascending' : 'descending'}. Toggle`}
              title={query.dir === 'asc' ? 'Ascending' : 'Descending'}
            >
              {query.dir === 'asc' ? '↑ Asc' : '↓ Desc'}
            </button>
          </div>
        </div>

        <div className={styles.filters}>
          <fieldset className={styles.chips}>
            <legend className="sr-only">Status</legend>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={styles.chip}
                aria-pressed={query.status.includes(s)}
                onClick={() => set({ status: toggle(query.status, s) })}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </fieldset>
          <span className={styles.divider} aria-hidden="true" />
          <fieldset className={styles.chips}>
            <legend className="sr-only">Priority</legend>
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                className={`${styles.chip} ${styles[`chip_${p}`]}`}
                aria-pressed={query.priority.includes(p)}
                onClick={() => set({ priority: toggle(query.priority, p) })}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </fieldset>
          <div className={styles.selects}>
            <label className="sr-only" htmlFor="f-project">
              Project
            </label>
            <select id="f-project" className={`select ${styles.compact}`} value={query.project ?? ''} onChange={(e) => set({ project: e.target.value || null })}>
              <option value="">All projects</option>
              <option value={NO_PROJECT}>No project</option>
              {tree.map((row) => (
                <option key={row.project.id} value={row.project.id}>
                  {treeLabel(row)}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="f-assignee">
              Assignee
            </label>
            <select
              id="f-assignee"
              className={`select ${styles.compact}`}
              value={query.assignee ?? ''}
              onChange={(e) => set({ assignee: e.target.value || null })}
              data-testid="filter-assignee"
            >
              <option value="">All assignees</option>
              <option value={NO_ASSIGNEE}>Unassigned</option>
              {members!.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="f-tag">
              Tag
            </label>
            <select id="f-tag" className={`select ${styles.compact}`} value={query.tag ?? ''} onChange={(e) => set({ tag: e.target.value || null })}>
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="f-due">
              Due
            </label>
            <select id="f-due" className={`select ${styles.compact}`} value={query.due} onChange={(e) => set({ due: e.target.value as TaskQuery['due'] })}>
              {DUE_FILTERS.map((d) => (
                <option key={d} value={d}>
                  {DUE_LABEL[d]}
                </option>
              ))}
            </select>
            {activeFilters > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigate({ ...query, q: '', status: [], priority: [], project: null, assignee: null, tag: null, due: 'all', page: 1 })}
              >
                <IconX size={14} /> Clear ({activeFilters})
              </button>
            )}
          </div>
        </div>
      </section>

      {selectedIds.length > 0 && (
        <div className={styles.bulkBar} role="region" aria-label="Bulk actions">
          <strong>{selectedIds.length} selected</strong>
          <button type="button" className="btn btn-sm" onClick={bulkDone}>
            <IconCheck size={14} /> Mark done
          </button>
          <label className="sr-only" htmlFor="bulk-move">
            Move selected to project
          </label>
          <select
            id="bulk-move"
            className={`select ${styles.compact} ${styles.bulkSelect}`}
            value={moveTarget}
            onChange={(e) => {
              setMoveTarget(e.target.value);
              bulkMove(e.target.value);
            }}
          >
            <option value="">Move to project…</option>
            <option value={NO_PROJECT}>No project</option>
            {tree.map((row) => (
              <option key={row.project.id} value={row.project.id}>
                {treeLabel(row)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-danger" onClick={bulkDelete}>
            <IconTrash size={14} /> Delete
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div className={`card ${styles.list}`}>
        <div className={styles.head} role="presentation">
          <span className={styles.cellSelect}>
            <input
              type="checkbox"
              className="checkbox"
              checked={allOnPage}
              ref={(el) => {
                if (el) el.indeterminate = !allOnPage && someOnPage;
              }}
              onChange={() =>
                setSelected((s) => {
                  const n = new Set(s);
                  for (const id of pageIds) {
                    if (allOnPage) n.delete(id);
                    else n.add(id);
                  }
                  return n;
                })
              }
              aria-label="Select all tasks on this page"
              disabled={!pageIds.length}
            />
          </span>
          <span className={styles.cellDone} />
          <span className={styles.cellTitle}>Task</span>
          <span className={styles.cellProject}>Project</span>
          <span className={styles.cellAssignee} title="Assignee">
            <span className="sr-only">Assignee</span>
            <span aria-hidden="true">Who</span>
          </span>
          <span className={styles.cellPriority}>Priority</span>
          <span className={styles.cellStatus}>Status</span>
          <span className={styles.cellDue}>Due</span>
          <span className={styles.cellActions} />
        </div>
        {page.items.length ? (
          <ul className={styles.rows} aria-label="Tasks">
            {page.items.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                project={t.projectId ? projectMap.get(t.projectId) : undefined}
                assignee={t.assigneeId ? memberMap.get(t.assigneeId) : undefined}
                statusName={findStatus(workflowOf(t.projectId), t.statusId)?.name ?? t.statusId}
                blockers={t.category === 'done' || !t.blockedBy.length ? NO_TASKS : openBlockers(t, byId)}
                today={today}
                selected={selected.has(t.id)}
                onSelect={onSelect}
                onToggleDone={onToggleDone}
                onEdit={onEdit}
              />
            ))}
          </ul>
        ) : (
          <div className="empty">
            <strong>No tasks found</strong>
            <span>Try adjusting your search or filters.</span>
          </div>
        )}
      </div>

      <nav className={styles.pagination} aria-label="Pagination">
        <span className="muted">
          {page.total ? `Showing ${first}–${last} of ${page.total}` : 'No results'}
        </span>
        <div className={styles.pageButtons}>
          <button type="button" className="btn btn-sm" onClick={() => navigate({ ...query, page: page.page - 1 })} disabled={page.page <= 1}>
            <IconChevronLeft size={15} /> Prev
          </button>
          <span className={styles.pageInfo} aria-current="page">
            Page {page.page} of {page.pageCount}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate({ ...query, page: page.page + 1 })}
            disabled={page.page >= page.pageCount}
            data-testid="pagination-next"
          >
            Next <IconChevronRight size={15} />
          </button>
        </div>
      </nav>
    </div>
  );
}
