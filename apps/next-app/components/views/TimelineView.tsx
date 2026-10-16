'use client';

import Link from 'next/link';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { addDays, formatLong, formatShort } from '@/lib/dates';
import { isOverdue } from '@/lib/filters';
import {
  ZOOMS,
  ZOOM_LABEL,
  ZOOM_PX,
  dayX,
  dependencyEdges,
  draggedDue,
  groupTimeline,
  monthBands,
  timelineRange,
  timelineTicks,
  type Range,
  type Span,
  type TimelineGroup,
  type Zoom,
} from '@/lib/timeline';
import type { Member, Task } from '@/lib/types';
import { Avatar, PageSkeleton } from '../bits';
import { IconChevronRight } from '../icons';
import { dispatch, nowIso, useAppState, useToday } from '../store-hooks';
import { useToast } from '../toast';
import styles from './timeline.module.css';

const ROW_H = 34;
const HEADER_H = 52;
const UNDATED_PREVIEW = 30;

type RowItem = { kind: 'group'; group: TimelineGroup } | { kind: 'task'; task: Task; span: Span; color: string };

interface BarRowProps {
  task: Task;
  span: Span;
  color: string;
  range: Range;
  px: number;
  today: string;
  assignee: Member | undefined;
  onChangeDue: (task: Task, due: string) => void;
}

/** One task row: sticky label + bar with a draggable / keyboard-adjustable right end (the due date). */
const BarRow = memo(function BarRow({ task, span, color, range, px, today, assignee, onChangeDue }: BarRowProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const drag = useRef<{ x: number; pointerId: number } | null>(null);
  const end = preview ?? span.end;
  const left = dayX(range, span.start, px);
  const width = Math.max(px, dayX(range, end, px) + px - left);
  const done = task.category === 'done';
  const overdue = isOverdue(task, today);

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, pointerId: e.pointerId };
    setPreview(span.end);
  };
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    setPreview(draggedDue(span, e.clientX - drag.current.x, px));
  };
  const finish = (e: PointerEvent<HTMLSpanElement>, commit: boolean) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    const next = draggedDue(span, e.clientX - drag.current.x, px);
    drag.current = null;
    setPreview(null);
    if (commit && next && next !== span.end) onChangeDue(task, next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const days = e.shiftKey ? step * 7 : step;
    const next = addDays(span.end, days);
    onChangeDue(task, next < span.start ? span.start : next);
  };

  return (
    <div className={styles.row} style={{ height: ROW_H }} data-testid="timeline-row" data-task-id={task.id}>
      <div className={styles.label}>
        {assignee ? <Avatar member={assignee} size={20} /> : <span className={styles.noAvatar} aria-hidden="true" />}
        <Link href={`/tasks/${task.id}`} className={`${styles.title} ${done ? styles.titleDone : ''}`} prefetch={false} title={task.title}>
          {task.title}
        </Link>
      </div>
      <div className={styles.track}>
        <div
          className={`${styles.bar} ${done ? styles.barDone : ''} ${overdue ? styles.barOverdue : ''} ${span.inverted ? styles.barInverted : ''} ${preview ? styles.barDragging : ''}`}
          style={{ left, width, ['--bar' as string]: color }}
          title={`${task.title} · ${formatShort(span.start)} → ${formatShort(end)}${span.inverted ? ' (due before it was created)' : ''}`}
          data-testid="timeline-bar"
        >
          {preview && <span className={styles.dragLabel}>{formatShort(preview)}</span>}
          <span
            className={styles.handle}
            role="slider"
            tabIndex={0}
            aria-label={`Due date of “${task.title}”`}
            aria-valuemin={0}
            aria-valuemax={range.days}
            aria-valuenow={Math.round(dayX(range, end, px) / px)}
            aria-valuetext={formatLong(end)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => finish(e, true)}
            onPointerCancel={(e) => finish(e, false)}
            onKeyDown={onKeyDown}
            data-testid="timeline-handle"
          />
        </div>
      </div>
    </div>
  );
});

function GroupRow({ group, collapsed, onToggle, range, px }: { group: TimelineGroup; collapsed: boolean; onToggle: (id: string) => void; range: Range; px: number }) {
  const span = group.span!;
  const left = dayX(range, span.start, px);
  const width = dayX(range, span.end, px) + px - left;
  return (
    <div className={`${styles.row} ${styles.groupRow}`} style={{ height: ROW_H }} data-testid="timeline-group">
      <div className={styles.label}>
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={!collapsed}
          onClick={() => onToggle(group.id)}
          data-testid="timeline-group-toggle"
        >
          <IconChevronRight size={15} className={styles.chevron} />
          <span className="dot" style={{ background: group.color ?? 'var(--border-strong)' }} aria-hidden="true" />
          <span className={styles.groupName}>{group.name}</span>
          <span className={styles.groupCount}>{group.tasks.length}</span>
        </button>
      </div>
      <div className={styles.track}>
        <div className={styles.groupBar} style={{ left, width, background: group.color ?? 'var(--border-strong)' }} aria-hidden="true" />
      </div>
    </div>
  );
}

export function TimelineView() {
  const state = useAppState();
  const today = useToday();
  const toast = useToast();
  const [zoom, setZoom] = useState<Zoom>('month');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showAllUndated, setShowAllUndated] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const tasks = state?.tasks;
  const projects = state?.projects;
  const members = state?.members;
  const memberMap = useMemo(() => new Map((members ?? []).map((m) => [m.id, m])), [members]);
  const { groups, undated } = useMemo(() => groupTimeline(tasks ?? [], projects ?? []), [tasks, projects]);
  const px = ZOOM_PX[zoom];
  const range = useMemo(
    () => timelineRange(groups.flatMap((g) => (g.span ? [g.span] : [])), today || '2000-01-01', zoom),
    [groups, today, zoom],
  );
  const ticks = useMemo(() => timelineTicks(range, zoom), [range, zoom]);
  const bands = useMemo(() => (zoom === 'quarter' ? [] : monthBands(range)), [range, zoom]);

  /** Flattened rows (group headers + visible task rows) and each task's row index. */
  const { rows, rowIndex } = useMemo(() => {
    const out: RowItem[] = [];
    const index = new Map<string, number>();
    for (const g of groups) {
      out.push({ kind: 'group', group: g });
      if (collapsed.has(g.id)) continue;
      for (const { task, span } of g.tasks) {
        index.set(task.id, out.length);
        out.push({ kind: 'task', task, span, color: g.color ?? 'var(--text-subtle)' });
      }
    }
    return { rows: out, rowIndex: index };
  }, [groups, collapsed]);

  const edges = useMemo(() => dependencyEdges(tasks ?? [], new Set(rowIndex.keys())), [tasks, rowIndex]);
  const shownTasks = useMemo(() => {
    const m = new Map<string, { span: Span; done: boolean }>();
    for (const r of rows) if (r.kind === 'task') m.set(r.task.id, { span: r.span, done: r.task.category === 'done' });
    return m;
  }, [rows]);

  const onChangeDue = useCallback(
    (task: Task, due: string) => {
      dispatch({ type: 'task/update', id: task.id, patch: { dueDate: due }, at: nowIso() });
      toast(`Moved “${task.title}” due date to ${formatLong(due)}`, { undo: true, tone: 'success' });
    },
    [toast],
  );
  const onToggle = useCallback(
    (id: string) =>
      setCollapsed((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );

  const scrollToToday = useCallback(() => {
    const el = scroller.current;
    if (!el || !today) return;
    const labelW = el.querySelector<HTMLElement>('[data-corner]')?.offsetWidth ?? 0;
    el.scrollLeft = Math.max(0, dayX(range, today, px) - (el.clientWidth - labelW) / 3);
  }, [range, today, px]);

  // Centre "today" when the chart first appears and whenever the zoom changes.
  const ready = !!state && !!today;
  useLayoutEffect(() => {
    if (ready) scrollToToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first render and zoom changes, not on every data edit
  }, [ready, zoom]);

  if (!state || !today) return <PageSkeleton title="Timeline" rows={4} />;

  const width = range.days * px;
  const bodyH = rows.length * ROW_H;
  const todayX = dayX(range, today, px) + px / 2;
  const dated = groups.reduce((s, g) => s + g.tasks.length, 0);
  const shownUndated = showAllUndated ? undated : undated.slice(0, UNDATED_PREVIEW);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Timeline</h1>
          <p className="page-subtitle">
            {dated} scheduled task{dated === 1 ? '' : 's'} · {undated.length} without a due date · drag a bar’s right end to change its due date
          </p>
        </div>
        <div className={styles.controls}>
          <div className={styles.segmented} role="group" aria-label="Zoom">
            {ZOOMS.map((z) => (
              <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} data-testid={`timeline-zoom-${z}`}>
                {ZOOM_LABEL[z]}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={scrollToToday}>
            Today
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.id)))}
          >
            {collapsed.size ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      </div>

      <div className={`card ${styles.chart}`} data-testid="timeline-chart">
        <div className={styles.scroller} ref={scroller}>
          <div className={styles.canvas} style={{ width: `calc(var(--label-w) + ${width}px)` }}>
            <div className={styles.header} style={{ height: HEADER_H }}>
              <div className={styles.corner} data-corner>
                Task
              </div>
              <div className={styles.scale} style={{ width }}>
                {bands.map((b) => (
                  <div key={b.start} className={styles.band} style={{ left: dayX(range, b.start, px), width: b.days * px }}>
                    <span>{b.label}</span>
                  </div>
                ))}
                {ticks.map((t) =>
                  t.label ? (
                    <span
                      key={t.date}
                      className={`${styles.tick} ${t.major ? styles.tickMajor : ''} ${t.date === today ? styles.tickToday : ''} ${zoom === 'quarter' ? styles.tickTop : ''}`}
                      style={{ left: dayX(range, t.date, px), width: zoom === 'week' ? px : undefined }}
                    >
                      {t.label}
                    </span>
                  ) : null,
                )}
              </div>
            </div>

            <div className={styles.body} style={{ height: bodyH }}>
              <div className={styles.grid} style={{ width }} aria-hidden="true">
                {ticks.map((t) => (
                  <span key={t.date} className={t.major ? styles.gridMajor : styles.gridMinor} style={{ left: dayX(range, t.date, px) }} />
                ))}
                <span className={styles.todayLine} style={{ left: todayX }} data-testid="timeline-today" />
              </div>

              {edges.length > 0 && (
                <svg className={styles.arrows} width={width} height={bodyH} aria-hidden="true">
                  <defs>
                    <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M0,0 L8,4 L0,8 Z" className={styles.arrowHead} />
                    </marker>
                  </defs>
                  {edges.map(({ from, to }) => {
                    const blocker = shownTasks.get(from)!;
                    const a = blocker.span;
                    const b = shownTasks.get(to)!.span;
                    const x1 = dayX(range, a.end, px) + px;
                    const y1 = rowIndex.get(from)! * ROW_H + ROW_H / 2;
                    const x2 = dayX(range, b.start, px);
                    const y2 = rowIndex.get(to)! * ROW_H + ROW_H / 2;
                    // Route the horizontal leg through the empty band between bars (not on the row border).
                    const mid = y2 + (y1 < y2 ? -ROW_H / 2 + 4 : ROW_H / 2 - 4);
                    const d =
                      x2 - x1 >= 16
                        ? `M${x1},${y1} H${x1 + 8} V${y2} H${x2}`
                        : `M${x1},${y1} H${x1 + 8} V${mid} H${x2 - 10} V${y2} H${x2}`;
                    return <path key={`${from}-${to}`} d={d} className={`${styles.arrow} ${blocker.done ? styles.arrowDone : ''}`} markerEnd="url(#tl-arrow)" data-testid="timeline-arrow" />;
                  })}
                </svg>
              )}
              {rows.map((r) =>
                r.kind === 'group' ? (
                  <GroupRow key={`g-${r.group.id}`} group={r.group} collapsed={collapsed.has(r.group.id)} onToggle={onToggle} range={range} px={px} />
                ) : (
                  <BarRow
                    key={r.task.id}
                    task={r.task}
                    span={r.span}
                    color={r.color}
                    range={range}
                    px={px}
                    today={today}
                    assignee={r.task.assigneeId ? memberMap.get(r.task.assigneeId) : undefined}
                    onChangeDue={onChangeDue}
                  />
                ),
              )}

            </div>
          </div>
        </div>
      </div>

      <p className={styles.legend}>
        Bars run from the day a task was created to its due date · <span className={styles.legendArrow}>→</span> dependency (blocker → blocked) · focus a bar end and use ← → (Shift for a week) to move its due date.
      </p>

      <section className={`card ${styles.undated}`} aria-labelledby="undated-title" data-testid="timeline-undated">
        <h2 id="undated-title" className="section-title">
          No due date <span className="muted">({undated.length})</span>
        </h2>
        {undated.length ? (
          <>
            <ul className={styles.undatedList}>
              {shownUndated.map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} prefetch={false}>
                    {t.title}
                  </Link>
                  {t.projectId && <span className="muted"> · {projects!.find((p) => p.id === t.projectId)?.name}</span>}
                </li>
              ))}
            </ul>
            {undated.length > UNDATED_PREVIEW && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAllUndated((v) => !v)}>
                {showAllUndated ? 'Show fewer' : `Show all ${undated.length}`}
              </button>
            )}
          </>
        ) : (
          <p className="muted">Every task has a due date.</p>
        )}
      </section>
    </div>
  );
}
