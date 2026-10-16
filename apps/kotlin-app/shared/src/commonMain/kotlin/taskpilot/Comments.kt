package taskpilot

const val COMMENT_MAX = 2000

/** A piece of a comment body: plain text or a mention of [member]. */
data class CommentSegment(val text: String, val member: Member? = null)

/**
 * Splits [body] into text and `@Member Name` mention segments. Longer names win so that
 * "@Sam Rivera" is not matched as "@Sam" when both members exist. Matching is case-insensitive
 * and requires a non-letter (or the end) after the name.
 */
fun parseMentions(body: String, members: List<Member>): List<CommentSegment> {
    if (members.isEmpty() || '@' !in body) return listOf(CommentSegment(body))
    val sorted = members.sortedByDescending { it.name.length }
    val out = mutableListOf<CommentSegment>()
    val text = StringBuilder()
    var i = 0
    while (i < body.length) {
        val c = body[i]
        val boundaryBefore = i == 0 || !body[i - 1].isLetterOrDigit()
        val match =
            if (c == '@' && boundaryBefore) {
                sorted.firstOrNull { m ->
                    val end = i + 1 + m.name.length
                    end <= body.length && body.regionMatches(i + 1, m.name, 0, m.name.length, ignoreCase = true) &&
                        (end == body.length || !body[end].isLetterOrDigit())
                }
            } else {
                null
            }
        if (match != null) {
            if (text.isNotEmpty()) out += CommentSegment(text.toString()).also { text.clear() }
            out += CommentSegment(body.substring(i, i + 1 + match.name.length), match)
            i += 1 + match.name.length
        } else {
            text.append(c)
            i++
        }
    }
    if (text.isNotEmpty()) out += CommentSegment(text.toString())
    return out
}

/** Ids of the members mentioned in [body]. */
fun mentionedMemberIds(body: String, members: List<Member>): Set<String> =
    parseMentions(body, members).mapNotNull { it.member?.id }.toSet()

/** An in-progress `@query` right before the caret: [start] is the index of '@'. */
data class MentionQuery(val start: Int, val query: String)

/** Finds the `@…` token the caret is in (no line breaks, at most 30 chars), or null. */
fun mentionQueryAt(text: String, caret: Int): MentionQuery? {
    val end = caret.coerceIn(0, text.length)
    var i = end - 1
    while (i >= 0 && end - i <= 31) {
        val c = text[i]
        if (c == '\n') return null
        if (c == '@') {
            if (i > 0 && text[i - 1].isLetterOrDigit()) return null
            val q = text.substring(i + 1, end)
            if (q.startsWith(" ") || q.contains("  ")) return null
            return MentionQuery(i, q)
        }
        i--
    }
    return null
}

/** Members matching a mention query: name or any word in it starts with the query (case-insensitive). */
fun mentionCandidates(query: String, members: List<Member>, limit: Int = 6): List<Member> {
    val q = query.trim().lowercase()
    return members
        .filter { m ->
            val n = m.name.lowercase()
            q.isEmpty() || n.startsWith(q) || n.split(' ').any { it.startsWith(q) }
        }.sortedWith(compareBy<Member>({ !it.name.lowercase().startsWith(q) }, { it.name }))
        .take(limit)
}

/** Replaces the active `@query` with `@Name ` and returns the new text plus caret position. */
fun applyMention(text: String, query: MentionQuery, member: Member, caret: Int): Pair<String, Int> {
    val end = caret.coerceIn(query.start, text.length)
    val insert = "@${member.name} "
    val next = text.substring(0, query.start) + insert + text.substring(end).trimStartSingleSpace()
    return next to query.start + insert.length
}

private fun String.trimStartSingleSpace(): String = if (startsWith(" ")) substring(1) else this

fun validateComment(body: String): String? =
    when {
        body.isBlank() -> "Write something first."
        body.length > COMMENT_MAX -> "Comments can be at most $COMMENT_MAX characters (currently ${body.length})."
        else -> null
    }
