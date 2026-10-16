@file:OptIn(ExperimentalJsExport::class)

package taskpilot

/** A named task-list query (filters, search and sort) shown in the sidebar under "Views". */
@JsExport
class SavedView(
    val id: String,
    val name: String,
    /** Canonical [TaskQuery] query string without the page, e.g. "q=api&priority=high". */
    val query: String,
    val createdAt: String,
) {
    /** The view's list query. */
    fun toTaskQuery(): TaskQuery = TaskQuery.parse(query)

    /** Query string for opening the view on the board (only the filters a board can apply). */
    fun boardQueryString(): String = toTaskQuery().forBoard().toQueryString()

    /** True when the board would ignore part of this view (its status filter). */
    val boardIgnoresStatus: Boolean get() = toTaskQuery().hasStatusFilter

    /** One-line description of what the view filters, e.g. "High, Urgent · #bug · “api”". */
    val summary: String get() = describeQuery(toTaskQuery())

    internal fun renamed(name: String): SavedView = SavedView(id, name, query, createdAt)
}

private const val VIEW_NAME_MAX = 40

/** Validates a view name (required, max 40, unique ignoring case); returns an error message or "". */
@JsExport
fun validateViewName(
    views: Array<SavedView>,
    name: String,
    exceptId: String?,
): String {
    val n = name.trim()
    return when {
        n.isEmpty() -> "Name is required."
        n.length > VIEW_NAME_MAX -> "Name must be at most $VIEW_NAME_MAX characters."
        views.any { it.id != exceptId && it.name.equals(n, ignoreCase = true) } -> "A view named “$n” already exists."
        else -> ""
    }
}

/** The saved view whose query equals the current list query (ignoring the page), or null. */
@JsExport
fun activeView(
    views: Array<SavedView>,
    currentQueryString: String,
): SavedView? {
    val current = TaskQuery.parse(currentQueryString).withPage(1).toQueryString()
    // Compare canonical forms so equivalent query strings (parameter order, default values) match.
    return views.firstOrNull { it.toTaskQuery().withPage(1).toQueryString() == current }
}

/** Human-readable summary of a query's filters (e.g. for the board's "filtered by" bar). */
@JsExport
fun describeTaskQuery(query: TaskQuery): String = describeQuery(query)

/** Human-readable summary of a query's filters, used as the view subtitle. */
internal fun describeQuery(q: TaskQuery): String {
    val parts = mutableListOf<String>()
    if (q.statuses.isNotEmpty()) parts += q.statuses.joinToString(", ") { Status.label(it) }
    if (q.priorities.isNotEmpty()) parts += q.priorities.joinToString(", ") { Priority.label(it) }
    if (q.projectId == NO_PROJECT) {
        parts += "No project"
    } else if (q.projectId.isNotEmpty()) {
        parts += "Project"
    }
    if (q.assignee == UNASSIGNED) {
        parts += "Unassigned"
    } else if (q.assignee.isNotEmpty()) {
        parts += "Assignee"
    }
    if (q.tag.isNotEmpty()) parts += "#${q.tag}"
    if (q.due != DueFilter.ALL) parts += DueFilter.label(q.due)
    if (q.search.isNotBlank()) parts += "“${q.search.trim()}”"
    if (q.sort != TaskQuery.DEFAULT.sort || q.dir != TaskQuery.DEFAULT.dir) {
        parts += "by ${SortKey.label(q.sort).lowercase()} ${if (q.dir == "asc") "↑" else "↓"}"
    }
    return if (parts.isEmpty()) "All tasks" else parts.joinToString(" · ")
}
