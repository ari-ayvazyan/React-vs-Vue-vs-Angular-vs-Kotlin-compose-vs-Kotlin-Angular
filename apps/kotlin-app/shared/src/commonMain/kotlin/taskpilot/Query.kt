package taskpilot

enum class DueFilter(val key: String, val label: String) {
    ALL("all", "Any time"),
    OVERDUE("overdue", "Overdue"),
    TODAY("today", "Today"),
    WEEK("week", "This week"),
    NONE("none", "No date"),
    ;

    companion object {
        fun fromKey(key: String?): DueFilter = entries.firstOrNull { it.key == key } ?: ALL
    }
}

enum class SortField(val key: String, val label: String) {
    DUE("due", "Due date"),
    PRIORITY("priority", "Priority"),
    CREATED("created", "Created"),
    TITLE("title", "Title"),
    ;

    companion object {
        fun fromKey(key: String?): SortField? = entries.firstOrNull { it.key == key }
    }
}

/** Special project filter value meaning "tasks without a project". */
const val NO_PROJECT = "none"

/** All list-view state; round-trips through the URL query string. */
data class TaskQuery(
    val search: String = "",
    val statuses: Set<Status> = emptySet(),
    val priorities: Set<Priority> = emptySet(),
    val project: String? = null,
    val tag: String? = null,
    val assignee: String? = null,
    val due: DueFilter = DueFilter.ALL,
    val sort: SortField = SortField.DUE,
    val ascending: Boolean = true,
    val page: Int = 1,
) {
    val hasFilters: Boolean
        get() =
            search.isNotBlank() || statuses.isNotEmpty() || priorities.isNotEmpty() ||
                project != null || tag != null || assignee != null || due != DueFilter.ALL

    /** Serialises non-default values in a stable order. */
    fun toParams(): List<Pair<String, String>> =
        buildList {
            if (search.isNotBlank()) add("q" to search)
            if (statuses.isNotEmpty()) add("status" to Status.entries.filter { it in statuses }.joinToString(",") { it.key })
            if (priorities.isNotEmpty()) add("priority" to Priority.entries.filter { it in priorities }.joinToString(",") { it.key })
            project?.let { add("project" to it) }
            tag?.let { add("tag" to it) }
            assignee?.let { add("assignee" to it) }
            if (due != DueFilter.ALL) add("due" to due.key)
            if (sort != SortField.DUE || !ascending) {
                add("sort" to sort.key)
                add("dir" to if (ascending) "asc" else "desc")
            }
            if (page > 1) add("page" to page.toString())
        }

    companion object {
        fun fromParams(params: Map<String, String>): TaskQuery {
            fun list(key: String) =
                params[key]
                    ?.split(',')
                    ?.map { it.trim() }
                    ?.filter { it.isNotEmpty() }
                    .orEmpty()
            return TaskQuery(
                search = params["q"].orEmpty(),
                statuses = list("status").mapNotNull { Status.fromKey(it) }.toSet(),
                priorities = list("priority").mapNotNull { Priority.fromKey(it) }.toSet(),
                project = params["project"]?.takeIf { it.isNotBlank() },
                tag = params["tag"]?.takeIf { it.isNotBlank() },
                assignee = params["assignee"]?.takeIf { it.isNotBlank() },
                due = DueFilter.fromKey(params["due"]),
                sort = SortField.fromKey(params["sort"]) ?: SortField.DUE,
                ascending = params["dir"] != "desc",
                page = params["page"]?.toIntOrNull()?.coerceAtLeast(1) ?: 1,
            )
        }
    }
}

fun Task.dueDay(): Int? = dueDate?.let { Dates.parse(it) }

fun Task.isOverdue(today: Int): Boolean {
    val d = dueDay() ?: return false
    return status != Status.DONE && d < today
}

/** Case-insensitive; every whitespace-separated term must appear in the title, description or a tag. */
fun Task.matchesSearch(search: String): Boolean {
    val terms =
        search
            .trim()
            .lowercase()
            .split(Regex("\\s+"))
            .filter { it.isNotEmpty() }
    if (terms.isEmpty()) return true
    val haystack =
        buildString {
            append(title.lowercase())
            append('\n')
            append(description.lowercase())
            tags.forEach {
                append('\n')
                append(it)
            }
        }
    return terms.all { haystack.contains(it) }
}

/** [assignee] null = any, [UNASSIGNED] = no assignee, otherwise a member id. */
fun Task.matchesAssignee(assignee: String?): Boolean =
    when (assignee) {
        null -> true
        UNASSIGNED -> assigneeId == null
        else -> assigneeId == assignee
    }

fun Task.matchesDue(due: DueFilter, today: Int): Boolean {
    val d = dueDay()
    return when (due) {
        DueFilter.ALL -> true
        DueFilter.NONE -> d == null
        DueFilter.OVERDUE -> isOverdue(today)
        DueFilter.TODAY -> d == today
        DueFilter.WEEK -> {
            val start = today - Dates.weekdayMonFirst(today)
            d != null && d in start..(start + 6)
        }
    }
}

/**
 * Applies [query]. With [projects] given, a project filter also matches tasks of its sub-projects
 * (any depth); without it only the exact project matches.
 */
fun filterTasks(tasks: List<Task>, query: TaskQuery, today: Int, projects: List<Project> = emptyList()): List<Task> {
    val projectIds =
        query.project?.takeIf { it != NO_PROJECT }?.let { if (projects.isEmpty()) setOf(it) else descendantIds(projects, it) }
    return tasks.filter { t ->
        (query.statuses.isEmpty() || t.status in query.statuses) &&
            (query.priorities.isEmpty() || t.priority in query.priorities) &&
            when (query.project) {
                null -> true
                NO_PROJECT -> t.projectId == null
                else -> projectIds?.contains(t.projectId) == true
            } &&
            (query.tag == null || query.tag in t.tags) &&
            t.matchesAssignee(query.assignee) &&
            t.matchesDue(query.due, today) &&
            t.matchesSearch(query.search)
    }
}

/** Sorts by the chosen field; tasks without a due date always go last. Ties fall back to creation time. */
fun sortTasks(tasks: List<Task>, field: SortField, ascending: Boolean): List<Task> {
    val tieBreak = compareBy<Task>({ it.createdAt }, { it.id })
    val primary: Comparator<Task> =
        when (field) {
            SortField.TITLE -> compareBy<Task, String>(String.CASE_INSENSITIVE_ORDER) { it.title }
            SortField.PRIORITY -> compareBy { it.priority.rank }
            SortField.CREATED -> compareBy { it.createdAt }
            SortField.DUE -> compareBy { it.dueDate ?: "" }
        }
    val directed = if (ascending) primary else primary.reversed()
    val withNulls: Comparator<Task> =
        if (field == SortField.DUE) {
            compareBy<Task> { it.dueDate == null }.then(directed)
        } else {
            directed
        }
    return tasks.sortedWith(withNulls.then(tieBreak))
}

data class Page<T>(val items: List<T>, val page: Int, val pageCount: Int, val total: Int)

fun <T> paginate(items: List<T>, page: Int, pageSize: Int): Page<T> {
    val size = pageSize.coerceAtLeast(1)
    val pageCount = maxOf(1, (items.size + size - 1) / size)
    val p = page.coerceIn(1, pageCount)
    val from = (p - 1) * size
    return Page(items.subList(from, minOf(items.size, from + size)), p, pageCount, items.size)
}

fun allTags(tasks: List<Task>): List<String> = tasks.flatMap { it.tags }.distinct().sorted()
