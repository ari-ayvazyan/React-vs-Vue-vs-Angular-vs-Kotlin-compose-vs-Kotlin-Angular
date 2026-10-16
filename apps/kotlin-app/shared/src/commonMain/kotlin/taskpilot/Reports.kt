package taskpilot

import kotlin.math.roundToInt

/**
 * Open tasks per day for the last [days] days (ending today) for [projectId] (null = all
 * projects, [NO_PROJECT] = tasks without a project). A task is open on day d when it was created
 * on or before d and not completed on or before d.
 */
fun burndown(
    tasks: List<Task>,
    clock: Clock,
    projectId: String?,
    days: Int = 30,
    projects: List<Project> = emptyList(),
): List<Pair<Int, Int>> {
    val today = clock.today
    val start = today - days + 1
    // A project's burndown includes its sub-projects (when the project list is given).
    val ids = projectId?.takeIf { it != NO_PROJECT }?.let { if (projects.isEmpty()) setOf(it) else descendantIds(projects, it) }
    val relevant =
        tasks.filter {
            when (projectId) {
                null -> true
                NO_PROJECT -> it.projectId == null
                else -> ids?.contains(it.projectId) == true
            }
        }
    val spans =
        relevant.map { t ->
            val created = clock.localDay(t.createdAt) ?: Int.MIN_VALUE
            val completed = if (t.status == Status.DONE) t.completedAt?.let { clock.localDay(it) } else null
            created to completed
        }
    return (start..today).map { d -> d to spans.count { (c, done) -> c <= d && (done == null || done > d) } }
}

/** One workload bar: open estimated hours for [member] (null = unassigned). */
data class Workload(val member: Member?, val minutes: Int, val openTasks: Int, val unestimated: Int) {
    val hours: Double get() = (minutes / 6.0).roundToInt() / 10.0
}

/** Sum of estimates of open tasks per member (member order), plus "unassigned" when there is any open task without one. */
fun workloadPerAssignee(tasks: List<Task>, members: List<Member>): List<Workload> {
    val open = tasks.filter { it.status != Status.DONE }
    val known = members.map { it.id }.toSet()

    fun load(member: Member?, list: List<Task>) =
        Workload(member, list.sumOf { it.estimateMinutes ?: 0 }, list.size, list.count { it.estimateMinutes == null })
    val rows = members.map { m -> load(m, open.filter { it.assigneeId == m.id }) }
    val unassigned = open.filter { it.assigneeId == null || it.assigneeId !in known }
    return rows + if (unassigned.isNotEmpty()) listOf(load(null, unassigned)) else emptyList()
}

/** Average cycle time (created → completed) in days for done tasks of one priority. */
data class CycleTime(val priority: Priority, val averageDays: Double?, val count: Int)

fun cycleTimeByPriority(tasks: List<Task>): List<CycleTime> {
    val byPriority =
        tasks
            .filter { it.status == Status.DONE }
            .mapNotNull { t ->
                val c = Dates.millisFromIso(t.createdAt) ?: return@mapNotNull null
                val d = t.completedAt?.let { Dates.millisFromIso(it) } ?: return@mapNotNull null
                t.priority to ((d - c).coerceAtLeast(0) / Dates.DAY_MS.toDouble())
            }.groupBy({ it.first }, { it.second })
    return Priority.entries.reversed().map { p ->
        val list = byPriority[p].orEmpty()
        CycleTime(p, if (list.isEmpty()) null else (list.average() * 10).roundToInt() / 10.0, list.size)
    }
}

// ---- CSV -------------------------------------------------------------------------------------

private val CSV_HEADER =
    listOf(
        "id",
        "title",
        "status",
        "priority",
        "project",
        "assignee",
        "tags",
        "dueDate",
        "estimateMinutes",
        "timeSpentMinutes",
        "createdAt",
        "completedAt",
        "recurrence",
        "blockedBy",
        "description",
    )

/** RFC 4180 quoting; text cells starting with = + - @ are prefixed with ' to prevent formula injection. */
fun csvCell(value: String?, text: Boolean = true): String {
    var v = value.orEmpty()
    if (text && v.isNotEmpty() && v[0] in "=+-@\t\r") v = "'$v"
    return if (v.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) "\"" + v.replace("\"", "\"\"") + "\"" else v
}

/** CSV of [tasks] in the given order (CRLF line endings, header row first). */
fun tasksToCsv(tasks: List<Task>, projects: List<Project>, members: List<Member>): String {
    val projectNames = projects.associate { it.id to it.name }
    val memberNames = members.associate { it.id to it.name }
    val sb = StringBuilder()
    sb.append(CSV_HEADER.joinToString(",")).append("\r\n")
    for (t in tasks) {
        val cells =
            listOf(
                csvCell(t.id, text = false),
                csvCell(t.title),
                csvCell(t.status.key, text = false),
                csvCell(t.priority.key, text = false),
                csvCell(t.projectId?.let { projectNames[it] }),
                csvCell(t.assigneeId?.let { memberNames[it] }),
                csvCell(t.tags.joinToString(";")),
                csvCell(t.dueDate, text = false),
                csvCell(t.estimateMinutes?.toString(), text = false),
                csvCell(t.timeSpentMinutes.toString(), text = false),
                csvCell(t.createdAt, text = false),
                csvCell(t.completedAt, text = false),
                csvCell(t.recurrence.key, text = false),
                csvCell(t.blockedBy.joinToString(";"), text = false),
                csvCell(t.description),
            )
        sb.append(cells.joinToString(",")).append("\r\n")
    }
    return sb.toString()
}
