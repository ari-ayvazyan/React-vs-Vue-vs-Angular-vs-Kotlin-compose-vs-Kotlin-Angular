package taskpilot

import kotlin.math.roundToInt

/** "Now" as seen by the user: [today] is the local epoch day, [offsetMinutes] the local UTC offset. */
data class Clock(val nowMs: Long, val offsetMinutes: Int) {
    val today: Int get() = Math2.floorDiv(nowMs + offsetMinutes * 60_000L, Dates.DAY_MS).toInt()
    val nowIso: String get() = Dates.isoFromMillis(nowMs)

    fun localDay(iso: String): Int? = Dates.localDayOfIso(iso, offsetMinutes)
}

data class Kpis(
    val total: Int,
    val open: Int,
    val overdue: Int,
    val completed7d: Int,
    val completionRate: Int,
    val hoursTracked: Double,
)

fun computeKpis(tasks: List<Task>, clock: Clock): Kpis {
    val today = clock.today
    val done = tasks.count { it.status == Status.DONE }
    val completed7d =
        tasks.count { t ->
            t.status == Status.DONE && t.completedAt?.let { clock.localDay(it) }?.let { it in (today - 6)..today } == true
        }
    val minutes = tasks.sumOf { it.timeSpentMinutes.toLong() }
    return Kpis(
        total = tasks.size,
        open = tasks.size - done,
        overdue = tasks.count { it.isOverdue(today) },
        completed7d = completed7d,
        completionRate = if (tasks.isEmpty()) 0 else (done * 100.0 / tasks.size).roundToInt(),
        hoursTracked = (minutes / 6.0).roundToInt() / 10.0,
    )
}

/** Count of completions for each of the last [days] days, oldest first, ending today. */
fun completedPerDay(tasks: List<Task>, clock: Clock, days: Int = 30): List<Pair<Int, Int>> {
    val today = clock.today
    val start = today - days + 1
    val counts = IntArray(days)
    tasks.forEach { t ->
        if (t.status == Status.DONE) {
            val d = t.completedAt?.let { clock.localDay(it) }
            if (d != null && d in start..today) counts[d - start]++
        }
    }
    return counts.mapIndexed { i, c -> (start + i) to c }
}

fun openByPriority(tasks: List<Task>): Map<Priority, Int> {
    val open = tasks.filter { it.status != Status.DONE }
    return Priority.entries.reversed().associateWith { p -> open.count { it.priority == p } }
}

data class ProjectProgress(val project: Project, val total: Int, val done: Int) {
    val percent: Int get() = if (total == 0) 0 else (done * 100.0 / total).roundToInt()
}

fun projectProgress(tasks: List<Task>, projects: List<Project>): List<ProjectProgress> {
    val byProject = tasks.groupBy { it.projectId }
    return projects.map { p ->
        val list = byProject[p.id].orEmpty()
        ProjectProgress(p, list.size, list.count { it.status == Status.DONE })
    }
}

/** Open tasks due today through the next 7 days, soonest first. */
fun upcomingDeadlines(tasks: List<Task>, today: Int, limit: Int = 8): List<Task> =
    tasks
        .filter { t -> t.status != Status.DONE && t.dueDay()?.let { it in today..(today + 7) } == true }
        .sortedWith(compareBy<Task>({ it.dueDate }, { -it.priority.rank }, { it.id }))
        .take(limit)

fun overdueTasks(tasks: List<Task>, today: Int, limit: Int = 8): List<Task> =
    tasks
        .filter { it.isOverdue(today) }
        .sortedWith(compareBy<Task>({ it.dueDate }, { -it.priority.rank }, { it.id }))
        .take(limit)

/** Consecutive days with at least one completion, ending today or (if today has none) yesterday. */
fun productivityStreak(tasks: List<Task>, clock: Clock): Int {
    val days =
        tasks
            .asSequence()
            .filter { it.status == Status.DONE }
            .mapNotNull { t -> t.completedAt?.let { clock.localDay(it) } }
            .toHashSet()
    val today = clock.today
    var day =
        when {
            today in days -> today
            (today - 1) in days -> today - 1
            else -> return 0
        }
    var streak = 0
    while (day in days) {
        streak++
        day--
    }
    return streak
}

/** One bar of the "open tasks per assignee" chart; [member] null means unassigned. */
data class AssigneeLoad(val member: Member?, val open: Int)

/** Open task count for every member (in member order), plus an "unassigned" entry when there are any. */
fun openPerAssignee(tasks: List<Task>, members: List<Member>): List<AssigneeLoad> {
    val open = tasks.filter { it.status != Status.DONE }
    val counts = open.groupingBy { it.assigneeId }.eachCount()
    val known = members.map { it.id }.toSet()
    val unassigned = open.count { it.assigneeId == null || it.assigneeId !in known }
    return members.map { AssigneeLoad(it, counts[it.id] ?: 0) } +
        if (unassigned > 0) listOf(AssigneeLoad(null, unassigned)) else emptyList()
}
