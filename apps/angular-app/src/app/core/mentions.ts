import { Member } from './models';

/**
 * Mentions are stored as `<@memberId>` tokens so they survive renames. While typing, the user sees
 * `@Full Name`; `encodeMentions` converts those to tokens on submit.
 */
const TOKEN = /<@([^<>\s]+)>/g;

export type BodySegment =
  { kind: 'text'; text: string } | { kind: 'mention'; id: string; name: string | null };

/** Replaces `@Full Name` (longest names first, case-insensitive, on a word boundary) with tokens. */
export function encodeMentions(text: string, members: readonly Member[]): string {
  const sorted = [...members].sort((a, b) => b.name.length - a.name.length);
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@' && (i === 0 || /\s|[(["']/.test(text[i - 1]))) {
      const rest = text.slice(i + 1);
      const hit = sorted.find((m) => {
        const n = m.name;
        if (rest.slice(0, n.length).toLocaleLowerCase() !== n.toLocaleLowerCase()) return false;
        const after = rest.charAt(n.length);
        return after === '' || !/[\p{L}\p{N}_]/u.test(after);
      });
      if (hit) {
        out += `<@${hit.id}>`;
        i += 1 + hit.name.length;
        continue;
      }
    }
    out += text[i++];
  }
  return out;
}

/** Splits a stored body into text and mention segments; unknown members get `name: null`. */
export function parseBody(body: string, members: ReadonlyMap<string, Member>): BodySegment[] {
  const out: BodySegment[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    if (m.index > last) out.push({ kind: 'text', text: body.slice(last, m.index) });
    out.push({ kind: 'mention', id: m[1], name: members.get(m[1])?.name ?? null });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}

/** Plain-text rendering (`@Name`) of a stored body, e.g. for the activity log. */
export function bodyToText(body: string, members: ReadonlyMap<string, Member>): string {
  return parseBody(body, members)
    .map((s) => (s.kind === 'text' ? s.text : `@${s.name ?? 'former member'}`))
    .join('');
}

export interface MentionQuery {
  /** Index of the `@` in the text. */
  start: number;
  query: string;
}

/**
 * The mention being typed at `caret`, if any: an `@` at the start or after whitespace, followed by
 * up to 40 characters without a newline or another `@`.
 */
export function activeMention(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s|[(["']/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query)) return null;
  return { start: at, query };
}

/** Members matching a mention query: name prefix matches first, then word-prefix matches. */
export function mentionCandidates(query: string, members: readonly Member[], max = 6): Member[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return members.slice(0, max);
  const starts: Member[] = [];
  const words: Member[] = [];
  for (const m of members) {
    const n = m.name.toLocaleLowerCase();
    if (n.startsWith(q)) starts.push(m);
    else if (n.split(/\s+/).some((w) => w.startsWith(q))) words.push(m);
  }
  return [...starts, ...words].slice(0, max);
}

/** Inserts `@Name ` in place of the active mention; returns the new text and caret position. */
export function insertMention(
  text: string,
  mention: MentionQuery,
  caret: number,
  member: Member,
): { text: string; caret: number } {
  const insert = `@${member.name} `;
  const next = text.slice(0, mention.start) + insert + text.slice(caret).replace(/^ /, '');
  return { text: next, caret: mention.start + insert.length };
}
