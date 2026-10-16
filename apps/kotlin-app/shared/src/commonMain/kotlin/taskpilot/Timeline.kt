package taskpilot

enum class Zoom(val key: String, val label: String, val pxPerDay: Double) {
    WEEK("week", "Week", 36.0),
    MONTH("month", "Month", 12.0),
    QUARTER("quarter", "Quarter", 4.0),
    ;

    companion object {
        fun fromKey(key: String?): Zoom = entries.firstOrNull { it.key == key } ?: MONTH
    }
}

/** A task drawn on the timeline from [start] (creation day) to [end] (due day), both inclusive epoch days. */
data class TimelineBar(val task: Task, val start: Int, val end: Int)

/** Splits tasks into bars (with a due date) and undated tasks. Bars never start after their due day. */
fun timelineBars(tasks: List<Task>, offsetMinutes: Int): Pair<List<TimelineBar>, List<Task>> {
    val bars = mutableListOf<TimelineBar>()
    val undated = mutableListOf<Task>()
    for (t in tasks) {
        val due = t.dueDay()
        if (due == null) {
            undated += t
            continue
        }
        val created = Dates.localDayOfIso(t.createdAt, offsetMinutes) ?: due
        bars += TimelineBar(t, minOf(created, due), due)
    }
    return bars to undated
}

/** Visible day range: all bars plus today, padded and widened to whole weeks (Monday start). */
fun timelineRange(bars: List<TimelineBar>, today: Int, padDays: Int = 7): IntRange {
    val min = minOf(bars.minOfOrNull { it.start } ?: today, today) - padDays
    val max = maxOf(bars.maxOfOrNull { it.end } ?: today, today) + padDays
    val start = min - Dates.weekdayMonFirst(min)
    val end = max + (6 - Dates.weekdayMonFirst(max))
    return start..end
}

sealed interface TimelineRow {
    data class Group(val key: String, val name: String, val color: String?, val count: Int, val collapsed: Boolean) : TimelineRow

    data class Item(val bar: TimelineBar, val groupKey: String) : TimelineRow
}

const val NO_PROJECT_GROUP = "none"

/** Rows grouped by project (project order, then "No project"); bars sorted by start, then due date. */
fun timelineRows(bars: List<TimelineBar>, projects: List<Project>, collapsed: Set<String>): List<TimelineRow> {
    val byProject = bars.groupBy { it.task.projectId ?: NO_PROJECT_GROUP }
    val known = projects.map { it.id }.toSet()
    // Tree order; sub-projects are labelled with their full path ("Parent › Child").
    val groups =
        projectTree(projects).map { (p, _) -> Triple(p.id, projectPath(projects, p.id), p.color) } +
            Triple(NO_PROJECT_GROUP, "No project", null)
    val rows = mutableListOf<TimelineRow>()
    for ((key, name, color) in groups) {
        val items =
            if (key == NO_PROJECT_GROUP) {
                byProject[NO_PROJECT_GROUP].orEmpty() + byProject.filterKeys { it != NO_PROJECT_GROUP && it !in known }.values.flatten()
            } else {
                byProject[key].orEmpty()
            }
        if (items.isEmpty()) continue
        val isCollapsed = key in collapsed
        rows += TimelineRow.Group(key, name, color, items.size, isCollapsed)
        if (!isCollapsed) {
            items.sortedWith(compareBy<TimelineBar>({ it.start }, { it.end }, { it.task.title })).forEach {
                rows += TimelineRow.Item(it, key)
            }
        }
    }
    return rows
}

data class Tick(val day: Int, val label: String, val major: Boolean)

/** Axis ticks for [zoom]: days (week zoom), Mondays (month zoom) or month starts (quarter zoom). */
fun timelineTicks(zoom: Zoom, range: IntRange): List<Tick> {
    val out = mutableListOf<Tick>()
    for (day in range) {
        val (y, m, d) = Dates.civil(day)
        val monthName = Dates.MONTH_NAMES[m - 1].take(3)
        when (zoom) {
            Zoom.WEEK ->
                out +=
                    Tick(day, if (d == 1 || day == range.first) "$monthName $d" else d.toString(), Dates.weekdayMonFirst(day) == 0)
            Zoom.MONTH -> if (Dates.weekdayMonFirst(day) == 0) out += Tick(day, "$monthName $d", d <= 7)
            Zoom.QUARTER -> if (d == 1) out += Tick(day, if (m == 1) "$monthName $y" else monthName, m % 3 == 1)
        }
    }
    return out
}

/** New due day after dragging a bar's right edge by [dxPx]; snaps to whole days and never ends before [start]. */
fun dueAfterDrag(originalDue: Int, start: Int, dxPx: Double, pxPerDay: Double): Int {
    val deltaDays = kotlin.math.round(dxPx / pxPerDay).toInt()
    return maxOf(start, originalDue + deltaDays)
}

/** Indices of rows to render for a scroll position (with [overscan] extra rows on both sides). */
fun visibleRows(scrollTop: Double, viewportHeight: Double, rowHeight: Double, total: Int, overscan: Int = 8): IntRange {
    if (total == 0) return IntRange.EMPTY
    val first = (kotlin.math.floor(scrollTop / rowHeight).toInt() - overscan).coerceAtLeast(0)
    val last = (kotlin.math.ceil((scrollTop + viewportHeight) / rowHeight).toInt() + overscan).coerceAtMost(total - 1)
    return first..last
}

/** A dependency arrow between two visible bar rows. */
data class DependencyLink(val fromRow: Int, val toRow: Int, val blocker: TimelineBar, val blocked: TimelineBar)

fun dependencyLinks(rows: List<TimelineRow>): List<DependencyLink> {
    val index = HashMap<String, Int>()
    rows.forEachIndexed { i, r -> if (r is TimelineRow.Item) index[r.bar.task.id] = i }
    val out = mutableListOf<DependencyLink>()
    rows.forEachIndexed { i, r ->
        if (r is TimelineRow.Item) {
            r.bar.task.blockedBy.forEach { b ->
                val from = index[b] ?: return@forEach
                out += DependencyLink(from, i, (rows[from] as TimelineRow.Item).bar, r.bar)
            }
        }
    }
    return out
}
