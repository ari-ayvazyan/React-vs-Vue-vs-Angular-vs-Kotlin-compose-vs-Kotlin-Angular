package taskpilot

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class ActivityType(val label: String) {
    @SerialName("created")
    CREATED("Created"),

    @SerialName("deleted")
    DELETED("Deleted"),

    @SerialName("status")
    STATUS("Status changes"),

    @SerialName("assignee")
    ASSIGNEE("Assignee changes"),

    @SerialName("dependencies")
    DEPENDENCIES("Dependencies"),

    @SerialName("comment")
    COMMENT("Comments"),

    @SerialName("updated")
    UPDATED("Other field changes"),
    ;

    val key: String get() = name.lowercase()

    companion object {
        fun fromKey(key: String?): ActivityType? = entries.firstOrNull { it.key == key }
    }
}

@Serializable
data class ActivityEntry(
    val id: String,
    val taskId: String,
    val actorId: String?,
    val type: ActivityType,
    val field: String? = null,
    val from: String? = null,
    val to: String? = null,
    val at: String,
)

/** Field names used in [ActivityEntry.field]. */
object ActivityField {
    const val TITLE = "title"
    const val DESCRIPTION = "description"
    const val STATUS = "status"
    const val PRIORITY = "priority"
    const val PROJECT = "project"
    const val ASSIGNEE = "assignee"
    const val TAGS = "tags"
    const val DUE = "dueDate"
    const val ESTIMATE = "estimate"
    const val TIME = "timeSpent"
    const val SUBTASKS = "subtasks"
    const val RECURRENCE = "recurrence"
    const val BLOCKED_BY = "blockedBy"
    const val COMMENT = "comment"
}

/** Keeps the persisted log bounded; oldest entries are dropped first. */
const val ACTIVITY_LIMIT = 5000

private const val EXCERPT = 140

private fun excerpt(s: String) = if (s.length <= EXCERPT) s else s.take(EXCERPT - 1) + "…"

private fun subtaskSummary(t: Task) = "${t.subtasks.count { it.done }}/${t.subtasks.size}"

/**
 * Computes activity entries for everything that changed between [before] and [after]
 * (created, deleted and each changed field; board reordering alone is not logged).
 * [newId] supplies entry ids so the function stays pure.
 */
fun diffActivity(
    before: List<Task>,
    after: List<Task>,
    actorId: String?,
    at: String,
    newId: () -> String,
): List<ActivityEntry> {
    if (before === after) return emptyList()
    val out = mutableListOf<ActivityEntry>()

    fun add(taskId: String, type: ActivityType, field: String? = null, from: String? = null, to: String? = null) {
        out += ActivityEntry(newId(), taskId, actorId, type, field, from, to, at)
    }
    val old = before.associateBy { it.id }
    val nowIds = HashSet<String>(after.size)
    for (t in after) {
        nowIds += t.id
        val o = old[t.id]
        if (o == null) {
            add(t.id, ActivityType.CREATED, to = t.title)
            continue
        }
        if (o === t || o == t) continue
        if (o.title != t.title) add(t.id, ActivityType.UPDATED, ActivityField.TITLE, o.title, t.title)
        if (o.description != t.description) {
            add(t.id, ActivityType.UPDATED, ActivityField.DESCRIPTION, excerpt(o.description), excerpt(t.description))
        }
        if (o.status != t.status || o.statusId != t.statusId) {
            // A category change without a new id (not yet normalised) is logged by category.
            val sameId = o.statusId == t.statusId
            add(
                t.id,
                ActivityType.STATUS,
                ActivityField.STATUS,
                if (sameId) o.status.key else o.statusId,
                if (sameId) t.status.key else t.statusId,
            )
        }
        if (o.priority != t.priority) add(t.id, ActivityType.UPDATED, ActivityField.PRIORITY, o.priority.key, t.priority.key)
        if (o.projectId != t.projectId) add(t.id, ActivityType.UPDATED, ActivityField.PROJECT, o.projectId, t.projectId)
        if (o.assigneeId != t.assigneeId) add(t.id, ActivityType.ASSIGNEE, ActivityField.ASSIGNEE, o.assigneeId, t.assigneeId)
        if (o.tags != t.tags) add(t.id, ActivityType.UPDATED, ActivityField.TAGS, o.tags.joinToString(","), t.tags.joinToString(","))
        if (o.dueDate != t.dueDate) add(t.id, ActivityType.UPDATED, ActivityField.DUE, o.dueDate, t.dueDate)
        if (o.estimateMinutes != t.estimateMinutes) {
            add(t.id, ActivityType.UPDATED, ActivityField.ESTIMATE, o.estimateMinutes?.toString(), t.estimateMinutes?.toString())
        }
        if (o.timeSpentMinutes != t.timeSpentMinutes) {
            add(t.id, ActivityType.UPDATED, ActivityField.TIME, o.timeSpentMinutes.toString(), t.timeSpentMinutes.toString())
        }
        if (o.subtasks != t.subtasks) add(t.id, ActivityType.UPDATED, ActivityField.SUBTASKS, subtaskSummary(o), subtaskSummary(t))
        if (o.recurrence != t.recurrence) add(t.id, ActivityType.UPDATED, ActivityField.RECURRENCE, o.recurrence.key, t.recurrence.key)
        if (o.blockedBy != t.blockedBy) {
            add(t.id, ActivityType.DEPENDENCIES, ActivityField.BLOCKED_BY, o.blockedBy.joinToString(","), t.blockedBy.joinToString(","))
        }
        if (o.comments != t.comments) {
            val oldIds = o.comments.map { it.id }.toSet()
            t.comments.filter { it.id !in oldIds }.forEach { c ->
                add(t.id, ActivityType.COMMENT, ActivityField.COMMENT, null, excerpt(c.body))
            }
        }
    }
    for (o in before) if (o.id !in nowIds) add(o.id, ActivityType.DELETED, from = o.title)
    return out
}

/** Appends [entries] and trims to [ACTIVITY_LIMIT]. */
fun appendActivity(log: List<ActivityEntry>, entries: List<ActivityEntry>): List<ActivityEntry> =
    if (entries.isEmpty()) log else (log + entries).takeLast(ACTIVITY_LIMIT)

/** Name lookups used to describe entries (ids may refer to deleted things). */
interface ActivityNames {
    fun task(id: String): String?

    fun member(id: String?): String?

    fun project(id: String?): String?

    /** Name of workflow status [statusId] for the task's project (null = unknown, falls back to the category label). */
    fun status(taskId: String, statusId: String?): String? = null
}

private fun splitIds(s: String?): List<String> = s?.split(',')?.filter { it.isNotEmpty() }.orEmpty()

/** Plain-language description of what happened (without actor and task, which the UI renders as links). */
fun describeActivity(e: ActivityEntry, names: ActivityNames): String {
    fun q(s: String?) = if (s.isNullOrEmpty()) "none" else "\"$s\""
    return when (e.type) {
        ActivityType.CREATED -> "created the task"
        ActivityType.DELETED -> "deleted the task"
        ActivityType.COMMENT -> "commented: ${q(e.to)}"
        ActivityType.STATUS -> {
            fun label(id: String?) = names.status(e.taskId, id) ?: Status.fromKey(id.orEmpty())?.label ?: id ?: "none"
            "changed status from ${label(e.from)} to ${label(e.to)}"
        }
        ActivityType.ASSIGNEE ->
            when {
                e.to == null -> "unassigned ${names.member(e.from) ?: "someone"}"
                e.from == null -> "assigned ${names.member(e.to) ?: "a removed member"}"
                else -> "reassigned from ${names.member(e.from) ?: "a removed member"} to ${names.member(e.to) ?: "a removed member"}"
            }
        ActivityType.DEPENDENCIES -> {
            val from = splitIds(e.from)
            val to = splitIds(e.to)
            val added = to - from.toSet()
            val removed = from - to.toSet()
            listOfNotNull(
                added.takeIf { it.isNotEmpty() }?.let {
                    "added blocker " +
                        it.joinToString(", ") { id -> q(names.task(id) ?: "deleted task") }
                },
                removed.takeIf { it.isNotEmpty() }?.let {
                    "removed blocker " +
                        it.joinToString(", ") { id -> q(names.task(id) ?: "deleted task") }
                },
            ).joinToString(" and ").ifEmpty { "changed dependencies" }
        }
        ActivityType.UPDATED ->
            when (e.field) {
                ActivityField.TITLE -> "renamed from ${q(e.from)} to ${q(e.to)}"
                ActivityField.DESCRIPTION -> "updated the description"
                ActivityField.PRIORITY ->
                    "changed priority from ${Priority.fromKey(e.from.orEmpty())?.label} to ${Priority.fromKey(e.to.orEmpty())?.label}"
                ActivityField.PROJECT -> "moved from ${names.project(e.from) ?: "no project"} to ${names.project(e.to) ?: "no project"}"
                ActivityField.TAGS -> "changed tags from ${q(e.from?.replace(",", ", "))} to ${q(e.to?.replace(",", ", "))}"
                ActivityField.DUE -> "changed due date from ${e.from ?: "none"} to ${e.to ?: "none"}"
                ActivityField.ESTIMATE -> "changed estimate from ${e.from?.let {
                    "$it min"
                } ?: "none"} to ${e.to?.let { "$it min" } ?: "none"}"
                ActivityField.TIME -> {
                    val delta = (e.to?.toIntOrNull() ?: 0) - (e.from?.toIntOrNull() ?: 0)
                    if (delta >= 0) "logged $delta min" else "changed time spent from ${e.from} to ${e.to} min"
                }
                ActivityField.SUBTASKS -> "updated subtasks (${e.from} → ${e.to} done)"
                ActivityField.RECURRENCE ->
                    "changed repeat from ${Recurrence.fromKey(e.from.orEmpty())?.label} to ${Recurrence.fromKey(e.to.orEmpty())?.label}"
                else -> "changed ${e.field}"
            }
    }
}

data class ActivityQuery(val memberId: String? = null, val type: ActivityType? = null, val page: Int = 1) {
    fun toParams(): List<Pair<String, String>> =
        buildList {
            memberId?.let { add("member" to it) }
            type?.let { add("type" to it.key) }
            if (page > 1) add("page" to page.toString())
        }

    companion object {
        const val PAGE_SIZE = 50

        fun fromParams(p: Map<String, String>) =
            ActivityQuery(
                memberId = p["member"]?.takeIf { it.isNotBlank() },
                type = ActivityType.fromKey(p["type"]),
                page = p["page"]?.toIntOrNull()?.coerceAtLeast(1) ?: 1,
            )
    }
}

/** Newest first, filtered by actor ([UNASSIGNED] = no actor) and type. */
fun filterActivity(log: List<ActivityEntry>, query: ActivityQuery, taskId: String? = null): List<ActivityEntry> =
    log
        .asReversed()
        .filter { e ->
            (taskId == null || e.taskId == taskId) &&
                (query.type == null || e.type == query.type) &&
                when (query.memberId) {
                    null -> true
                    UNASSIGNED -> e.actorId == null
                    else -> e.actorId == query.memberId
                }
        }
