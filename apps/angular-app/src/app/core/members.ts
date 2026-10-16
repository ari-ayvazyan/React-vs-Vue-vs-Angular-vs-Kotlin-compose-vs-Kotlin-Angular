import { Member } from './models';

export const MEMBER_NAME_MAX = 60;

/**
 * Initials for an avatar: first letter of the first and last word ("Alex Kim" -> "AK"),
 * or the first letter of a single-word name ("Cher" -> "C"). Unicode-aware.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const firstChar = (w: string) => Array.from(w)[0] ?? '';
  const out =
    words.length === 1 ? firstChar(words[0]) : firstChar(words[0]) + firstChar(words.at(-1)!);
  return out.toLocaleUpperCase();
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export const AVATAR_TEXT_DARK = '#111827';
export const AVATAR_TEXT_LIGHT = '#ffffff';

/** Picks dark or white text, whichever contrasts more with the avatar background. */
export function avatarTextColor(bg: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(bg)) return AVATAR_TEXT_LIGHT;
  const l = luminance(bg);
  const vsWhite = 1.05 / (l + 0.05);
  const vsDark = (l + 0.05) / (luminance(AVATAR_TEXT_DARK) + 0.05);
  return vsDark > vsWhite ? AVATAR_TEXT_DARK : AVATAR_TEXT_LIGHT;
}

/** Returns an error message, or '' if the name is valid. Names are unique (case-insensitive). */
export function validateMemberName(
  name: string,
  members: readonly Member[],
  exceptId: string | null = null,
): string {
  const n = name.trim();
  if (!n) return 'Name is required.';
  if (n.length > MEMBER_NAME_MAX) return `Name must be at most ${MEMBER_NAME_MAX} characters.`;
  const lower = n.toLocaleLowerCase();
  if (members.some((m) => m.id !== exceptId && m.name.toLocaleLowerCase() === lower))
    return 'A member with this name already exists.';
  return '';
}
