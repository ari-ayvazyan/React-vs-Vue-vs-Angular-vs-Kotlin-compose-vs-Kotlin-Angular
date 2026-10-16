@file:OptIn(ExperimentalJsExport::class)

package taskpilot

/** A piece of rendered comment text; [memberId] is non-empty for a highlighted @mention. */
@JsExport
class CommentSegment(
    val text: String,
    val memberId: String,
)

/** An in-progress "@query" at the caret: the '@' index and the text typed after it. */
@JsExport
class MentionQuery(
    val start: Int,
    val query: String,
)

@JsExport
class MentionResult(
    val text: String,
    val caret: Int,
)

private const val MENTION_MAX = 40

/**
 * Splits a comment body into plain text and @mentions of known members (longest name wins, case-insensitive,
 * the name must end at a word boundary).
 */
@JsExport
fun renderComment(
    body: String,
    members: Array<Member>,
): Array<CommentSegment> {
    val byLength = members.sortedByDescending { it.name.length }
    val out = mutableListOf<CommentSegment>()
    val plain = StringBuilder()
    var i = 0
    while (i < body.length) {
        val c = body[i]
        val atBoundary = i == 0 || !body[i - 1].isLetterOrDigit()
        if (c == '@' && atBoundary) {
            val match =
                byLength.firstOrNull { m ->
                    val end = i + 1 + m.name.length
                    end <= body.length &&
                        body.regionMatches(i + 1, m.name, 0, m.name.length, ignoreCase = true) &&
                        (end == body.length || !body[end].isLetterOrDigit())
                }
            if (match != null) {
                if (plain.isNotEmpty()) out += CommentSegment(plain.toString(), "").also { plain.clear() }
                val end = i + 1 + match.name.length
                out += CommentSegment(body.substring(i, end), match.id)
                i = end
                continue
            }
        }
        plain.append(c)
        i++
    }
    if (plain.isNotEmpty()) out += CommentSegment(plain.toString(), "")
    return out.toTypedArray()
}

/** The mention being typed at [caret], or null (no '@' at a word start, newline in between, or too long). */
@JsExport
fun mentionAt(
    text: String,
    caret: Int,
): MentionQuery? {
    val end = caret.coerceIn(0, text.length)
    val at = text.lastIndexOf('@', end - 1)
    if (at < 0) return null
    if (at > 0 && text[at - 1].isLetterOrDigit()) return null
    val query = text.substring(at + 1, end)
    if (query.length > MENTION_MAX || '\n' in query || query.startsWith(" ")) return null
    return MentionQuery(at, query)
}

/** Members matching a mention query (prefix of the name or of any word first), max [limit]. */
@JsExport
fun mentionSuggestions(
    members: Array<Member>,
    query: String,
    limit: Int,
): Array<Member> {
    val q = query.lowercase()
    return members
        .filter { m ->
            val name = m.name.lowercase()
            name.startsWith(q) || name.split(" ").any { it.startsWith(q) }
        }.sortedWith(compareBy<Member> { !it.name.lowercase().startsWith(q) }.thenBy { it.name })
        .take(limit)
        .toTypedArray()
}

/** Replaces the mention query with "@Full Name " and returns the new text and caret position. */
@JsExport
fun applyMention(
    text: String,
    mention: MentionQuery,
    caret: Int,
    member: Member,
): MentionResult {
    val end = caret.coerceIn(mention.start, text.length)
    val insert = "@${member.name} "
    val next = text.substring(0, mention.start) + insert + text.substring(end)
    return MentionResult(next, mention.start + insert.length)
}

/** Validates a comment body; returns an error message or "". */
@JsExport
fun validateComment(body: String): String =
    when {
        body.isBlank() -> "Comment cannot be empty."
        body.length > Limits.COMMENT_MAX -> "Comment must be at most ${Limits.COMMENT_MAX} characters."
        else -> ""
    }
