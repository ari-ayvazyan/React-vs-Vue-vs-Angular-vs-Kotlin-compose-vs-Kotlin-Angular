@file:OptIn(ExperimentalJsExport::class)

package taskpilot

/** Burndown data: open tasks per day over the last 30 days plus the ideal straight line. */
@JsExport
class Burndown(
    val chart: LineChart,
    /** Straight line from the first day's open count to zero on the last day. */
    val idealPath: String,
    val start: Int,
    val end: Int,
)

/**
 * Open tasks of a project ("" = all projects, [NO_PROJECT] = no project) at the end of each of the last 30 days:
 * created on or before the day and not completed by then.
 */
internal fun burndownSeries(
    state: AppState,
    projectId: String,
    today: Int,
    dayOfInstant: (String?) -> Int?,
): Array<DayCount> {
    val project = ProjectMatcher(state, projectId)
    val spans =
        state.tasks
            .filter { project.matches(it) }
            .map { (dayOfInstant(it.createdAt) ?: today) to (if (it.isDone) dayOfInstant(it.completedAt) else null) }
    return (29 downTo 0)
        .map { back ->
            val d = today - back
            val open = spans.count { (created, done) -> created <= d && (done == null || done > d) }
            DayCount(formatDay(d), DateFmt.short(formatDay(d)), open)
        }.toTypedArray()
}

@JsExport
fun buildBurndown(
    state: AppState,
    projectId: String,
    today: String,
    width: Int,
    height: Int,
): Burndown {
    val series = burndownSeries(state, projectId, parseDay(today) ?: Clock.today()) { localDayOfInstant(it) }
    val chart = buildLineChart(series, width, height)
    val first = chart.points.first()
    val last = chart.points.last()
    val baseY = chart.height - chart.bottom
    val ideal = "M${first.x},${first.y} L${last.x},$baseY"
    return Burndown(chart, ideal, series.first().count, series.last().count)
}

/** One bar of a generic horizontal bar chart. */
@JsExport
class BarDatum(
    val key: String,
    val label: String,
    val value: Double,
    val valueLabel: String,
    val color: String,
)

/** Workload: sum of estimates of open tasks per assignee in hours (members in order, then "Unassigned"). */
@JsExport
fun workloadByAssignee(state: AppState): Array<BarDatum> {
    val open = state.tasks.filter { !it.isDone }
    val minutes = open.groupBy { it.assigneeId }.mapValues { (_, list) -> list.sumOf { it.estimateMinutes ?: 0 } }
    val rows =
        state.members.map { m ->
            val h = (minutes[m.id] ?: 0) / 60.0
            BarDatum(m.id, m.name, h, hoursLabel(h), m.color)
        }
    val unassigned = (minutes[null] ?: 0) / 60.0
    return (
        rows +
            listOfNotNull(
                BarDatum("", "Unassigned", unassigned, hoursLabel(unassigned), "#94a3b8").takeIf {
                    unassigned > 0 ||
                        rows.isEmpty()
                },
            )
    ).toTypedArray()
}

/** Average cycle time (created → completed) in days per priority, urgent first; priorities without data show "–". */
@JsExport
fun cycleTimeByPriority(state: AppState): Array<BarDatum> = cycleTimes(state) { parseInstant(it) }

internal fun cycleTimes(
    state: AppState,
    instant: (String?) -> Double?,
): Array<BarDatum> {
    val done = state.tasks.filter { it.isDone }
    return Priority.all
        .reversedArray()
        .map { p ->
            val durations =
                done.filter { it.priority == p }.mapNotNull { t ->
                    val c = instant(t.createdAt) ?: return@mapNotNull null
                    val f = instant(t.completedAt) ?: return@mapNotNull null
                    ((f - c) / CivilDate.MS_PER_DAY).coerceAtLeast(0.0)
                }
            val avg = if (durations.isEmpty()) 0.0 else durations.average()
            val label = if (durations.isEmpty()) "–" else "${oneDecimal(avg)} d (${durations.size})"
            BarDatum(p, Priority.label(p), round1(avg), label, Priority.color(p))
        }.toTypedArray()
}

private fun hoursLabel(h: Double): String = "${oneDecimal(h)} h"

/** Always one decimal ("2.0"); Kotlin/JS prints whole Doubles without a fraction ("2"). */
internal fun oneDecimal(v: Double): String {
    val tenths = kotlin.math.round(v * 10).toInt()
    return "${tenths / 10}.${kotlin.math.abs(tenths % 10)}"
}

/** Generic horizontal bar geometry; reuses the assignee-chart layout with arbitrary values and labels. */
@JsExport
fun buildHBars(
    data: Array<BarDatum>,
    width: Int,
): HBarChart {
    val left = 120
    val right = 70
    val top = 4
    val barHeight = 22
    val gap = 14
    val axis = 22
    val plotW = (width - left - right).toDouble()
    val maxValue = niceMax(kotlin.math.ceil(data.maxOfOrNull { it.value } ?: 0.0).toInt())
    val step = niceStep(maxValue)
    val rows =
        data
            .mapIndexed { i, d ->
                HBarRow(d.key, d.label, d.valueLabel, d.color, (top + i * (barHeight + gap)).toDouble(), plotW * d.value / maxValue)
            }.toTypedArray()
    val ticks = (0..maxValue step step).map { v -> AxisTick(left + plotW * v / maxValue, v.toString()) }.toTypedArray()
    val height = top + data.size * (barHeight + gap) - gap + axis + 8
    return HBarChart(width, height, left, right, barHeight, rows, ticks)
}

@JsExport
class HBarRow(
    val key: String,
    val label: String,
    val valueLabel: String,
    val color: String,
    val y: Double,
    val width: Double,
)

@JsExport
class HBarChart(
    val width: Int,
    val height: Int,
    val left: Int,
    val right: Int,
    val barHeight: Int,
    val rows: Array<HBarRow>,
    val xTicks: Array<AxisTick>,
)

// ---- CSV export ------------------------------------------------------------------------------------

private val CSV_HEADER =
    listOf(
        "id",
        "title",
        "status",
        "category",
        "priority",
        "project",
        "assignee",
        "tags",
        "dueDate",
        "estimateMinutes",
        "timeSpentMinutes",
        "recurrence",
        "blockedBy",
        "subtasksDone",
        "subtasksTotal",
        "createdAt",
        "completedAt",
        "description",
    )

/** RFC 4180 field quoting; cells starting with = + - @ are prefixed with ' to prevent spreadsheet formula injection. */
internal fun csvCell(value: String): String {
    val safe = if (value.isNotEmpty() && value[0] in "=+-@\t\r") "'$value" else value
    return if (safe.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) "\"${safe.replace("\"", "\"\"")}\"" else safe
}

/**
 * CSV of exactly the tasks matched by [query] in its sort order (all pages), with readable project/assignee
 * names. Lines end with CRLF as per RFC 4180.
 */
@JsExport
fun exportTasksCsv(
    state: AppState,
    query: TaskQuery,
    today: String,
): String {
    val day = parseDay(today) ?: Clock.today()
    val tasks = sortTasks(filterTasks(state, query, day), query.sort, query.dir)
    val statuses = StatusLookup(state)
    val lines = mutableListOf(CSV_HEADER.joinToString(","))
    for (t in tasks) {
        lines +=
            listOf(
                t.id,
                t.title,
                statuses.statusOf(t).name,
                t.category,
                t.priority,
                t.projectId?.let { projectPath(state, it) }.orEmpty(),
                state.findMember(t.assigneeId)?.name.orEmpty(),
                t.tags.joinToString(" "),
                t.dueDate.orEmpty(),
                t.estimateMinutes?.toString().orEmpty(),
                t.timeSpentMinutes.toString(),
                t.recurrence,
                t.blockedBy.joinToString(" "),
                t.subtasksDone.toString(),
                t.subtasks.size.toString(),
                t.createdAt,
                t.completedAt.orEmpty(),
                t.description,
            ).joinToString(",") { csvCell(it) }
    }
    return lines.joinToString("\r\n") + "\r\n"
}

/** Number of tasks [exportTasksCsv] would export. */
@JsExport
fun exportTaskCount(
    state: AppState,
    query: TaskQuery,
    today: String,
): Int = filterTasks(state, query, parseDay(today) ?: Clock.today()).size
