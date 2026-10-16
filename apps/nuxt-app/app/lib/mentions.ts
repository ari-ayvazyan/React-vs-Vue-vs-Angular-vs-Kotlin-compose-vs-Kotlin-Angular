import type { Member } from './types';

/**
 * Mentions are typed as `@Full Name` and stored as `@[memberId]` tokens, so a later rename of the member
 * is reflected in old comments. Rendering resolves tokens back to the current name.
 */
const TOKEN = /@\[([^\]\s]+)\]/g;

export const COMMENT_MAX = 2000;

export type CommentSegment = { kind: 'text'; text: string } | { kind: 'mention'; memberId: string; name: string | null };

/** Replace `@Name` (longest names first, case-insensitive, whole name) with `@[id]` tokens. */
export function encodeMentions(text: string, members: readonly Member[]): string {
  const sorted = [...members].filter((m) => m.name.trim()).sort((a, b) => b.name.length - a.name.length);
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@' && (i === 0 || /\s|[([{"'“]/.test(text[i - 1] as string))) {
      const rest = text.slice(i + 1);
      const hit = sorted.find((m) => {
        const n = m.name.trim();
        if (rest.slice(0, n.length).toLowerCase() !== n.toLowerCase()) return false;
        const after = rest[n.length];
        return after === undefined || !/[\p{L}\p{N}_]/u.test(after);
      });
      if (hit) {
        out += `@[${hit.id}]`;
        i += 1 + hit.name.trim().length;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

/** Split a stored body into text and mention segments (unknown ids yield `name: null`). */
export function parseComment(body: string, members: readonly Member[]): CommentSegment[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const out: CommentSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: 'text', text: body.slice(last, start) });
    const id = m[1] as string;
    out.push({ kind: 'mention', memberId: id, name: byId.get(id)?.name ?? null });
    last = start + m[0].length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}

/** Plain-text rendering of a stored body (mentions as `@Name`). */
export function commentToText(body: string, members: readonly Member[]): string {
  return parseComment(body, members)
    .map((s) => (s.kind === 'text' ? s.text : `@${s.name ?? 'unknown'}`))
    .join('');
}

/** Ids of members mentioned in a stored body. */
export function mentionedIds(body: string): string[] {
  return [...new Set([...body.matchAll(TOKEN)].map((m) => m[1] as string))];
}

export interface MentionQuery {
  /** index of the '@' */
  start: number;
  /** text typed after the '@' up to the caret */
  query: string;
}

/**
 * The mention being typed at `caret`, if any: an '@' at the start or after whitespace, followed by at most
 * 30 characters without a line break. Names contain spaces, so spaces are allowed in the query.
 */
export function activeMention(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s|[([{"'“]/.test(before[at - 1] as string)) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || /[\n@]/.test(query) || /^\s/.test(query)) return null;
  return { start: at, query };
}

/** Members matching a mention query: prefix of the name or of any word first, then substring matches. */
export function matchMembers(members: readonly Member[], query: string, limit = 6): Member[] {
  const q = query.trim().toLowerCase();
  if (!q) return members.slice(0, limit);
  const score = (m: Member): number => {
    const n = m.name.toLowerCase();
    if (n.startsWith(q)) return 0;
    if (n.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    return n.includes(q) ? 2 : 3;
  };
  return members
    .map((m) => ({ m, s: score(m) }))
    .filter((x) => x.s < 3)
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map((x) => x.m);
}

/** Replace the active mention with `@Name ` and return the new text and caret position. */
export function insertMention(text: string, mention: MentionQuery, caret: number, member: Member): { text: string; caret: number } {
  const insert = `@${member.name.trim()} `;
  const next = text.slice(0, mention.start) + insert + text.slice(caret).replace(/^ /, '');
  return { text: next, caret: mention.start + insert.length };
}
