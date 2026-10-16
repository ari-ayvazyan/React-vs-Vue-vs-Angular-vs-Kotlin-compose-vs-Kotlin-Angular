'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { formatShort } from '@/lib/dates';
import { NO_ASSIGNEE, avatarTextColor, memberInitials } from '@/lib/members';
import type { CycleTimeRow, DayValue } from '@/lib/reports';
import type { AssigneeLoad, DayCount, ProjectProgress } from '@/lib/stats';
import { PRIORITIES, PRIORITY_LABEL, type Member, type Priority } from '@/lib/types';
import styles from './charts.module.css';

const H = 230;
const PAD = { top: 16, right: 16, bottom: 30, left: 34 };

/** Tracks an element's content width so SVG text renders at its real pixel size. */
function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Rounds the axis maximum up so 4 equal steps are integers (and "nice" for larger values). */
function niceMax(v: number): number {
  const raw = Math.max(1, v) / 4;
  if (raw <= 10) return Math.ceil(raw) * 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return step * 4;
}

/** Area chart of completions per day with hover / keyboard tooltip. */
export function CompletedAreaChart({ data }: { data: DayCount[] }) {
  return (
    <AreaChart
      data={data.map((d) => ({ date: d.date, value: d.count }))}
      unit="completed"
      label={`Tasks completed per day over the last ${data.length} days: ${data.reduce((s, d) => s + d.count, 0)} in total.`}
    />
  );
}

/**
 * Area chart of one value per day (hand-written SVG) with axis labels and a hover / keyboard
 * tooltip. `unit` follows the number in the tooltip ("12 completed", "40 open").
 */
export function AreaChart({ data, unit, label, testId }: { data: DayValue[]; unit: string; label: string; testId?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [wrapRef, W] = useWidth(640);
  const gradId = useId();
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length > 1 ? (i / (data.length - 1)) * iw : iw / 2);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('');
  const area = `${line}L${x(data.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const labelEvery = W < 420 ? 10 : 7;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / iw) * (data.length - 1));
    setActive(Math.max(0, Math.min(data.length - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      setActive((a) => Math.max(0, Math.min(data.length - 1, (a ?? data.length - 1) + d)));
    }
  };

  const a = active !== null ? data[active] : null;
  return (
    <div className={styles.chartWrap} ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className={styles.svg}
        role="img"
        aria-label={`${label} Use left and right arrow keys to inspect days.`}
        data-testid={testId}
        tabIndex={0}
        onMouseMove={onMove}
        onMouseLeave={() => setActive(null)}
        onFocus={() => setActive(data.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={styles.grid} />
            <text x={PAD.left - 8} y={y(t)} className={styles.axisLabel} textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) =>
          (i % labelEvery === (data.length - 1) % labelEvery && data.length - 1 - i >= labelEvery / 2) || i === data.length - 1 ? (
            <text key={d.date} x={x(i)} y={H - 8} className={styles.axisLabel} textAnchor={i === data.length - 1 ? 'end' : 'middle'}>
              {i === data.length - 1 ? 'Today' : formatShort(d.date)}
            </text>
          ) : null,
        )}
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} className={styles.line} />
        {a && active !== null && (
          <g>
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={y(0)} className={styles.cursor} />
            <circle cx={x(active)} cy={y(a.value)} r={5} className={styles.point} />
          </g>
        )}
      </svg>
      {a && active !== null && (
        <div
          className={styles.tooltip}
          style={{
            left: `${(x(active) / W) * 100}%`,
            top: `${(y(a.value) / H) * 100}%`,
            transform: `translate(${active > data.length * 0.75 ? '-100%' : active < data.length * 0.25 ? '0' : '-50%'}, calc(-100% - 12px))`,
          }}
          aria-hidden="true"
        >
          <strong>{a.value}</strong> {unit}
          <span>{formatShort(a.date)}</span>
        </div>
      )}
    </div>
  );
}

export const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: '#e5484d',
  high: '#f59e0b',
  medium: '#3b82f6',
  low: '#94a3b8',
};

export function PriorityDonut({ counts }: { counts: Record<Priority, number> }) {
  const [hover, setHover] = useState<Priority | null>(null);
  const total = PRIORITIES.reduce((s, p) => s + counts[p], 0);
  const r = 60;
  const c = 2 * Math.PI * r;
  const order = [...PRIORITIES].reverse();
  const lengths = order.map((p) => (total ? (counts[p] / total) * c : 0));
  const segments = order.map((p, i) => ({
    p,
    len: lengths[i],
    offset: lengths.slice(0, i).reduce((s, l) => s + l, 0),
  }));
  const shown = hover ?? null;

  return (
    <div className={styles.donutWrap}>
      <svg
        viewBox="0 0 160 160"
        className={styles.donut}
        role="img"
        aria-label={`Open tasks by priority: ${order.map((p) => `${PRIORITY_LABEL[p]} ${counts[p]}`).join(', ')}`}
      >
        <circle cx="80" cy="80" r={r} className={styles.donutTrack} />
        {segments.map(({ p, len, offset: o }) =>
          len > 0 ? (
            <circle
              key={p}
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke={PRIORITY_COLOR[p]}
              strokeWidth={hover === p ? 22 : 18}
              strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`}
              strokeDashoffset={-o}
              transform="rotate(-90 80 80)"
              className={styles.donutSeg}
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover(null)}
            />
          ) : null,
        )}
        <text x="80" y="76" textAnchor="middle" className={styles.donutValue}>
          {shown ? counts[shown] : total}
        </text>
        <text x="80" y="96" textAnchor="middle" className={styles.donutLabel}>
          {shown ? PRIORITY_LABEL[shown] : 'open tasks'}
        </text>
      </svg>
      <ul className={styles.legend}>
        {order.map((p) => (
          <li
            key={p}
            className={`${styles.legendItem} ${hover === p ? styles.legendActive : ''}`}
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="dot" style={{ background: PRIORITY_COLOR[p] }} aria-hidden="true" />
            <span className={styles.legendName}>{PRIORITY_LABEL[p]}</span>
            <span className={styles.legendValue}>{counts[p]}</span>
            <span className={styles.legendPct}>{total ? Math.round((counts[p] / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProjectBars({ rows }: { rows: (ProjectProgress & { depth?: number })[] }) {
  if (!rows.length) return <p className="muted">No projects yet.</p>;
  return (
    <ul className={styles.bars} aria-label="Completion per project">
      {rows.map(({ project, total, done, pct, depth = 0 }) => (
        <li key={project.id} className={styles.barRow}>
          <Link href={`/tasks?project=${project.id}`} className={styles.barName} style={depth ? { paddingLeft: depth * 14 } : undefined} title={depth ? 'Sub-project (numbers include its own sub-projects)' : undefined}>
            <span className="dot" style={{ background: project.color }} aria-hidden="true" />
            <span>{project.name}</span>
          </Link>
          <div
            className={styles.barTrack}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={`${project.name} completion`}
          >
            <div className={styles.barFill} style={{ width: `${pct}%`, background: project.color }} />
          </div>
          <span className={styles.barValue}>
            {pct}% <span className="muted">· {done}/{total}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const AB = { row: 34, bar: 14, avatar: 22, gap: 10, valueW: 44 };
const UNASSIGNED_COLOR = 'var(--border-strong)';

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

export interface MemberBarRow {
  /** null = unassigned */
  member: Member | null;
  value: number;
  /** text at the end of the bar, e.g. "12" or "7.5 h" */
  valueLabel: string;
  /** accessible label for the row */
  label: string;
  /** tooltip: bold first line + secondary line */
  tip: string;
  tipSub: string;
  /** optional link target (client-side navigation) */
  href?: string;
}

/** Horizontal bar chart with one row per member (avatar, name, bar in the member colour, value). Hand-written SVG. */
export function MemberBars({ rows, label, empty, testId }: { rows: MemberBarRow[]; label: string; empty: string; testId?: string }) {
  const router = useRouter();
  const [wrapRef, W] = useWidth(420);
  const [active, setActive] = useState<number | null>(null);
  if (!rows.length) return <p className="muted">{empty}</p>;

  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  const labelW = W < 420 ? 110 : 150;
  const barX = labelW + AB.gap;
  const valueW = Math.max(AB.valueW, ...rows.map((r) => r.valueLabel.length * 8 + 12));
  const barW = Math.max(40, W - barX - valueW);
  const H = rows.length * AB.row;
  const maxChars = W < 420 ? 11 : 17;
  const a = active !== null ? rows[active] : null;
  const barWidth = (v: number) => (v > 0 ? Math.max(4, (v / max) * barW) : 0);

  return (
    <div className={styles.chartWrap} ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={styles.svg} role="list" aria-label={label} onMouseLeave={() => setActive(null)} data-testid={testId}>
        {rows.map((r, i) => {
          const name = r.member ? r.member.name : 'Unassigned';
          const color = r.member ? r.member.color : UNASSIGNED_COLOR;
          const cy = i * AB.row + AB.row / 2;
          const w = barWidth(r.value);
          const content = (
            <>
              <rect x={0} y={i * AB.row + 2} width={W} height={AB.row - 4} rx={6} className={styles.abHit} />
              {r.member ? (
                <g aria-hidden="true">
                  <circle cx={AB.avatar / 2} cy={cy} r={AB.avatar / 2} fill={color} />
                  <text x={AB.avatar / 2} y={cy} textAnchor="middle" dominantBaseline="central" className={styles.abInitials} fill={avatarTextColor(r.member.color)}>
                    {memberInitials(r.member.name)}
                  </text>
                </g>
              ) : (
                <circle cx={AB.avatar / 2} cy={cy} r={AB.avatar / 2 - 1} className={styles.abNobody} aria-hidden="true" />
              )}
              <text x={AB.avatar + 8} y={cy} dominantBaseline="central" className={`${styles.abName} ${r.member ? '' : styles.abMuted}`} aria-hidden="true">
                {truncate(name, maxChars)}
              </text>
              <rect x={barX} y={cy - AB.bar / 2} width={barW} height={AB.bar} rx={4} className={styles.abTrack} />
              {w > 0 && <rect x={barX} y={cy - AB.bar / 2} width={w} height={AB.bar} rx={4} fill={color} />}
              <text x={barX + barW + 8} y={cy} dominantBaseline="central" className={styles.abValue} aria-hidden="true">
                {r.valueLabel}
              </text>
            </>
          );
          const common = {
            role: 'listitem',
            'aria-label': r.label,
            className: `${styles.abRow} ${active === i ? styles.abActive : ''}`,
            onMouseEnter: () => setActive(i),
            onFocus: () => setActive(i),
            onBlur: () => setActive(null),
          } as const;
          return r.href ? (
            <a
              key={r.member?.id ?? 'none'}
              href={r.href}
              {...common}
              onClick={(e) => {
                e.preventDefault();
                router.push(r.href!);
              }}
            >
              {content}
            </a>
          ) : (
            <g key={r.member?.id ?? 'none'} tabIndex={0} {...common}>
              {content}
            </g>
          );
        })}
      </svg>
      {a && active !== null && (
        <div
          className={styles.tooltip}
          style={{
            left: `${((barX + barWidth(a.value)) / W) * 100}%`,
            top: `${((active * AB.row + 4) / H) * 100}%`,
            transform: 'translate(-50%, calc(-100% - 4px))',
          }}
          aria-hidden="true"
        >
          <strong>{a.tip}</strong>
          <span>{a.tipSub}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Open tasks per assignee (dashboard). Each row links to the task list filtered to that
 * assignee's open tasks; hover/focus shows the share of all open tasks.
 */
export function AssigneeBars({ rows }: { rows: AssigneeLoad[] }) {
  const total = rows.reduce((s, r) => s + r.open, 0);
  return (
    <MemberBars
      label={`Open tasks per assignee, ${total} open in total`}
      empty="No team members yet. Add some in Settings."
      rows={rows.map((r) => {
        const name = r.member ? r.member.name : 'Unassigned';
        return {
          member: r.member,
          value: r.open,
          valueLabel: String(r.open),
          label: `${name}: ${r.open} open task${r.open === 1 ? '' : 's'}`,
          tip: `${r.open} open task${r.open === 1 ? '' : 's'}`,
          tipSub: `${name} · ${total ? Math.round((r.open / total) * 100) : 0}% of open`,
          href: `/tasks?assignee=${r.member ? r.member.id : NO_ASSIGNEE}&status=todo,in_progress`,
        };
      })}
    />
  );
}

/** Vertical bars of average cycle time (days) per priority, with the sample size under each bar. Hand-written SVG. */
export function CycleTimeBars({ rows, testId }: { rows: CycleTimeRow[]; testId?: string }) {
  const [wrapRef, W] = useWidth(420);
  const H = 220;
  const pad = { top: 22, bottom: 44, left: 34, right: 8 };
  const values = rows.map((r) => r.avgDays ?? 0);
  const max = niceMax(Math.max(...values, 0));
  const ih = H - pad.top - pad.bottom;
  const slot = (W - pad.left - pad.right) / rows.length;
  const bw = Math.min(56, slot * 0.55);
  const y = (v: number) => pad.top + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f * 10) / 10);
  return (
    <div className={styles.chartWrap} ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className={styles.svg}
        role="img"
        aria-label={`Average cycle time by priority: ${rows.map((r) => `${PRIORITY_LABEL[r.priority]} ${r.avgDays === null ? 'no completed tasks' : `${r.avgDays} days over ${r.count} tasks`}`).join(', ')}`}
        data-testid={testId}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className={styles.grid} />
            <text x={pad.left - 8} y={y(t)} className={styles.axisLabel} textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        <text x={4} y={10} className={styles.axisLabel}>
          days
        </text>
        {rows.map((r, i) => {
          const cx = pad.left + slot * i + slot / 2;
          const v = r.avgDays ?? 0;
          const top = y(v);
          return (
            <g key={r.priority}>
              {r.avgDays !== null && v > 0 && (
                <path
                  d={`M${cx - bw / 2},${y(0)} V${top + 4} q0,-4 4,-4 H${cx + bw / 2 - 4} q4,0 4,4 V${y(0)} Z`}
                  fill={PRIORITY_COLOR[r.priority]}
                >
                  <title>{`${PRIORITY_LABEL[r.priority]}: ${r.avgDays} days on average (${r.count} completed)`}</title>
                </path>
              )}
              <text x={cx} y={(r.avgDays !== null ? top : y(0)) - 6} textAnchor="middle" className={styles.abValue}>
                {r.avgDays === null ? '—' : `${r.avgDays}d`}
              </text>
              <text x={cx} y={H - pad.bottom + 18} textAnchor="middle" className={styles.abName}>
                {PRIORITY_LABEL[r.priority]}
              </text>
              <text x={cx} y={H - pad.bottom + 34} textAnchor="middle" className={styles.axisLabel}>
                n = {r.count}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
