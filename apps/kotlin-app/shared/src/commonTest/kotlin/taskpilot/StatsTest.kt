package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals

class StatsTest {
    private val tasks =
        listOf(
            task("a", status = Status.DONE, completedAt = iso(0), spent = 90),
            task("b", status = Status.DONE, completedAt = iso(-1), spent = 30),
            task("c", status = Status.DONE, completedAt = iso(-8)),
            task("d", status = Status.TODO, due = day(-1), priority = Priority.URGENT),
            task("e", status = Status.IN_PROGRESS, due = day(2), priority = Priority.HIGH),
            task("f", status = Status.TODO, due = day(9)),
        )

    @Test
    fun kpis() {
        val k = computeKpis(tasks, CLOCK)
        assertEquals(6, k.total)
        assertEquals(3, k.open)
        assertEquals(1, k.overdue)
        assertEquals(2, k.completed7d)
        assertEquals(50, k.completionRate)
        assertEquals(2.0, k.hoursTracked)
        assertEquals(0, computeKpis(emptyList(), CLOCK).completionRate)
    }

    @Test
    fun streakEndsTodayOrYesterday() {
        assertEquals(2, productivityStreak(tasks, CLOCK))
        val fromYesterday =
            listOf(
                task("x", status = Status.DONE, completedAt = iso(-1)),
                task("y", status = Status.DONE, completedAt = iso(-2)),
                task("z", status = Status.DONE, completedAt = iso(-3)),
                task("w", status = Status.DONE, completedAt = iso(-5)),
            )
        assertEquals(3, productivityStreak(fromYesterday, CLOCK))
        assertEquals(0, productivityStreak(listOf(task("q", status = Status.DONE, completedAt = iso(-2))), CLOCK))
    }

    @Test
    fun chartSeries() {
        val series = completedPerDay(tasks, CLOCK)
        assertEquals(30, series.size)
        assertEquals(TODAY, series.last().first)
        assertEquals(1, series.last().second)
        assertEquals(3, series.sumOf { it.second })
        val byPriority = openByPriority(tasks)
        assertEquals(1, byPriority[Priority.URGENT])
        assertEquals(1, byPriority[Priority.MEDIUM])
        assertEquals(listOf("e"), upcomingDeadlines(tasks, TODAY).map { it.id })
        assertEquals(listOf("d"), overdueTasks(tasks, TODAY).map { it.id })
    }

    @Test
    fun projectProgressPercent() {
        val p = Project("p1", "P", "#000000", iso(0))
        val list = listOf(task("a", projectId = "p1", status = Status.DONE), task("b", projectId = "p1"), task("c", projectId = "p1"))
        val progress = projectProgress(list, listOf(p)).single()
        assertEquals(3, progress.total)
        assertEquals(33, progress.percent)
    }
}
