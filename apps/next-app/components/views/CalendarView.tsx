'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MONTH_NAMES, WEEKDAYS_MON, monthGrid } from '@/lib/dates';
import { NO_ASSIGNEE, matchesAssignee } from '@/lib/members';
import type { Task } from '@/lib/types';
import { PageSkeleton } from '../bits';
import { PRIORITY_COLOR } from '../charts';
import { IconChevronLeft, IconChevronRight, IconPlus } from '../icons';
import { useAppState, useToday } from '../store-hooks';
import { useUI } from '../ui';
import styles from './calendar.module.css';

const MAX_VISIBLE = 3;

export function CalendarView() {
  const state = useAppState();
  const today = useToday();
  const { openTaskModal } = useUI();
  /** null = month of today */
  const [cursor, setCursor] = useState<{ y: number; m: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [assigneeFilter, setAssigneeFilter] = useState('');

  const tasks = state?.tasks;
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks ?? []) {
      if (!t.dueDate || !matchesAssignee(t, assigneeFilter || null)) continue;
      const list = map.get(t.dueDate);
      if (list) list.push(t);
      else map.set(t.dueDate, [t]);
    }
    for (const list of map.values()) list.sort((a, b) => Number(a.category === 'done') - Number(b.category === 'done') || a.title.localeCompare(b.title));
    return map;
  }, [tasks, assigneeFilter]);

  if (!state || !today) return <PageSkeleton title="Calendar" rows={4} />;

  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7)) - 1;
  const { y, m } = cursor ?? { y: ty, m: tm };
  const days = monthGrid(y, m);
  const monthPrefix = `${y}-${String(m + 1).padStart(2, '0')}`;
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m + delta, 1));
    setCursor({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    setExpanded(new Set());
  };
  const isCurrentMonth = y === ty && m === tm;
  const monthCount = days.filter((d) => d.startsWith(monthPrefix)).reduce((s, d) => s + (byDay.get(d)?.length ?? 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" aria-live="polite">
            {MONTH_NAMES[m]} {y}
          </h1>
          <p className="page-subtitle">
            {monthCount} task{monthCount === 1 ? '' : 's'} due this month
          </p>
        </div>
        <div className={styles.nav}>
          <label htmlFor="calendar-assignee" className="sr-only">
            Filter by assignee
          </label>
          <select
            id="calendar-assignee"
            className={`select ${styles.filter}`}
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            data-testid="calendar-filter-assignee"
          >
            <option value="">All assignees</option>
            <option value={NO_ASSIGNEE}>Unassigned</option>
            {state.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => setCursor(null)} disabled={isCurrentMonth}>
            Today
          </button>
          <div className={styles.navGroup}>
            <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">
              <IconChevronLeft />
            </button>
            <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Next month">
              <IconChevronRight />
            </button>
          </div>
        </div>
      </div>

      <div className={`card ${styles.calendar}`}>
        <div className={styles.weekdays} aria-hidden="true">
          {WEEKDAYS_MON.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className={styles.grid} data-testid="calendar-grid" role="grid" aria-label={`${MONTH_NAMES[m]} ${y}`}>
          {Array.from({ length: days.length / 7 }, (_, w) => (
            <div key={w} role="row" className={styles.week}>
              {days.slice(w * 7, w * 7 + 7).map((day) => {
                const list = byDay.get(day) ?? [];
                const inMonth = day.startsWith(monthPrefix);
                const isToday = day === today;
                const open = expanded.has(day);
                const shown = open ? list : list.slice(0, MAX_VISIBLE);
                const dayNum = Number(day.slice(8));
                return (
                  <div
                    key={day}
                    role="gridcell"
                    className={`${styles.day} ${inMonth ? '' : styles.outside} ${isToday ? styles.today : ''}`}
                    aria-label={`${MONTH_NAMES[Number(day.slice(5, 7)) - 1]} ${dayNum}${isToday ? ', today' : ''}, ${list.length} task${list.length === 1 ? '' : 's'}`}
                  >
                    <div className={styles.dayHead}>
                      <span className={styles.dayNum} aria-hidden="true">
                        {dayNum}
                      </span>
                      <button
                        type="button"
                        className={styles.addBtn}
                        onClick={() =>
                          openTaskModal({ defaults: { dueDate: day, assigneeId: assigneeFilter && assigneeFilter !== NO_ASSIGNEE ? assigneeFilter : '' } })
                        }
                        aria-label={`Add task due ${day}`}
                      >
                        <IconPlus size={13} />
                      </button>
                    </div>
                    <ul className={styles.items}>
                      {shown.map((t) => (
                        <li key={t.id}>
                          <Link
                            href={`/tasks/${t.id}`}
                            className={`${styles.item} ${t.category === 'done' ? styles.itemDone : ''} ${t.category !== 'done' && day < today ? styles.itemOverdue : ''}`}
                            style={{ borderLeftColor: PRIORITY_COLOR[t.priority] }}
                            title={t.title}
                            prefetch={false}
                          >
                            {t.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {list.length > MAX_VISIBLE && (
                      <button
                        type="button"
                        className={styles.more}
                        aria-expanded={open}
                        onClick={() =>
                          setExpanded((s) => {
                            const n = new Set(s);
                            if (n.has(day)) n.delete(day);
                            else n.add(day);
                            return n;
                          })
                        }
                      >
                        {open ? 'Show less' : `+${list.length - MAX_VISIBLE} more`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
