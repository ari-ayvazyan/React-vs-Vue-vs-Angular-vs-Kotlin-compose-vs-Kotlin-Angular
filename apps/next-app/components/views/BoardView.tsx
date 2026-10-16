'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { DUE_LABEL, NO_PROJECT, SORT_LABEL, filterTasks, isOverdue, parseQuery, queryToSearch, type TaskQuery } from '@/lib/filters';
import { NO_ASSIGNEE } from '@/lib/members';
import { PRIORITY_LABEL } from '@/lib/types';
import { boardQuery, describeQuery } from '@/lib/views';
import { STATUSES, STATUS_LABEL, type Member, type Project, type StatusCategory, type Task } from '@/lib/types';
import { effectiveWorkflow, projectMap as toProjectMap, projectTree, statusForCategory, treeLabel, workflowResolver } from '@/lib/workflow';
import { openBlockers, taskMap } from '@/lib/dependencies';
import { AssigneeChip, BlockedBadge, DueLabel, PageSkeleton, PriorityBadge, ProjectChip, RecurrenceIcon } from '../bits';
import { useCompletionGuard } from '../completion';
import { IconPlus, IconX } from '../icons';
import { dispatch, nowIso, useAppState, useToday } from '../store-hooks';
import { useUI } from '../ui';
import styles from './board.module.css';

const NO_TASKS: Task[] = [];

/**
 * A board column: a status category ("All projects" / "No project") or, when a project is
 * selected, one status of that project's workflow.
 */
interface Column {
  id: string;
  name: string;
  color: string | null;
  category: StatusCategory;
}

interface DropTarget {
  /** column id */
  status: string;
  /** index among the visible cards (excluding the dragged one) */
  index: number;
}

interface CardProps {
  task: Task;
  project: Project | undefined;
  assignee: Member | undefined;
  blockers: Task[];
  today: string;
  dragging: boolean;
  onDragStart: (e: DragEvent<HTMLElement>, id: string) => void;
  onDragEnd: () => void;
  onKeyMove: (e: KeyboardEvent<HTMLElement>, task: Task) => void;
}

const Card = memo(function Card({ task, project, assignee, blockers, today, dragging, onDragStart, onDragEnd, onKeyMove }: CardProps) {
  const sub = task.subtasks.length;
  const subDone = task.subtasks.filter((s) => s.done).length;
  const overdue = isOverdue(task, today);
  return (
    <li
      className={`${styles.card} ${dragging ? styles.dragging : ''} ${overdue ? styles.cardOverdue : ''}`}
      draggable
      tabIndex={0}
      data-card-id={task.id}
      data-testid="board-card"
      aria-roledescription="Draggable task card"
      aria-label={`${task.title}. ${STATUS_LABEL[task.category]}. Press Shift and arrow keys to move.`}
      onDragStart={(e) => onDragStart(e, task.id)}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => onKeyMove(e, task)}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardBadges}>
          <PriorityBadge priority={task.priority} />
          <BlockedBadge blockers={blockers} />
          <RecurrenceIcon recurrence={task.recurrence} />
        </span>
        <DueLabel due={task.dueDate} today={today} done={task.category === 'done'} />
      </div>
      <Link href={`/tasks/${task.id}`} className={styles.cardTitle} draggable={false} tabIndex={-1} prefetch={false}>
        {task.title}
      </Link>
      <div className={styles.cardBottom}>
        <ProjectChip project={project} />
        <span className={styles.cardBadges}>
          {sub > 0 && (
            <span className={styles.subProgress} title={`${subDone} of ${sub} subtasks done`}>
              <span className="progress" style={{ width: 36 }}>
                <span style={{ width: `${(subDone / sub) * 100}%` }} />
              </span>
              {subDone}/{sub}
            </span>
          )}
          <AssigneeChip member={assignee} size={22} />
        </span>
      </div>
    </li>
  );
});

export function BoardView() {
  const state = useAppState();
  const today = useToday();
  const { openTaskModal } = useUI();
  // Filters live in the URL so saved views (and shared links) can open the board pre-filtered.
  const params = useSearchParams();
  const query = useMemo(() => boardQuery(parseQuery(params)), [params]);
  const projectFilter = query.project ?? '';
  const assigneeFilter = query.assignee ?? '';
  const filtering = queryToSearch(query) !== '';
  const setFilter = (patch: Partial<TaskQuery>) => window.history.replaceState(null, '', `/board${queryToSearch(boardQuery({ ...query, ...patch }))}`);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const focusAfterMove = useRef<string | null>(null);

  const tasks = state?.tasks;
  const projects = state?.projects;
  const members = state?.members;
  const projectMap = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);
  const memberMap = useMemo(() => new Map((members ?? []).map((m) => [m.id, m])), [members]);
  const byId = useMemo(() => taskMap(tasks ?? []), [tasks]);
  const guardDone = useCompletionGuard();

  const workflowOf = useMemo(() => workflowResolver(projects ?? []), [projects]);
  /** A specific project shows its workflow's statuses; otherwise the three categories. */
  const boardColumns = useMemo<Column[]>(() => {
    if (projectFilter && projectFilter !== NO_PROJECT && projects?.some((p) => p.id === projectFilter)) {
      return effectiveWorkflow(toProjectMap(projects), projectFilter).map((s) => ({ id: s.id, name: s.name, color: s.color, category: s.category }));
    }
    return STATUSES.map((c) => ({ id: c, name: STATUS_LABEL[c], color: null, category: c }));
  }, [projectFilter, projects]);
  const workflowMode = boardColumns.some((c) => c.color !== null);

  /** All tasks per category, by order (the ordering space of moves). */
  const byCategory = useMemo(() => {
    const out: Record<StatusCategory, Task[]> = { todo: [], in_progress: [], done: [] };
    for (const t of tasks ?? []) out[t.category].push(t);
    for (const c of STATUSES) out[c].sort((a, b) => a.order - b.order);
    return out;
  }, [tasks]);

  /** Column a task is shown in: its own status, or (sub-project with another workflow) the first column of its category. */
  const columnOf = useCallback(
    (t: Task) => (workflowMode ? (boardColumns.find((c) => c.id === t.statusId) ?? boardColumns.find((c) => c.category === t.category))!.id : t.category),
    [boardColumns, workflowMode],
  );

  /** Visible (filtered) cards per column id, each sorted by order. */
  const visible = useMemo(() => {
    const out: Record<string, Task[]> = Object.fromEntries(boardColumns.map((c) => [c.id, []]));
    for (const c of STATUSES) {
      const list = filtering && today ? filterTasks(byCategory[c], query, today, projects) : byCategory[c];
      for (const t of list) out[columnOf(t)]?.push(t);
    }
    return out;
  }, [boardColumns, byCategory, filtering, today, query, projects, columnOf]);

  // Restore keyboard focus to a card after it moved (it may have re-mounted in another column).
  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id) return;
    focusAfterMove.current = null;
    document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)?.focus();
  });

  /** Converts an index among a column's visible cards (dragged card excluded) to an index in the full category list. */
  const toFullIndex = useCallback(
    (col: Column, visibleIndex: number, movingId: string) => {
      const vis = visible[col.id].filter((t) => t.id !== movingId);
      const full = byCategory[col.category].filter((t) => t.id !== movingId);
      if (visibleIndex < vis.length) return full.indexOf(vis[visibleIndex]);
      if (!vis.length) return full.length;
      return full.indexOf(vis[vis.length - 1]) + 1;
    },
    [visible, byCategory],
  );

  const move = useCallback(
    (task: Task, col: Column, visibleIndex: number) => {
      if (col.category === 'done' && task.category !== 'done' && !guardDone([task.id]).length) {
        setAnnouncement(`“${task.title}” is blocked and stays where it is.`);
        return;
      }
      // The task's own workflow decides the exact status (a sub-project may use another workflow).
      const wf = workflowOf(task.projectId);
      const statusId = wf.some((s) => s.id === col.id) ? col.id : statusForCategory(wf, col.category, task.statusId);
      const index = toFullIndex(col, visibleIndex, task.id);
      dispatch({ type: 'task/move', id: task.id, statusId, index, at: nowIso() });
      const count = visible[col.id].filter((t) => t.id !== task.id).length + 1;
      setAnnouncement(`Moved “${task.title}” to ${col.name}, position ${Math.min(visibleIndex, count - 1) + 1} of ${count}.`);
    },
    [toFullIndex, visible, guardDone, workflowOf],
  );

  const onDragStart = useCallback((e: DragEvent<HTMLElement>, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    // Defer so the drag image is captured before the card is dimmed.
    requestAnimationFrame(() => setDragId(id));
  }, []);

  const onDragEnd = useCallback(() => {
    setDragId(null);
    setDrop(null);
  }, []);

  const onKeyMove = useCallback(
    (e: KeyboardEvent<HTMLElement>, task: Task) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter') {
        (e.currentTarget.querySelector('a') as HTMLAnchorElement | null)?.click();
        return;
      }
      if (!e.shiftKey) return;
      const ci = boardColumns.findIndex((c) => c.id === columnOf(task));
      const col = visible[boardColumns[ci].id];
      const idx = col.findIndex((t) => t.id === task.id);
      let target: { col: Column; index: number } | null = null;
      if (e.key === 'ArrowLeft' && ci > 0) target = { col: boardColumns[ci - 1], index: idx };
      else if (e.key === 'ArrowRight' && ci < boardColumns.length - 1) target = { col: boardColumns[ci + 1], index: idx };
      else if (e.key === 'ArrowUp' && idx > 0) target = { col: boardColumns[ci], index: idx - 1 };
      else if (e.key === 'ArrowDown' && idx < col.length - 1) target = { col: boardColumns[ci], index: idx + 1 };
      if (!e.key.startsWith('Arrow')) return;
      e.preventDefault();
      if (!target) return;
      focusAfterMove.current = task.id;
      move(task, target.col, target.index);
    },
    [visible, move, boardColumns, columnOf],
  );

  if (!state || !today) return <PageSkeleton title="Board" rows={3} />;

  const onColumnDragOver = (e: DragEvent<HTMLElement>, status: string) => {
    if (!dragId && !e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-card-id]')).filter((el) => el.dataset.cardId !== dragId);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    if (!drop || drop.status !== status || drop.index !== index) setDrop({ status, index });
  };

  const onColumnDrop = (e: DragEvent<HTMLElement>, col: Column) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragId;
    const task = id ? tasks!.find((t) => t.id === id) : undefined;
    const index = drop?.status === col.id ? drop.index : visible[col.id].length;
    setDragId(null);
    setDrop(null);
    if (task) move(task, col, index);
  };

  return (
    <div className={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Board</h1>
          <p className="page-subtitle">Drag cards between columns, or focus a card and use Shift + arrow keys.</p>
        </div>
        <div className="row">
          <label htmlFor="board-project" className="sr-only">
            Filter by project
          </label>
          <select id="board-project" className="select" style={{ width: 'auto' }} value={projectFilter} onChange={(e) => setFilter({ project: e.target.value || null })}>
            <option value="">All projects</option>
            <option value={NO_PROJECT}>No project</option>
            {projectTree(projects!).map((row) => (
              <option key={row.project.id} value={row.project.id}>
                {treeLabel(row)}
              </option>
            ))}
          </select>
          <label htmlFor="board-assignee" className="sr-only">
            Filter by assignee
          </label>
          <select
            id="board-assignee"
            className="select"
            style={{ width: 'auto' }}
            value={assigneeFilter}
            onChange={(e) => setFilter({ assignee: e.target.value || null })}
            data-testid="board-filter-assignee"
          >
            <option value="">All assignees</option>
            <option value={NO_ASSIGNEE}>Unassigned</option>
            {members!.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(query.q || query.priority.length > 0 || query.tag || query.due !== 'all') && (
        <div className={styles.extraFilters} role="status" data-testid="board-extra-filters">
          <span>
            Also filtered by{' '}
            <strong>
              {describeQuery(
                { ...query, project: null, assignee: null },
                {
                  project: () => '',
                  member: () => '',
                  status: (x) => x,
                  priority: (x) => PRIORITY_LABEL[x as Task['priority']],
                  due: (x) => DUE_LABEL[x as TaskQuery['due']],
                  sort: (x) => SORT_LABEL[x as TaskQuery['sort']],
                },
              )}
            </strong>
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFilter({ q: '', priority: [], tag: null, due: 'all' })}>
            <IconX size={14} /> Clear
          </button>
        </div>
      )}

      <p className="sr-only" aria-live="assertive">
        {announcement}
      </p>

      <div className={styles.board}>
        {boardColumns.map((col) => {
          const status = col.id;
          const cards = visible[status];
          const isTarget = drop?.status === status;
          let visibleIdx = -1;
          return (
            <section
              key={status}
              className={`${styles.column} ${isTarget ? styles.columnTarget : ''}`}
              data-testid={`board-column-${status}`}
              data-category={col.category}
              aria-labelledby={`col-${status}`}
              onDragOver={(e) => onColumnDragOver(e, status)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null) && drop?.status === status) setDrop(null);
              }}
              onDrop={(e) => onColumnDrop(e, col)}
            >
              <header className={styles.columnHead}>
                <span
                  className={`${styles.columnDot} ${col.color ? '' : styles[`dot_${col.category}`]}`}
                  style={col.color ? { background: col.color } : undefined}
                  aria-hidden="true"
                />
                <h2 id={`col-${status}`} className={styles.columnTitle} title={col.color ? `Category: ${STATUS_LABEL[col.category]}` : undefined}>
                  {col.name}
                </h2>
                <span className={styles.columnCount}>{cards.length}</span>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() =>
                    openTaskModal({
                      defaults: {
                        status: col.id,
                        projectId: projectFilter && projectFilter !== NO_PROJECT ? projectFilter : '',
                        assigneeId: assigneeFilter && assigneeFilter !== NO_ASSIGNEE ? assigneeFilter : '',
                      },
                    })
                  }
                  aria-label={`Add task to ${col.name}`}
                >
                  <IconPlus size={16} />
                </button>
              </header>
              <ul className={styles.cards}>
                {cards.map((t) => {
                  if (t.id !== dragId) visibleIdx++;
                  const showIndicator = isTarget && t.id !== dragId && drop!.index === visibleIdx;
                  return (
                    <CardSlot key={t.id} indicator={showIndicator}>
                      <Card
                        task={t}
                        project={t.projectId ? projectMap.get(t.projectId) : undefined}
                        assignee={t.assigneeId ? memberMap.get(t.assigneeId) : undefined}
                        blockers={t.category === 'done' || !t.blockedBy.length ? NO_TASKS : openBlockers(t, byId)}
                        today={today}
                        dragging={t.id === dragId}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        onKeyMove={onKeyMove}
                      />
                    </CardSlot>
                  );
                })}
                {isTarget && drop!.index >= cards.filter((t) => t.id !== dragId).length && <li className={styles.indicator} aria-hidden="true" />}
                {!cards.length && !isTarget && <li className={styles.emptyCol}>No tasks</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CardSlot({ indicator, children }: { indicator: boolean; children: React.ReactNode }) {
  return (
    <>
      {indicator && <li className={styles.indicator} aria-hidden="true" />}
      {children}
    </>
  );
}
