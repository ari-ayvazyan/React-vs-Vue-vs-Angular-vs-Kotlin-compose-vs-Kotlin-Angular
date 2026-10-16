@file:OptIn(ExperimentalJsExport::class)

package taskpilot

/**
 * One activity-log entry. `from` / `to` hold human-readable values captured at the time of the change
 * (names rather than ids), so the log stays meaningful after projects / members / tasks are deleted.
 */
@JsExport
class ActivityEntry(
    val id: String,
    val taskId: String,
    val actorId: String,
    val type: String,
    val field: String?,
    val from: String?,
    val to: String?,
    val at: String,
    /** Task title at the time of the change. */
    val taskTitle: String,
)

/** Activity entry types. */
@JsExport
object ActivityType {
    const val CREATED: String = "created"
    const val DELETED: String = "deleted"
    const val STATUS: String = "status"
    const val ASSIGNEE: String = "assignee"
    const val DEPENDENCY: String = "dependency"
    const val COMMENT: String = "comment"
    const val EDIT: String = "edit"

    val all: Array<String> = arrayOf(CREATED, DELETED, STATUS, ASSIGNEE, DEPENDENCY, COMMENT, EDIT)

    fun label(type: String): String =
        when (type) {
            CREATED -> "Created"
            DELETED -> "Deleted"
            STATUS -> "Status"
            ASSIGNEE -> "Assignee"
            DEPENDENCY -> "Dependencies"
            COMMENT -> "Comments"
            EDIT -> "Other edits"
            else -> type
        }
}

internal const val ACTIVITY_LIMIT = 5000
private const val SNIPPET = 140

private fun snippet(text: String): String = if (text.length <= SNIPPET) text else text.take(SNIPPET - 1).trimEnd() + "…"

private val FIELD_LABELS =
    mapOf(
        "title" to "title",
        "description" to "description",
        "status" to "status",
        "priority" to "priority",
        "projectId" to "project",
        "tags" to "tags",
        "dueDate" to "due date",
        "estimateMinutes" to "estimate",
        "timeSpentMinutes" to "time spent",
        "subtasks" to "subtasks",
        "assigneeId" to "assignee",
        "recurrence" to "recurrence",
        "blockedBy" to "blockers",
    )

/**
 * Computes activity entries for the difference between two states. Unchanged tasks are skipped by reference,
 * so this stays cheap even for large bulk operations. Ordering changes (`order`) and the derived `completedAt`
 * are not logged.
 */
internal fun diffActivity(
    before: AppState,
    after: AppState,
    actorId: String,
    at: String,
    newId: () -> String,
): List<ActivityEntry> {
    if (before.tasks === after.tasks) return emptyList()
    val old = before.tasks.associateBy { it.id }
    val entries = mutableListOf<ActivityEntry>()

    fun entry(
        task: Task,
        type: String,
        field: String?,
        from: String?,
        to: String?,
    ) {
        entries += ActivityEntry(newId(), task.id, actorId, type, field, from, to, at, task.title)
    }

    val title = { id: String -> after.findTask(id)?.title ?: before.findTask(id)?.title ?: id }
    val projectName = { id: String? ->
        if (id == null) "No project" else (after.findProject(id) ?: before.findProject(id))?.name ?: "Unknown project"
    }
    val memberName = { id: String? ->
        if (id == null) "Unassigned" else (after.findMember(id) ?: before.findMember(id))?.name ?: "Unknown member"
    }
    val beforeStatuses = StatusLookup(before)
    val afterStatuses = StatusLookup(after)
    val newIds = HashSet<String>()
    for (t in after.tasks) {
        val o = old[t.id]
        if (o == null) {
            newIds += t.id
            entry(t, ActivityType.CREATED, null, null, t.title)
            continue
        }
        if (o === t) continue

        fun edit(
            field: String,
            from: String,
            to: String,
            type: String = ActivityType.EDIT,
        ) {
            if (from != to) entry(t, type, field, from, to)
        }
        edit("title", o.title, t.title)
        edit("description", snippet(o.description), snippet(t.description))
        if (o.status != t.status) {
            entry(t, ActivityType.STATUS, "status", beforeStatuses.statusOf(o).name, afterStatuses.statusOf(t).name)
        }
        edit("priority", Priority.label(o.priority), Priority.label(t.priority))
        edit("projectId", projectName(o.projectId), projectName(t.projectId))
        edit("tags", tagsText(o.tags), tagsText(t.tags))
        edit("dueDate", o.dueDate?.let { DateFmt.long(it) } ?: "No date", t.dueDate?.let { DateFmt.long(it) } ?: "No date")
        edit(
            "estimateMinutes",
            o.estimateMinutes?.let { DateFmt.duration(it) } ?: "—",
            t.estimateMinutes?.let { DateFmt.duration(it) } ?: "—",
        )
        edit("timeSpentMinutes", DateFmt.duration(o.timeSpentMinutes), DateFmt.duration(t.timeSpentMinutes))
        subtaskChange(o.subtasks, t.subtasks)?.let { entry(t, ActivityType.EDIT, "subtasks", null, it) }
        edit("assigneeId", memberName(o.assigneeId), memberName(t.assigneeId), ActivityType.ASSIGNEE)
        edit("recurrence", Recurrence.label(o.recurrence), Recurrence.label(t.recurrence))
        if (!o.blockedBy.contentEquals(t.blockedBy)) {
            t.blockedBy.filter { it !in o.blockedBy }.forEach { entry(t, ActivityType.DEPENDENCY, "blockedBy", null, title(it)) }
            o.blockedBy.filter { it !in t.blockedBy }.forEach { entry(t, ActivityType.DEPENDENCY, "blockedBy", title(it), null) }
        }
        if (o.comments !== t.comments) {
            val known = o.comments.map { it.id }.toSet()
            t.comments.filter { it.id !in known }.forEach { entry(t, ActivityType.COMMENT, "comments", null, snippet(it.body)) }
        }
    }
    val remaining = after.tasks.mapTo(HashSet()) { it.id }
    for (o in before.tasks) if (o.id !in remaining) entry(o, ActivityType.DELETED, null, o.title, null)
    return entries
}

private fun tagsText(tags: Array<String>): String = if (tags.isEmpty()) "—" else tags.joinToString(", ") { "#$it" }

private fun subtaskChange(
    old: Array<Subtask>,
    new: Array<Subtask>,
): String? {
    if (old === new) return null
    val before = old.associateBy { it.id }
    val after = new.associateBy { it.id }
    val parts = mutableListOf<String>()
    new.filter { it.id !in before }.forEach { parts += "added “${it.title}”" }
    old.filter { it.id !in after }.forEach { parts += "removed “${it.title}”" }
    new.forEach { s ->
        val p = before[s.id] ?: return@forEach
        if (p.title != s.title) parts += "renamed “${p.title}” to “${s.title}”"
        if (p.done != s.done) parts += if (s.done) "completed “${s.title}”" else "reopened “${s.title}”"
    }
    return parts.takeIf { it.isNotEmpty() }?.joinToString("; ")
}

/** Human-readable sentence (without the actor) for an entry, e.g. "changed status from To do to Done". */
@JsExport
fun describeActivity(entry: ActivityEntry): String {
    val field = entry.field?.let { FIELD_LABELS[it] ?: it }.orEmpty()
    return when (entry.type) {
        ActivityType.CREATED -> "created the task"
        ActivityType.DELETED -> "deleted the task"
        ActivityType.COMMENT -> "commented"
        ActivityType.DEPENDENCY ->
            if (entry.to != null) "added blocker “${entry.to}”" else "removed blocker “${entry.from}”"
        else ->
            if (entry.field == "subtasks") {
                "updated subtasks: ${entry.to}"
            } else {
                "changed $field from “${entry.from.orEmpty()}” to “${entry.to.orEmpty()}”"
            }
    }
}

/** Activity page filters: actor ("" = anyone) and type ("" = all). Serialized to the URL query string. */
@JsExport
class ActivityQuery(
    val actor: String,
    val type: String,
    val page: Int,
) {
    val isFiltered: Boolean get() = actor.isNotEmpty() || type.isNotEmpty()

    fun withActor(actor: String): ActivityQuery = ActivityQuery(actor, type, 1)

    fun withType(type: String): ActivityQuery = ActivityQuery(actor, if (type in ActivityType.all) type else "", 1)

    fun withPage(page: Int): ActivityQuery = ActivityQuery(actor, type, page.coerceAtLeast(1))

    fun toQueryString(): String {
        val parts = mutableListOf<String>()
        if (actor.isNotEmpty()) parts += "actor=${encodeURIComponent(actor)}"
        if (type.isNotEmpty()) parts += "type=${encodeURIComponent(type)}"
        if (page > 1) parts += "page=$page"
        return parts.joinToString("&")
    }

    companion object {
        const val PAGE_SIZE: Int = 50

        fun parse(queryString: String): ActivityQuery {
            val p = parseParams(queryString)
            return ActivityQuery(
                actor = p["actor"].orEmpty(),
                type = p["type"]?.takeIf { it in ActivityType.all }.orEmpty(),
                page = p["page"]?.toIntOrNull()?.coerceAtLeast(1) ?: 1,
            )
        }
    }
}

@JsExport
class ActivityPage(
    val items: Array<ActivityEntry>,
    val total: Int,
    val page: Int,
    val pageCount: Int,
)

/** Filters and paginates the log, newest first. The page is clamped into range. */
@JsExport
fun queryActivity(
    entries: Array<ActivityEntry>,
    query: ActivityQuery,
    pageSize: Int,
): ActivityPage {
    val size = pageSize.coerceAtLeast(1)
    val filtered =
        entries
            .filter { (query.actor.isEmpty() || it.actorId == query.actor) && (query.type.isEmpty() || it.type == query.type) }
            .asReversed()
    val pageCount = ((filtered.size + size - 1) / size).coerceAtLeast(1)
    val page = query.page.coerceIn(1, pageCount)
    return ActivityPage(filtered.drop((page - 1) * size).take(size).toTypedArray(), filtered.size, page, pageCount)
}

/** Timeline for one task, newest first. */
@JsExport
fun taskActivity(
    entries: Array<ActivityEntry>,
    taskId: String,
): Array<ActivityEntry> = entries.filter { it.taskId == taskId }.asReversed().toTypedArray()
