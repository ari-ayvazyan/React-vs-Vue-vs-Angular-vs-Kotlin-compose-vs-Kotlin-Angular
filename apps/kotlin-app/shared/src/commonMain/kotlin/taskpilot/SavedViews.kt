package taskpilot

import kotlinx.serialization.Serializable

/** A named task-list query. [params] are the URL parameters of the filters, search and sort (never the page). */
@Serializable
data class SavedView(
    val id: String,
    val name: String,
    val params: Map<String, String>,
    val createdAt: String,
) {
    val query: TaskQuery get() = TaskQuery.fromParams(params)
}

const val VIEW_NAME_MAX = 40

/** URL parameter marking which saved view the list was opened from. */
const val VIEW_PARAM = "view"

/** The parameters stored for [query]: everything except the page. */
fun viewParams(query: TaskQuery): Map<String, String> = query.copy(page = 1).toParams().toMap()

fun validateViewName(name: String, views: List<SavedView>, editingId: String? = null): String? {
    val n = name.trim()
    return when {
        n.isEmpty() -> "Name is required."
        n.length > VIEW_NAME_MAX -> "Name must be at most $VIEW_NAME_MAX characters."
        views.any { it.id != editingId && it.name.equals(n, ignoreCase = true) } -> "A view with this name already exists."
        else -> null
    }
}

/** URL of the task list for [view]. */
fun listUrlParams(view: SavedView): List<Pair<String, String>> = view.query.toParams() + (VIEW_PARAM to view.id)

/**
 * Board parameters for [view]: the board's columns are the statuses and it has no sort or
 * pagination, so only the status filter, sort and page are dropped.
 */
fun boardQuery(query: TaskQuery): TaskQuery = query.copy(statuses = emptySet(), sort = SortField.DUE, ascending = true, page = 1)

fun boardUrlParams(view: SavedView): List<Pair<String, String>> = boardQuery(view.query).toParams() + (VIEW_PARAM to view.id)

/** Describes the parts of [query] that the board does not apply (shown as a hint). */
fun boardIgnoredParts(query: TaskQuery): List<String> =
    buildList {
        if (query.statuses.isNotEmpty()) add("status filter (columns show every status)")
        if (query.sort != SortField.DUE || !query.ascending) add("sort order (cards keep their board order)")
    }

/** The saved view whose filters equal [query] (ignoring the page), if any. */
fun matchingView(views: List<SavedView>, query: TaskQuery): SavedView? {
    val p = viewParams(query)
    return views.firstOrNull { it.params == p }
}
