import type { Member } from './types';

/**
 * Comment bodies store mentions as `@{memberId}` tokens so they survive renames. While typing,
 * the user sees and edits `@Full Name`; `encodeMentions` converts on submit and `parseMentions`
 * splits a stored body into text and mention parts for rendering.
 */

export const COMMENT_MAX = 2000;

const TOKEN_RE = /@\{([^{}\s]+)\}/g;

export type MentionPart = { kind: 'text'; text: string } | { kind: 'mention'; memberId: string };

export function parseMentions(body: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    if (m.index > last) parts.push({ kind: 'text', text: body.slice(last, m.index) });
    parts.push({ kind: 'mention', memberId: m[1] });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ kind: 'text', text: body.slice(last) });
  return parts;
}

/** Ids of members mentioned in a stored body (unique, in order). */
export function mentionedIds(body: string): string[] {
  return [...new Set(parseMentions(body).flatMap((p) => (p.kind === 'mention' ? [p.memberId] : [])))];
}

/**
 * Replaces `@Full Name` (case-insensitive, longest name wins, must start the text or follow
 * whitespace/punctuation, and end at a word boundary) with `@{id}`.
 */
export function encodeMentions(text: string, members: Member[]): string {
  if (!members.length || !text.includes('@')) return text;
  const byLength = [...members].sort((a, b) => b.name.length - a.name.length);
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : '';
    if (ch === '@' && (i === 0 || /[\s([{"'“‘,;]/.test(prev))) {
      const rest = text.slice(i + 1).toLowerCase();
      const hit = byLength.find((m) => {
        const n = m.name.toLowerCase();
        if (!rest.startsWith(n)) return false;
        const after = rest.charAt(n.length);
        return after === '' || !/[\p{L}\p{N}_]/u.test(after);
      });
      if (hit) {
        out += `@{${hit.id}}`;
        i += 1 + hit.name.length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** Turns stored tokens back into `@Full Name` (for editing or plain-text contexts). */
export function decodeMentions(body: string, members: Member[]): string {
  const names = new Map(members.map((m) => [m.id, m.name]));
  return parseMentions(body)
    .map((p) => (p.kind === 'text' ? p.text : `@${names.get(p.memberId) ?? 'unknown'}`))
    .join('');
}

export interface MentionQuery {
  /** index of the `@` that starts the query */
  start: number;
  /** text typed after `@` up to the caret */
  query: string;
}

/** The mention being typed at `caret`, if any: an `@` at a word start followed by ≤ 30 chars on one line. */
export function activeMention(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/[\s([{"'“‘,;]/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || /[\n@]/.test(query) || /\s{2}/.test(query) || query.startsWith(' ')) return null;
  return { start: at, query };
}

/** Members matching a partial name: full-name prefix first, then word prefixes. */
export function matchMembers(members: Member[], query: string, limit = 6): Member[] {
  const q = query.trim().toLowerCase();
  if (!q) return members.slice(0, limit);
  const prefix: Member[] = [];
  const word: Member[] = [];
  for (const m of members) {
    const n = m.name.toLowerCase();
    if (n.startsWith(q)) prefix.push(m);
    else if (n.split(/\s+/).some((w) => w.startsWith(q))) word.push(m);
  }
  return [...prefix, ...word].slice(0, limit);
}
