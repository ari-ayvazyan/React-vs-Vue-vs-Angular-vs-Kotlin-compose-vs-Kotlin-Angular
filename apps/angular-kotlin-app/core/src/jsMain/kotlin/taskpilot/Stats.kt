@file:OptIn(ExperimentalJsExport::class)

package taskpilot

import kotlin.math.roundToInt

@JsExport
class DayCount(
    val date: String,
    val label: String,
    val count: Int,
)

@JsExport
class PrioritySlice(
    val priority: String,
    val label: String,
    val count: Int,
    val color: String,
)

@JsExport
class ProjectProgress(
    val projectId: String,
    val name: String,
    val color: String,
    val total: Int,
    val done: Int,
    val percent: Int,
)

/** Open-task load of one assignee (memberId "" = unassigned). */
@JsExport
class AssigneeLoad(
    val memberId: String,
    val name: String,
    val color: String,
    val initials: String,
    val open: Int,
)

@JsExport
class DashboardStats(
    val total: Int,
    val open: Int,
    val overdue: Int,
    val completedLast7Days: Int,
    val completionRate: Int,
    val hoursTracked: Double,
    val streak: Int,
    val completedPerDay: Array<DayCount>,
    val openByPriority: Array<PrioritySlice>,
    val projectProgress: Array<ProjectProgress>,
    val upcoming: Array<Task>,
    val overdueTasks: Array<Task>,
    val overdueTotal: Int,
    val openByAssignee: Array<AssigneeLoad>,
)

/** Rounds to one decimal place. */
internal fun round1(value: Double): Double = (value * 10).roundToInt() / 10.0

/**
 * Consecutive days with at least one completion, ending today or (if nothing yet today) yesterday.
 */
internal fun productivityStreak(
    completionDays: Set<Int>,
    today: Int,
): Int {
    var day =
        when {
            today in completionDays -> today
            (today - 1) in completionDays -> today - 1
            else -> return 0
        }
    var streak = 0
    while (day in completionDays) {
        streak++
        day--
    }
    return streak
}

/** Computes every KPI and chart series for the dashboard. [today] is `YYYY-MM-DD` (local). */
@JsExport
fun computeDashboardStats(
    state: AppState,
    today: String,
): DashboardStats = computeStatsForDay(state, parseDay(today) ?: Clock.today()) { localDayOfInstant(it) }

internal fun computeStatsForDay(
    state: AppState,
    today: Int,
    dayOfInstant: (String?) -> Int?,
): DashboardStats {
    val tasks = state.tasks
    val done = tasks.filter { it.isDone }
    val open = tasks.filter { !it.isDone }
    val completionDays = done.mapNotNull { dayOfInstant(it.completedAt) }
    val completionSet = completionDays.toSet()
    val perDay = completionDays.groupingBy { it }.eachCount()

    val series =
        (29 downTo 0)
            .map { back ->
                val day = today - back
                DayCount(formatDay(day), DateFmt.short(formatDay(day)), perDay[day] ?: 0)
            }.toTypedArray()

    val priorityCounts = open.groupingBy { it.priority }.eachCount()
    val slices =
        Priority.all
            .reversedArray()
            .map { p -> PrioritySlice(p, Priority.label(p), priorityCounts[p] ?: 0, Priority.color(p)) }
            .toTypedArray()

    // Tree order; each project's numbers include its sub-projects.
    val progress = projectTree(state).mapNotNull { projectProgress(state, it.project.id) }.toTypedArray()

    val overdue = open.filter { isOverdue(it, today) }.sortedBy { parseDay(it.dueDate) }
    val upcoming =
        open
            .filter { t -> parseDay(t.dueDate)?.let { it in today..(today + 7) } == true }
            .sortedWith(compareBy<Task> { parseDay(it.dueDate) }.thenByDescending { Priority.rank(it.priority) })
            .take(8)

    return DashboardStats(
        total = tasks.size,
        open = open.size,
        overdue = overdue.size,
        completedLast7Days = completionDays.count { it in (today - 6)..today },
        completionRate = percent(done.size, tasks.size),
        hoursTracked = round1(tasks.sumOf { it.timeSpentMinutes } / 60.0),
        streak = productivityStreak(completionSet, today),
        completedPerDay = series,
        openByPriority = slices,
        projectProgress = progress,
        upcoming = upcoming.toTypedArray(),
        overdueTasks = overdue.take(8).toTypedArray(),
        overdueTotal = overdue.size,
        openByAssignee = openByAssignee(state.members, open),
    )
}

/** One row per member (in member order) plus an "Unassigned" row when any open task has no assignee. */
internal fun openByAssignee(
    members: Array<Member>,
    open: List<Task>,
): Array<AssigneeLoad> {
    val counts = open.groupingBy { it.assigneeId }.eachCount()
    val rows = members.map { m -> AssigneeLoad(m.id, m.name, m.color, m.initials, counts[m.id] ?: 0) }.toMutableList()
    val unassigned = counts[null] ?: 0
    if (unassigned > 0 || members.isEmpty()) rows += AssigneeLoad("", "Unassigned", "#94a3b8", "–", unassigned)
    return rows.toTypedArray()
}

internal fun percent(
    part: Int,
    total: Int,
): Int = if (total == 0) 0 else (part * 100.0 / total).roundToInt()

/** Progress for a single project (used on the projects page). */
@JsExport
fun projectProgress(
    state: AppState,
    projectId: String,
): ProjectProgress? {
    val p = state.findProject(projectId) ?: return null
    val matcher = ProjectMatcher(state, projectId)
    val list = state.tasks.filter { matcher.matches(it) }
    val d = list.count { it.isDone }
    return ProjectProgress(p.id, projectPath(state, p.id), p.color, list.size, d, percent(d, list.size))
}

/** Count of tasks without a project. */
@JsExport
fun unassignedTaskCount(state: AppState): Int = state.tasks.count { it.projectId == null }
