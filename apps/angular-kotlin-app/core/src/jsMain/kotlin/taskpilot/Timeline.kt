@file:OptIn(ExperimentalJsExport::class)

package taskpilot

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** Timeline zoom levels and their pixels per day. */
@JsExport
object TimelineZoom {
    const val WEEK: String = "week"
    const val MONTH: String = "month"
    const val QUARTER: String = "quarter"

    val all: Array<String> = arrayOf(WEEK, MONTH, QUARTER)

    fun label(zoom: String): String =
        when (zoom) {
            WEEK -> "Week"
            QUARTER -> "Quarter"
            else -> "Month"
        }

    fun dayWidth(zoom: String): Double =
        when (zoom) {
            WEEK -> 36.0
            QUARTER -> 5.0
            else -> 14.0
        }

    internal fun padding(zoom: String): Int =
        when (zoom) {
            WEEK -> 3
            QUARTER -> 14
            else -> 7
        }
}

@JsExport
class TimelineTick(
    val x: Double,
    val label: String,
    val major: Boolean,
)

/** A row of the timeline's left column: a project group header or a task. */
@JsExport
class TimelineRow(
    /** "group" or "task". */
    val kind: String,
    val key: String,
    val label: String,
    val color: String,
    val y: Double,
    val height: Double,
    val count: Int,
    val collapsed: Boolean,
    val task: Task?,
)

@JsExport
class TimelineBar(
    val task: Task,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    /** Created date (local) – the bar's planned start. */
    val startDate: String,
    val dueDate: String,
    /** Due date before the creation date: the bar is drawn from due to created and flagged. */
    val inverted: Boolean,
    val overdue: Boolean,
    val blocked: Boolean,
)

@JsExport
class TimelineArrow(
    val fromId: String,
    val toId: String,
    val path: String,
    /** True while the blocker is still open. */
    val active: Boolean,
)

@JsExport
class Timeline(
    val zoom: String,
    val dayWidth: Double,
    val width: Double,
    val height: Double,
    /** First day shown (x = 0). */
    val startDate: String,
    val endDate: String,
    val ticks: Array<TimelineTick>,
    val todayX: Double,
    val rows: Array<TimelineRow>,
    val bars: Array<TimelineBar>,
    val arrows: Array<TimelineArrow>,
    /** Tasks without a due date (listed separately). */
    val undated: Array<Task>,
)

internal const val GROUP_ROW = 36.0
internal const val TASK_ROW = 32.0
private const val BAR_HEIGHT = 18.0
private const val NO_PROJECT_KEY = "none"

private fun fmt(v: Double): String = ((v * 10).toInt() / 10.0).toString()

/**
 * Gantt layout: one row per dated task, grouped by project (in project order, "No project" last), bars from the
 * local creation day to the due day (inclusive), dependency arrows from blocker to blocked task.
 * Groups whose key is in [collapsed] contribute only their header row.
 */
@JsExport
fun buildTimeline(
    state: AppState,
    zoom: String,
    today: String,
    collapsed: Array<String>,
    hideDone: Boolean,
): Timeline {
    val z = if (zoom in TimelineZoom.all) zoom else TimelineZoom.MONTH
    val dw = TimelineZoom.dayWidth(z)
    val todayDay = parseDay(today) ?: Clock.today()
    val tasks = state.tasks.filter { !hideDone || !it.isDone }
    val (dated, undated) = tasks.partition { parseDay(it.dueDate) != null }
    val startOf = { t: Task -> localDayOfInstant(t.createdAt) ?: parseDay(t.dueDate)!! }

    var minDay = todayDay
    var maxDay = todayDay
    for (t in dated) {
        val s = startOf(t)
        val e = parseDay(t.dueDate)!!
        minDay = min(minDay, min(s, e))
        maxDay = max(maxDay, max(s, e))
    }
    val pad = TimelineZoom.padding(z)
    minDay -= pad
    maxDay += pad
    // Start on a Monday so week ticks line up.
    minDay -= CivilDate.weekdayMonFirst(minDay)
    val days = maxDay - minDay + 1
    val width = days * dw

    val collapsedSet = collapsed.toSet()
    val groups =
        dated.groupBy { it.projectId?.takeIf { id -> state.findProject(id) != null } ?: NO_PROJECT_KEY }
    val orderedKeys = state.projects.map { it.id }.filter { it in groups } + listOfNotNull(NO_PROJECT_KEY.takeIf { it in groups })

    val rows = mutableListOf<TimelineRow>()
    val bars = mutableListOf<TimelineBar>()
    var y = 0.0
    for (key in orderedKeys) {
        val project = state.findProject(key)
        val list =
            groups
                .getValue(key)
                .sortedWith(compareBy<Task> { startOf(it) }.thenBy { parseDay(it.dueDate) }.thenBy { it.title })
        val isCollapsed = key in collapsedSet
        rows +=
            TimelineRow(
                "group",
                key,
                project?.let { projectPath(state, it.id) } ?: "No project",
                project?.color ?: "#94a3b8",
                y,
                GROUP_ROW,
                list.size,
                isCollapsed,
                null,
            )
        y += GROUP_ROW
        if (isCollapsed) continue
        for (t in list) {
            val s = startOf(t)
            val e = parseDay(t.dueDate)!!
            val from = min(s, e)
            val to = max(s, e)
            rows += TimelineRow("task", t.id, t.title, project?.color ?: "#94a3b8", y, TASK_ROW, 0, false, t)
            bars +=
                TimelineBar(
                    task = t,
                    x = (from - minDay) * dw,
                    y = y + (TASK_ROW - BAR_HEIGHT) / 2,
                    width = (to - from + 1) * dw,
                    height = BAR_HEIGHT,
                    startDate = formatDay(s),
                    dueDate = formatDay(e),
                    inverted = e < s,
                    overdue = isOverdue(t, todayDay),
                    blocked = isBlocked(state, t),
                )
            y += TASK_ROW
        }
    }

    val barById = bars.associateBy { it.task.id }
    val arrows =
        bars.flatMap { bar ->
            bar.task.blockedBy.mapNotNull { blockerId ->
                val from = barById[blockerId] ?: return@mapNotNull null
                TimelineArrow(blockerId, bar.task.id, arrowPath(from, bar), !from.task.isDone)
            }
        }

    return Timeline(
        zoom = z,
        dayWidth = dw,
        width = width,
        height = y,
        startDate = formatDay(minDay),
        endDate = formatDay(maxDay),
        ticks = ticks(z, minDay, maxDay, dw).toTypedArray(),
        todayX = (todayDay - minDay) * dw + dw / 2,
        rows = rows.toTypedArray(),
        bars = bars.toTypedArray(),
        arrows = arrows.toTypedArray(),
        undated = undated.sortedBy { it.title.lowercase() }.toTypedArray(),
    )
}

/** Elbow connector from the end of [from] to the start of [to]; detours below when the target starts earlier. */
internal fun arrowPath(
    from: TimelineBar,
    to: TimelineBar,
): String {
    val x1 = from.x + from.width
    val y1 = from.y + from.height / 2
    val x2 = to.x
    val y2 = to.y + to.height / 2
    val gap = 8.0
    return if (x2 - gap >= x1 + gap) {
        val mid = x1 + gap
        "M${fmt(x1)},${fmt(y1)} H${fmt(mid)} V${fmt(y2)} H${fmt(x2)}"
    } else {
        val turnY = if (y2 > y1) y2 - TASK_ROW / 2 else y2 + TASK_ROW / 2
        "M${fmt(x1)},${fmt(y1)} H${fmt(x1 + gap)} V${fmt(turnY)} H${fmt(x2 - gap)} V${fmt(y2)} H${fmt(x2)}"
    }
}

private val MONTH_SHORT = arrayOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

private fun ticks(
    zoom: String,
    minDay: Int,
    maxDay: Int,
    dw: Double,
): List<TimelineTick> {
    val out = mutableListOf<TimelineTick>()
    for (d in minDay..maxDay) {
        val (y, m, dom) = CivilDate.civilFromDays(d)
        val x = (d - minDay) * dw
        val monday = CivilDate.weekdayMonFirst(d) == 0
        when (zoom) {
            TimelineZoom.WEEK -> {
                if (dom == 1 || d == minDay) out += TimelineTick(x, "${DateFmt.monthName(m)} $y", true)
                out += TimelineTick(x, dom.toString(), false)
            }
            TimelineZoom.QUARTER -> {
                val quarterStart = dom == 1 && (m - 1) % 3 == 0
                if (quarterStart || d == minDay) out += TimelineTick(x, "Q${(m - 1) / 3 + 1} $y", true)
                if (dom == 1) out += TimelineTick(x, MONTH_SHORT[m - 1], false)
            }
            else -> {
                if (dom == 1 || d == minDay) out += TimelineTick(x, "${DateFmt.monthName(m)} $y", true)
                if (monday) out += TimelineTick(x, "${MONTH_SHORT[m - 1]} $dom", false)
            }
        }
    }
    return out
}

/** Day (YYYY-MM-DD) under timeline x-coordinate [x], clamped to the visible range. */
@JsExport
fun timelineDayAt(
    timeline: Timeline,
    x: Double,
): String {
    val start = parseDay(timeline.startDate)!!
    val end = parseDay(timeline.endDate)!!
    return formatDay((start + floor(x / timeline.dayWidth).toInt()).coerceIn(start, end))
}

/** x of the right edge of [day]'s column (where a bar ending on that day ends). */
@JsExport
fun timelineDayEndX(
    timeline: Timeline,
    day: String,
): Double = ((parseDay(day) ?: parseDay(timeline.startDate)!!) - parseDay(timeline.startDate)!! + 1) * timeline.dayWidth

@JsExport
class TimelineSpan(
    val x: Double,
    val width: Double,
)

/** Geometry of [bar] if its due date were [dueDate] (live preview while dragging the right end). */
@JsExport
fun timelinePreview(
    timeline: Timeline,
    bar: TimelineBar,
    dueDate: String,
): TimelineSpan {
    val origin = parseDay(timeline.startDate)!!
    val start = parseDay(bar.startDate) ?: return TimelineSpan(bar.x, bar.width)
    val due = parseDay(dueDate) ?: return TimelineSpan(bar.x, bar.width)
    val from = min(start, due)
    val to = max(start, due)
    return TimelineSpan((from - origin) * timeline.dayWidth, (to - from + 1) * timeline.dayWidth)
}

/** Due date moved by [days] (keyboard resizing of a bar). */
@JsExport
fun shiftDate(
    date: String,
    days: Int,
): String = parseDay(date)?.let { formatDay(it + days) } ?: date
