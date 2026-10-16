@file:OptIn(ExperimentalJsExport::class)

package taskpilot

@JsExport
class CalendarDay(
    val date: String,
    val dayOfMonth: Int,
    val inMonth: Boolean,
    val isToday: Boolean,
    val isWeekend: Boolean,
    val tasks: Array<Task>,
)

@JsExport
class MonthGrid(
    val year: Int,
    val month: Int,
    val title: String,
    val days: Array<CalendarDay>,
)

@JsExport
class YearMonth(
    val year: Int,
    val month: Int,
)

/**
 * Monday-first month grid covering full weeks. Tasks are placed on their due date, sorted by priority,
 * optionally filtered by assignee ("" = everyone, [UNASSIGNED]).
 */
@JsExport
fun buildMonthGrid(
    year: Int,
    month: Int,
    tasks: Array<Task>,
    today: String,
    assigneeFilter: String,
): MonthGrid {
    val first = CivilDate.daysFromCivil(year, month, 1)
    val last = first + CivilDate.daysInMonth(year, month) - 1
    val start = first - CivilDate.weekdayMonFirst(first)
    val end = last + (6 - CivilDate.weekdayMonFirst(last))
    val todayDay = parseDay(today)
    val byDay =
        tasks
            .filter { matchesAssignee(it, assigneeFilter) && parseDay(it.dueDate)?.let { d -> d in start..end } == true }
            .groupBy { parseDay(it.dueDate)!! }
    val days =
        (start..end)
            .map { d ->
                val (_, _, dom) = CivilDate.civilFromDays(d)
                val dayTasks =
                    byDay[d]
                        .orEmpty()
                        .sortedWith(
                            compareBy<Task> { it.isDone }
                                .thenByDescending { Priority.rank(it.priority) }
                                .thenBy { it.title },
                        )
                CalendarDay(
                    date = formatDay(d),
                    dayOfMonth = dom,
                    inMonth = d in first..last,
                    isToday = d == todayDay,
                    isWeekend = CivilDate.weekdayMonFirst(d) >= 5,
                    tasks = dayTasks.toTypedArray(),
                )
            }.toTypedArray()
    return MonthGrid(year, month, "${DateFmt.monthName(month)} $year", days)
}

/** Adds [delta] months to a year/month pair. */
@JsExport
fun shiftMonth(
    year: Int,
    month: Int,
    delta: Int,
): YearMonth {
    val index = year * 12 + (month - 1) + delta
    return YearMonth(IntMath.floorDiv(index, 12), IntMath.floorMod(index, 12) + 1)
}

/** Year/month of a `YYYY-MM-DD` date. */
@JsExport
fun yearMonthOf(date: String): YearMonth {
    val (y, m, _) = CivilDate.civilFromDays(parseDay(date) ?: Clock.today())
    return YearMonth(y, m)
}

internal object IntMath {
    fun floorDiv(
        a: Int,
        b: Int,
    ): Int {
        val q = a / b
        return if ((a % b != 0) && ((a < 0) != (b < 0))) q - 1 else q
    }

    fun floorMod(
        a: Int,
        b: Int,
    ): Int = a - floorDiv(a, b) * b
}
