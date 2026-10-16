package taskpilot

/** A Monday-first month grid: whole weeks covering the given month. */
data class MonthGrid(val year: Int, val month: Int, val days: List<Int>) {
    val firstDay: Int get() = Dates.epochDay(year, month, 1)

    fun inMonth(day: Int): Boolean = Dates.civil(day).let { it.first == year && it.second == month }
}

fun monthGrid(year: Int, month: Int): MonthGrid {
    val first = Dates.epochDay(year, month, 1)
    val start = first - Dates.weekdayMonFirst(first)
    val last = first + Dates.daysInMonth(year, month) - 1
    val end = last + (6 - Dates.weekdayMonFirst(last))
    return MonthGrid(year, month, (start..end).toList())
}

fun shiftMonth(year: Int, month: Int, delta: Int): Pair<Int, Int> {
    val idx = year * 12 + (month - 1) + delta
    return Math2.floorDiv(idx.toLong(), 12L).toInt() to (Math2.floorMod(idx, 12) + 1)
}

fun tasksByDueDay(tasks: List<Task>): Map<Int, List<Task>> =
    tasks
        .mapNotNull { t -> t.dueDay()?.let { it to t } }
        .groupBy({ it.first }, { it.second })
        .mapValues { (_, v) -> v.sortedWith(compareBy<Task>({ it.status == Status.DONE }, { -it.priority.rank }, { it.title })) }
