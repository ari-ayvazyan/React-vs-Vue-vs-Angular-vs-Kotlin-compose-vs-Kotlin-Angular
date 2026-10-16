import type { Member, Task } from './types';

export const MEMBER_NAME_MAX = 60;

/** Preset avatar colours offered in the member editor. */
export const MEMBER_COLORS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#6366f1', '#ec4899', '#14b8a6', '#64748b'];

/** Up to two initials: first + last word ("Alex Kim" → "AK"), or the first two letters of a single word. */
export function memberInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...(words[0] as string)];
  if (words.length === 1) return first.slice(0, 2).join('').toUpperCase();
  const last = [...(words[words.length - 1] as string)];
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => channel(Number.parseInt(x as string, 16))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const DARK_TEXT = '#111827';
const LIGHT_TEXT = '#ffffff';

/** Text colour (white or near-black) with the higher contrast against `bg`. */
export function readableTextColor(bg: string): string {
  const l = relativeLuminance(bg);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastDark = (l + 0.05) / (relativeLuminance(DARK_TEXT) + 0.05);
  return contrastDark >= contrastWhite ? DARK_TEXT : LIGHT_TEXT;
}

/** Returns an error message, or '' when the name is acceptable. Names are unique (case-insensitive). */
export function validateMemberName(name: string, members: readonly Member[], exceptId?: string): string {
  const n = name.trim();
  if (!n) return 'Name is required.';
  if (n.length > MEMBER_NAME_MAX) return `Name must be at most ${MEMBER_NAME_MAX} characters.`;
  if (members.some((m) => m.id !== exceptId && m.name.trim().toLowerCase() === n.toLowerCase())) return 'A member with this name already exists.';
  return '';
}

/** Clear the assignee of every task assigned to `memberId` (unchanged tasks keep their identity). */
export function unassignMember(tasks: readonly Task[], memberId: string): Task[] {
  return tasks.map((t) => (t.assigneeId === memberId ? { ...t, assigneeId: null } : t));
}
