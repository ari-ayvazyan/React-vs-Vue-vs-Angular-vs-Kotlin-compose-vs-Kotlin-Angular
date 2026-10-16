'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { MEMBER_PALETTE, avatarTextColor, memberInitials, validateMemberName } from '@/lib/members';
import type { Member, Task } from '@/lib/types';
import { ColorPalettePicker, ColorSwatch } from '../ColorSwatch';
import { IconCheck, IconPencil, IconPlus, IconTrash, IconUsers, IconX } from '../icons';
import { dispatch, getStore } from '../store-hooks';
import { useToast } from '../toast';
import { newId } from '../ui';
import styles from './settings.module.css';

interface Counts {
  total: number;
  open: number;
}

function MemberRow({ member, members, counts }: { member: Member; members: Member[]; counts: Counts }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name);
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    setEditing(false);
    setName(member.name);
    setError(null);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const err = validateMemberName(name, members, member.id);
    setError(err);
    if (err) return;
    if (name.trim() !== member.name) {
      dispatch({ type: 'member/update', id: member.id, patch: { name: name.trim() } });
      toast('Member renamed', { undo: true, tone: 'success' });
    }
    setEditing(false);
  };
  const remove = () => {
    dispatch({ type: 'member/delete', id: member.id });
    toast(
      counts.total
        ? `Removed ${member.name} · ${counts.total} task${counts.total === 1 ? '' : 's'} unassigned`
        : `Removed ${member.name}`,
      { undo: true },
    );
  };

  return (
    <li className={styles.memberRow} data-testid="member-row">
      <ColorSwatch
        round
        color={member.color}
        label={`Colour for ${member.name}`}
        onCommit={(color) => dispatch({ type: 'member/update', id: member.id, patch: { color } })}
      >
        {(color) => (
          <span className={styles.memberInitials} style={{ color: avatarTextColor(color) }} aria-hidden="true">
            {memberInitials(member.name)}
          </span>
        )}
      </ColorSwatch>
      {editing ? (
        <form onSubmit={save} className={styles.memberRename} noValidate>
          <label htmlFor={`member-name-${member.id}`} className="sr-only">
            Name
          </label>
          <input
            id={`member-name-${member.id}`}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? `member-err-${member.id}` : undefined}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                cancel();
              }
            }}
          />
          <button type="submit" className="icon-btn" aria-label="Save name">
            <IconCheck />
          </button>
          <button type="button" className="icon-btn" aria-label="Cancel rename" onClick={cancel}>
            <IconX />
          </button>
          {error && (
            <p className={`error-text ${styles.memberError}`} id={`member-err-${member.id}`}>
              {error}
            </p>
          )}
        </form>
      ) : (
        <>
          <div className={styles.memberInfo}>
            <strong className={styles.memberName}>{member.name}</strong>
            <span className="muted">
              {counts.open} open · {counts.total} total
            </span>
          </div>
          <div className={styles.memberActions}>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              onClick={() => {
                setName(member.name);
                setEditing(true);
              }}
              aria-label={`Rename ${member.name}`}
            >
              <IconPencil size={15} />
            </button>
            <button type="button" className="icon-btn icon-btn-sm" onClick={remove} aria-label={`Delete ${member.name}`}>
              <IconTrash size={15} />
            </button>
          </div>
        </>
      )}
    </li>
  );
}

/** Settings → Team members: add, rename, recolor and delete (deleting unassigns their tasks). */
export function MembersSection({ members, tasks, currentUserId }: { members: Member[]; tasks: Task[]; currentUserId: string | null }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState(MEMBER_PALETTE[members.length % MEMBER_PALETTE.length]);
  const [error, setError] = useState<string | null>(null);

  const currentUser = members.find((m) => m.id === currentUserId);
  const counts = useMemo(() => {
    const map = new Map<string, Counts>();
    for (const t of tasks) {
      if (!t.assigneeId) continue;
      const c = map.get(t.assigneeId) ?? { total: 0, open: 0 };
      c.total++;
      if (t.category !== 'done') c.open++;
      map.set(t.assigneeId, c);
    }
    return map;
  }, [tasks]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const err = validateMemberName(name, members);
    setError(err);
    if (err) return;
    const member: Member = { id: newId('m'), name: name.trim(), color };
    dispatch({ type: 'member/create', member });
    toast(`Added ${member.name}`, { undo: true, tone: 'success' });
    setName('');
    setColor(MEMBER_PALETTE[(members.length + 1) % MEMBER_PALETTE.length]);
  };

  return (
    <section id="members" className={`card ${styles.section}`} aria-labelledby="members-title" data-testid="members-section">
      <div className={styles.sectionHead}>
        <h2 id="members-title" className="section-title">
          Team members
        </h2>
        <p className="muted">People you can assign tasks to. Click an avatar to change its colour. Deleting a member unassigns their tasks.</p>
      </div>

      <div className={`field ${styles.currentUser}`}>
        <label htmlFor="current-user" className="label">
          Current user
        </label>
        <select
          id="current-user"
          className="select"
          value={currentUser ? currentUser.id : ''}
          onChange={(e) => getStore().updateSettings({ currentUserId: e.target.value || null })}
          aria-describedby="current-user-hint"
          data-testid="current-user-select"
        >
          <option value="">Nobody (comments disabled)</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <p className="hint" id="current-user-hint">
          {currentUser ? `Comments and changes are recorded as ${currentUser.name}.` : 'Changes are recorded without an author until you pick someone.'}
        </p>
      </div>

      {members.length ? (
        <ul className={styles.members}>
          {members.map((m) => (
            <MemberRow key={m.id} member={m} members={members} counts={counts.get(m.id) ?? { total: 0, open: 0 }} />
          ))}
        </ul>
      ) : (
        <div className={`empty ${styles.membersEmpty}`}>
          <IconUsers size={26} />
          <strong>No team members yet</strong>
          <span>Add someone below to start assigning tasks.</span>
        </div>
      )}

      <form onSubmit={add} className={styles.memberAdd} noValidate aria-label="Add team member">
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="new-member-name" className="label">
            New member
          </label>
          <input
            id="new-member-name"
            className="input"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'new-member-error' : undefined}
            autoComplete="off"
            data-testid="member-name-input"
          />
          {error && (
            <p className="error-text" id="new-member-error">
              {error}
            </p>
          )}
        </div>
        <ColorPalettePicker value={color} onChange={setColor} palette={MEMBER_PALETTE} />
        <button type="submit" className={`btn btn-primary ${styles.memberAddBtn}`} data-testid="member-add-button">
          <IconPlus size={16} /> Add member
        </button>
      </form>
    </section>
  );
}
