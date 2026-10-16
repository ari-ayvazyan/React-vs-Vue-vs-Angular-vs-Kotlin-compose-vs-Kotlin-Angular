package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals

class StatsTest {
    private fun at(date: String) = "${date}T12:00:00.000Z"

    private fun stats(vararg tasks: Task): DashboardStats {
        val state = AppState(arrayOf(*tasks), arrayOf(Project("p1", "Web", "#6366f1", at(TODAY))), Settings.DEFAULT, emptyArray())
        return computeStatsForDay(
            state,
            day(TODAY),
        ) { iso -> parseInstant(iso)?.let { kotlin.math.floor(it / CivilDate.MS_PER_DAY).toInt() } }
    }

    @Test
    fun kpisAreComputed() {
        val s =
            stats(
                task("1", status = Status.DONE, completedAt = at("2026-10-15"), timeSpent = 90, projectId = "p1"),
                task("2", status = Status.DONE, completedAt = at("2026-09-01"), timeSpent = 30),
                task("3", dueDate = "2026-10-01", projectId = "p1"),
                task("4", dueDate = "2026-10-20", priority = Priority.URGENT),
            )
        assertEquals(4, s.total)
        assertEquals(2, s.open)
        assertEquals(1, s.overdue)
        assertEquals(1, s.completedLast7Days)
        assertEquals(50, s.completionRate)
        assertEquals(2.0, s.hoursTracked)
        assertEquals(30, s.completedPerDay.size)
        assertEquals(1, s.completedPerDay.last { it.date == "2026-10-15" }.count)
        assertEquals(1, s.openByPriority.single { it.priority == Priority.URGENT }.count)
        assertEquals(50, s.projectProgress.single().percent)
        assertEquals(listOf("4"), s.upcoming.map { it.id })
    }

    @Test
    fun streakEndsTodayOrYesterday() {
        val t = day(TODAY)
        assertEquals(3, productivityStreak(setOf(t, t - 1, t - 2, t - 4), t))
        assertEquals(2, productivityStreak(setOf(t - 1, t - 2), t))
        assertEquals(0, productivityStreak(setOf(t - 2, t - 3), t))
        assertEquals(0, productivityStreak(emptySet(), t))
    }

    @Test
    fun emptyStateHasZeroRates() {
        val s = stats()
        assertEquals(0, s.completionRate)
        assertEquals(0, s.streak)
        assertEquals(0.0, s.hoursTracked)
    }

    @Test
    fun chartGeometry() {
        val series = arrayOf(DayCount("a", "A", 0), DayCount("b", "B", 7), DayCount("c", "C", 3))
        val chart = buildLineChart(series, 600, 200)
        assertEquals(3, chart.points.size)
        assertEquals(8, chart.maxValue)
        assertEquals(10, chart.total)
        assertEquals(listOf("0", "2", "4", "6", "8"), chart.yTicks.map { it.label })
        assertEquals(40, niceMax(36))
        assertEquals(10, niceMax(9))
        assertEquals(chart.left.toDouble(), chart.points.first().x)
        val donut =
            buildDonut(arrayOf(PrioritySlice("low", "Low", 1, "#000"), PrioritySlice("high", "High", 3, "#fff")), 50.0, 50.0, 40.0, 25.0)
        assertEquals(4, donut.total)
        assertEquals(listOf(25, 75), donut.arcs.map { it.percent })
    }
}
