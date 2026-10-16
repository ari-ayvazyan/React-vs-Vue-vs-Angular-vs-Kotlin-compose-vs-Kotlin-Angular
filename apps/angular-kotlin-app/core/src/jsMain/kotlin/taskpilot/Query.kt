@file:OptIn(ExperimentalJsExport::class)

package taskpilot

external fun encodeURIComponent(value: String): String

external fun decodeURIComponent(value: String): String

/** Due-date filter values. */
@JsExport
object DueFilter {
    const val ALL: String = "all"
    const val OVERDUE: String = "overdue"
    const val TODAY: String = "today"
    const val THIS_WEEK: String = "week"
    const val NO_DATE: String = "none"

    val all: Array<String> = arrayOf(ALL, OVERDUE, TODAY, THIS_WEEK, NO_DATE)

    fun label(value: String): String =
        when (value) {
            OVERDUE -> "Overdue"
            TODAY -> "Today"
            THIS_WEEK -> "This week"
            NO_DATE -> "No date"
            else -> "Any time"
        }
}

/** Sort keys. */
@JsExport
object SortKey {
    const val DUE: String = "due"
    const val PRIORITY: String = "priority"
    const val CREATED: String = "created"
    const val TITLE: String = "title"

    val all: Array<String> = arrayOf(DUE, PRIORITY, CREATED, TITLE)

    fun label(value: String): String =
        when (value) {
            DUE -> "Due date"
            PRIORITY -> "Priority"
            CREATED -> "Created"
            else -> "Title"
        }
}

/** Project filter sentinel meaning "tasks without a project". */
@JsExport
const val NO_PROJECT: String = "none"

/** Assignee filter sentinel meaning "unassigned tasks". */
@JsExport
const val UNASSIGNED: String = "none"

/**
 * Immutable task-list query (filters, search, sort, page). Serializes to / from the URL query string.
 * `projectId` is "" for all projects or [NO_PROJECT]; `assignee` is "" for everyone or [UNASSIGNED].
 */
@JsExport
class TaskQuery(
    val statuses: Array<String>,
    val priorities: Array<String>,
    val projectId: String,
    val tag: String,
    val due: String,
    val search: String,
    val sort: String,
    val dir: String,
    val page: Int,
    val assignee: String,
) {
    val isFiltered: Boolean
        get() =
            statuses.isNotEmpty() || priorities.isNotEmpty() || projectId.isNotEmpty() || tag.isNotEmpty() ||
                due != DueFilter.ALL || search.isNotBlank() || assignee.isNotEmpty()

    fun withStatusToggled(status: String): TaskQuery = copy(statuses = toggle(statuses, status, Status.all), page = 1)

    fun withPriorityToggled(priority: String): TaskQuery = copy(priorities = toggle(priorities, priority, Priority.all), page = 1)

    fun withProject(projectId: String): TaskQuery = copy(projectId = projectId, page = 1)

    fun withTag(tag: String): TaskQuery = copy(tag = tag, page = 1)

    fun withAssignee(assignee: String): TaskQuery = copy(assignee = assignee, page = 1)

    fun withDue(due: String): TaskQuery = copy(due = if (due in DueFilter.all) due else DueFilter.ALL, page = 1)

    fun withSearch(search: String): TaskQuery = copy(search = search, page = 1)

    /** Selecting the active key flips the direction; a new key starts with its natural direction. */
    fun withSort(sort: String): TaskQuery =
        if (sort == this.sort) {
            copy(dir = if (dir == "asc") "desc" else "asc", page = 1)
        } else {
            copy(sort = sort, dir = defaultDir(sort), page = 1)
        }

    fun withDir(dir: String): TaskQuery = copy(dir = if (dir == "desc") "desc" else "asc", page = 1)

    fun withPage(page: Int): TaskQuery = copy(page = page.coerceAtLeast(1))

    fun cleared(): TaskQuery = DEFAULT.copy(sort = sort, dir = dir)

    /** The part of the query a board can apply: everything except status (= columns), sort and page. */
    fun forBoard(): TaskQuery = copy(statuses = emptyArray(), sort = DEFAULT.sort, dir = DEFAULT.dir, page = 1)

    /** True when the board ignores something this query filters on (statuses) – shown as a hint in the UI. */
    val hasStatusFilter: Boolean get() = statuses.isNotEmpty()

    fun hasStatus(status: String): Boolean = status in statuses

    fun hasPriority(priority: String): Boolean = priority in priorities

    /** Query string without the leading "?" (empty when everything is default). */
    fun toQueryString(): String {
        val parts = mutableListOf<String>()

        fun add(
            key: String,
            value: String,
        ) {
            parts += "$key=${encodeURIComponent(value)}"
        }
        if (search.isNotEmpty()) add("q", search)
        if (statuses.isNotEmpty()) add("status", statuses.joinToString(","))
        if (priorities.isNotEmpty()) add("priority", priorities.joinToString(","))
        if (projectId.isNotEmpty()) add("project", projectId)
        if (tag.isNotEmpty()) add("tag", tag)
        if (assignee.isNotEmpty()) add("assignee", assignee)
        if (due != DueFilter.ALL) add("due", due)
        if (sort != DEFAULT.sort || dir != DEFAULT.dir) {
            add("sort", sort)
            add("dir", dir)
        }
        if (page > 1) add("page", page.toString())
        return parts.joinToString("&")
    }

    internal fun copy(
        statuses: Array<String> = this.statuses,
        priorities: Array<String> = this.priorities,
        projectId: String = this.projectId,
        tag: String = this.tag,
        due: String = this.due,
        search: String = this.search,
        sort: String = this.sort,
        dir: String = this.dir,
        page: Int = this.page,
        assignee: String = this.assignee,
    ): TaskQuery = TaskQuery(statuses, priorities, projectId, tag, due, search, sort, dir, page, assignee)

    companion object {
        val DEFAULT: TaskQuery =
            TaskQuery(emptyArray(), emptyArray(), "", "", DueFilter.ALL, "", SortKey.DUE, "asc", 1, "")

        fun defaultDir(sort: String): String = if (sort == SortKey.PRIORITY || sort == SortKey.CREATED) "desc" else "asc"

        private fun toggle(
            values: Array<String>,
            value: String,
            canonical: Array<String>,
        ): Array<String> {
            val set = values.toMutableSet()
            if (!set.add(value)) set.remove(value)
            return canonical.filter { it in set }.toTypedArray()
        }

        /** Parses a URL query string ("?a=b&c=d" or "a=b&c=d"); unknown or invalid values fall back to defaults. */
        fun parse(queryString: String): TaskQuery {
            val params = parseParams(queryString)

            fun list(
                key: String,
                allowed: Array<String>,
            ): Array<String> {
                val raw = params[key]?.split(",")?.map { it.trim() }?.toSet() ?: return emptyArray()
                return allowed.filter { it in raw }.toTypedArray()
            }
            val sort = params["sort"]?.takeIf { it in SortKey.all } ?: DEFAULT.sort
            val dir = params["dir"]?.takeIf { it == "asc" || it == "desc" } ?: defaultDir(sort)
            return TaskQuery(
                statuses = list("status", Status.all),
                priorities = list("priority", Priority.all),
                projectId = params["project"].orEmpty(),
                tag = params["tag"].orEmpty().lowercase(),
                due = params["due"]?.takeIf { it in DueFilter.all } ?: DueFilter.ALL,
                search = params["q"].orEmpty(),
                sort = sort,
                dir = dir,
                page = params["page"]?.toIntOrNull()?.coerceAtLeast(1) ?: 1,
                assignee = params["assignee"].orEmpty(),
            )
        }
    }
}

/** Parses a query string into a map (last value wins). */
internal fun parseParams(queryString: String): Map<String, String> {
    val q = queryString.removePrefix("?")
    if (q.isEmpty()) return emptyMap()
    return q
        .split("&")
        .filter { it.isNotEmpty() }
        .associate { part ->
            val idx = part.indexOf('=')
            val key = if (idx < 0) part else part.substring(0, idx)
            val value = if (idx < 0) "" else part.substring(idx + 1)
            safeDecode(key) to safeDecode(value.replace('+', ' '))
        }
}

private fun safeDecode(value: String): String =
    try {
        decodeURIComponent(value)
    } catch (_: Throwable) {
        value
    }

/** Reads the `?seed=N` benchmark hook; returns null when absent or invalid. */
@JsExport
fun readSeedParam(queryString: String): Int? =
    parseParams(queryString)["seed"]
        ?.toIntOrNull()
        ?.takeIf { it in 0..100_000 }

/** Splits a search string into lowercase terms. */
internal fun searchTerms(search: String): List<String> =
    search
        .lowercase()
        .split(Regex("\\s+"))
        .filter { it.isNotEmpty() }

/** True if every term occurs in the task's title, description or tags (case-insensitive). */
internal fun matchesSearch(
    task: Task,
    terms: List<String>,
): Boolean {
    if (terms.isEmpty()) return true
    val haystack = (task.title + "\n" + task.description + "\n" + task.tags.joinToString(" ")).lowercase()
    return terms.all { haystack.contains(it) }
}

internal fun isOverdue(
    task: Task,
    today: Int,
): Boolean {
    val due = parseDay(task.dueDate) ?: return false
    return !task.isDone && due < today
}

internal fun matchesDue(
    task: Task,
    due: String,
    today: Int,
): Boolean {
    val day = parseDay(task.dueDate)
    return when (due) {
        DueFilter.OVERDUE -> isOverdue(task, today)
        DueFilter.TODAY -> day == today
        DueFilter.THIS_WEEK -> {
            val weekStart = today - CivilDate.weekdayMonFirst(today)
            day != null && day in weekStart..(weekStart + 6)
        }
        DueFilter.NO_DATE -> day == null
        else -> true
    }
}

/**
 * Applies every filter of [query] (not sort / pagination). Status filters match the status *category*;
 * a project filter includes the project's sub-projects.
 */
internal fun filterTasks(
    state: AppState,
    query: TaskQuery,
    today: Int,
    tasks: Array<Task> = state.tasks,
): List<Task> {
    val terms = searchTerms(query.search)
    val project = ProjectMatcher(state, query.projectId)
    return tasks.filter { t ->
        (query.statuses.isEmpty() || t.category in query.statuses) &&
            (query.priorities.isEmpty() || t.priority in query.priorities) &&
            project.matches(t) &&
            (query.tag.isEmpty() || query.tag in t.tags) &&
            matchesAssignee(t, query.assignee) &&
            matchesDue(t, query.due, today) &&
            matchesSearch(t, terms)
    }
}

/** Stable sort; tasks without a due date always sort last. Ties fall back to creation order. */
internal fun sortTasks(
    tasks: List<Task>,
    sort: String,
    dir: String,
): List<Task> {
    val sign = if (dir == "desc") -1 else 1
    val comparator: Comparator<Task> =
        when (sort) {
            SortKey.PRIORITY -> compareBy<Task> { sign * Priority.rank(it.priority) }
            SortKey.CREATED -> Comparator { a, b -> sign * a.createdAt.compareTo(b.createdAt) }
            SortKey.TITLE -> Comparator { a, b -> sign * a.title.lowercase().compareTo(b.title.lowercase()) }
            else ->
                Comparator { a, b ->
                    val da = parseDay(a.dueDate)
                    val db = parseDay(b.dueDate)
                    when {
                        da == null && db == null -> 0
                        da == null -> 1
                        db == null -> -1
                        else -> sign * da.compareTo(db)
                    }
                }
        }
    return tasks.sortedWith(comparator.then(compareBy { it.createdAt }))
}

@JsExport
class TaskPage(
    val items: Array<Task>,
    val total: Int,
    val page: Int,
    val pageCount: Int,
    val pageSize: Int,
) {
    val from: Int get() = if (total == 0) 0 else (page - 1) * pageSize + 1
    val to: Int get() = (from + items.size - 1).coerceAtLeast(0)
}

/** Filters, sorts and paginates. The page is clamped into range. */
@JsExport
fun queryTasks(
    state: AppState,
    query: TaskQuery,
    today: String,
    pageSize: Int,
): TaskPage {
    val day = parseDay(today) ?: Clock.today()
    val size = pageSize.coerceAtLeast(1)
    val sorted = sortTasks(filterTasks(state, query, day), query.sort, query.dir)
    val pageCount = ((sorted.size + size - 1) / size).coerceAtLeast(1)
    val page = query.page.coerceIn(1, pageCount)
    val items = sorted.drop((page - 1) * size).take(size).toTypedArray()
    return TaskPage(items, sorted.size, page, pageCount, size)
}

/** True when the task is not done and its due date lies before [today]. */
@JsExport
fun isTaskOverdue(
    task: Task,
    today: String,
): Boolean = isOverdue(task, parseDay(today) ?: Clock.today())
