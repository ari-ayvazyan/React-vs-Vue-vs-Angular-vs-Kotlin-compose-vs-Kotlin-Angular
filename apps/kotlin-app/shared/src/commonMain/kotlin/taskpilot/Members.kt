package taskpilot

import kotlin.math.pow

/** Special assignee filter value meaning "tasks without an assignee". */
const val UNASSIGNED = "none"

/** Up to two initials: first letters of the first and last word, or the first two letters of a single word. */
fun initials(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    return when {
        words.isEmpty() -> "?"
        words.size == 1 -> words[0].take(2).uppercase()
        else -> (words.first().take(1) + words.last().take(1)).uppercase()
    }
}

/** Black or white text, whichever contrasts better with the hex background (WCAG relative luminance). */
fun readableTextColor(hex: String): String {
    val h = hex.removePrefix("#")
    if (h.length != 6) return "#ffffff"

    fun channel(i: Int): Double {
        val c = (h.substring(i, i + 2).toIntOrNull(16) ?: 0) / 255.0
        return if (c <= 0.03928) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
    }
    val lum = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
    val contrastWhite = 1.05 / (lum + 0.05)
    val contrastBlack = (lum + 0.05) / 0.05
    return if (contrastBlack >= contrastWhite) "#111827" else "#ffffff"
}

/** Returns an error message for an invalid member name, or null when it is acceptable. */
fun validateMemberName(name: String, members: List<Member>, editingId: String? = null): String? {
    val n = name.trim()
    return when {
        n.isEmpty() -> "Name is required."
        n.length > Limits.MEMBER_NAME_MAX -> "Name must be at most ${Limits.MEMBER_NAME_MAX} characters."
        members.any { it.id != editingId && it.name.equals(n, ignoreCase = true) } -> "A member with this name already exists."
        else -> null
    }
}

/** Removes a member and unassigns their tasks. */
fun removeMember(tasks: List<Task>, members: List<Member>, id: String): Pair<List<Task>, List<Member>> =
    tasks.map { if (it.assigneeId == id) it.copy(assigneeId = null) else it } to members.filterNot { it.id == id }
