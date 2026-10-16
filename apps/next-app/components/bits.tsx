'use client';

import { relativeDue } from '@/lib/dates';
import { avatarTextColor, memberInitials } from '@/lib/members';
import { PRIORITY_LABEL, RECURRENCE_LABEL, type Member, type Priority, type Project, type Recurrence } from '@/lib/types';
import styles from './bits.module.css';
import { IconLock, IconRepeat } from './icons';

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`badge prio-${priority}`}>
      <span className={styles.prioDot} aria-hidden="true" />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function ProjectChip({ project }: { project: Project | undefined | null }) {
  if (!project) return <span className={`${styles.project} ${styles.noProject}`}>No project</span>;
  return (
    <span className={styles.project} title={project.name}>
      <span className="dot" style={{ background: project.color }} aria-hidden="true" />
      <span className={styles.projectName}>{project.name}</span>
    </span>
  );
}

export function DueLabel({ due, today, done }: { due: string | null; today: string; done?: boolean }) {
  if (!due) return <span className="muted">—</span>;
  const overdue = !done && due < today;
  return (
    <time dateTime={due} className={overdue ? 'overdue-text' : due === today && !done ? styles.dueToday : undefined}>
      {relativeDue(due, today)}
    </time>
  );
}

/** Generic loading placeholder shown during SSR / before localStorage is read. */
export function PageSkeleton({ title, rows = 6 }: { title: string; rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">Loading your workspace…</p>
        </div>
      </div>
      <div className={styles.skeletonGrid}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: i < 3 ? 92 : 56 }} />
        ))}
      </div>
    </div>
  );
}

export function Avatar({ member, size = 22 }: { member: Member; size?: number }) {
  return (
    <span
      className={styles.avatar}
      style={{ background: member.color, color: avatarTextColor(member.color), width: size, height: size, fontSize: Math.round(size * 0.42) }}
      title={member.name}
      aria-hidden="true"
    >
      {memberInitials(member.name)}
    </span>
  );
}

/** Avatar plus an accessible "Assigned to …" label; renders nothing when unassigned unless `showUnassigned`. */
export function AssigneeChip({ member, withName, showUnassigned, size }: { member: Member | undefined | null; withName?: boolean; showUnassigned?: boolean; size?: number }) {
  if (!member) {
    if (!showUnassigned) return null;
    return <span className={`${styles.assignee} ${styles.unassigned}`}>Unassigned</span>;
  }
  return (
    <span className={styles.assignee}>
      <Avatar member={member} size={size} />
      {withName ? <span className={styles.assigneeName}>{member.name}</span> : <span className="sr-only">Assigned to {member.name}</span>}
    </span>
  );
}

export function RecurrenceIcon({ recurrence, size = 13 }: { recurrence: Recurrence; size?: number }) {
  if (recurrence === 'none') return null;
  const label = `Repeats ${RECURRENCE_LABEL[recurrence].toLowerCase()}`;
  return (
    <span className={styles.recurrence} title={label}>
      <IconRepeat size={size} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** "Blocked" pill for open tasks waiting on other tasks; `blockers` names them in the tooltip. */
export function BlockedBadge({ blockers }: { blockers: { title: string }[] }) {
  if (!blockers.length) return null;
  const names = blockers.map((b) => `“${b.title}”`).join(', ');
  return (
    <span className={styles.blocked} title={`Blocked by ${names}`} data-testid="blocked-badge">
      <IconLock size={11} />
      Blocked
      <span className="sr-only"> by {names}</span>
    </span>
  );
}
