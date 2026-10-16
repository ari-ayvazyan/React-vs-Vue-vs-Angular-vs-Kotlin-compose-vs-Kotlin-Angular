import type { Member, Task } from './types';

export const MEMBER_NAME_MAX = 60;

/** Default colours offered when adding a member. */
export const MEMBER_PALETTE = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#14b8a6', '#eab308', '#ec4899', '#64748b'];

/** Special assignee filter value for tasks without an assignee. */
export const NO_ASSIGNEE = 'none';

/** "Alex Kim" → "AK", "Taylor Anne Brooks" → "TB", "Cher" → "CH", "" → "?". */
export function memberInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = Array.from(words[0]);
  if (words.length === 1) return first.slice(0, 2).join('').toUpperCase();
  return (first[0] + Array.from(words[words.length - 1])[0]).toUpperCase();
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export const AVATAR_TEXT_LIGHT = '#ffffff';
export const AVATAR_TEXT_DARK = '#0f172a';

/** Picks white or near-black initials, whichever has the higher contrast on `bg`. */
export function avatarTextColor(bg: string): string {
  const l = luminance(bg);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (luminance(AVATAR_TEXT_DARK) + 0.05);
  return onWhite >= onDark ? AVATAR_TEXT_LIGHT : AVATAR_TEXT_DARK;
}

export function validateMemberName(name: string, members: Member[], exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Name is required.';
  if (n.length > MEMBER_NAME_MAX) return `Name must be at most ${MEMBER_NAME_MAX} characters.`;
  if (members.some((m) => m.id !== exceptId && m.name.toLowerCase() === n.toLowerCase())) return 'A member with this name already exists.';
  return null;
}

/** `filter` is null (everyone), NO_ASSIGNEE, or a member id. */
export function matchesAssignee(task: Task, filter: string | null): boolean {
  if (!filter) return true;
  return filter === NO_ASSIGNEE ? task.assigneeId === null : task.assigneeId === filter;
}
