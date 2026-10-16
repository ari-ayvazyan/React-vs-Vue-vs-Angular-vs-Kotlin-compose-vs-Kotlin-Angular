package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.Li
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.dom.Ul
import org.jetbrains.compose.web.svg.Circle
import org.jetbrains.compose.web.svg.G
import org.jetbrains.compose.web.svg.Line
import org.jetbrains.compose.web.svg.Path
import org.jetbrains.compose.web.svg.Rect
import org.jetbrains.compose.web.svg.Svg
import org.jetbrains.compose.web.svg.SvgText
import taskpilot.Dates
import taskpilot.Priority
import taskpilot.ProjectProgress
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.max

private const val W = 640.0
private const val H = 240.0
private const val PAD_L = 34.0
private const val PAD_R = 14.0
private const val PAD_T = 14.0
private const val PAD_B = 30.0

private fun Double.f(): String {
    val r = kotlin.math.round(this * 10) / 10
    return if (r == kotlin.math.floor(r)) r.toLong().toString() else r.toString()
}

/** Area/line chart of completions per day with axis labels, gridlines and a hover/keyboard tooltip. */
@Composable
fun CompletedChart(series: List<Pair<Int, Int>>, today: Int) =
    LineChart(
        series,
        today,
        testId = "chart-completed",
        valueLabel = { "$it completed" },
        ariaLabel = { n, total, peak -> "Tasks completed per day over the last $n days: $total in total, peak $peak per day." },
    )

/**
 * Hand-written SVG area/line chart for a daily series with axis labels, gridlines and a
 * hover/keyboard tooltip.
 */
@Composable
fun LineChart(
    series: List<Pair<Int, Int>>,
    today: Int,
    testId: String,
    valueLabel: (Int) -> String,
    ariaLabel: (days: Int, total: Int, peak: Int) -> String,
) {
    var hover by remember { mutableStateOf<Int?>(null) }
    val n = series.size
    val maxCount = series.maxOfOrNull { it.second } ?: 0
    val step = max(1, ceil(maxCount / 4.0).toInt())
    val yMax = step * 4.0
    val plotW = W - PAD_L - PAD_R
    val plotH = H - PAD_T - PAD_B

    fun x(i: Int) = PAD_L + if (n <= 1) 0.0 else i * plotW / (n - 1)

    fun y(v: Int) = PAD_T + plotH - (v / yMax) * plotH
    val total = series.sumOf { it.second }
    val currentYear = Dates.civil(today).first

    Div({
        classes("chart-wrap")
        attr("data-testid", testId)
        onMouseLeave { hover = null }
    }) {
        Svg(viewBox = "0 0 ${W.toInt()} ${H.toInt()}", attrs = {
            classes("chart-svg")
            attr("role", "img")
            attr("tabindex", "0")
            attr(
                "aria-label",
                ariaLabel(n, total, maxCount) + " Use left and right arrow keys to inspect days.",
            )
            onKeyDown { e ->
                when (e.key) {
                    "ArrowLeft" -> {
                        e.preventDefault()
                        hover = ((hover ?: n) - 1).coerceIn(0, n - 1)
                    }
                    "ArrowRight" -> {
                        e.preventDefault()
                        hover = ((hover ?: -1) + 1).coerceIn(0, n - 1)
                    }
                    "Escape" -> hover = null
                }
            }
            onBlur { hover = null }
        }) {
            // Gridlines + y labels
            for (k in 0..4) {
                val v = step * k
                val yy = y(v)
                Line(PAD_L, yy, W - PAD_R, yy, { classes("grid-line") })
                SvgText(v.toString(), PAD_L - 8, yy + 4, { classes("axis-label", "axis-y") })
            }
            // X labels every 5 days + last
            series.forEachIndexed { i, (day, _) ->
                if (i % 5 == 0 || i == n - 1) {
                    SvgText(Dates.shortLabel(day, currentYear), x(i), H - 8, {
                        classes("axis-label")
                        attr(
                            "text-anchor",
                            if (i == 0) {
                                "start"
                            } else if (i == n - 1) {
                                "end"
                            } else {
                                "middle"
                            },
                        )
                    })
                }
            }
            if (n > 0) {
                val line = series.mapIndexed { i, (_, c) -> "${if (i == 0) "M" else "L"}${x(i).f()},${y(c).f()}" }.joinToString(" ")
                val area = "$line L${x(n - 1).f()},${y(0).f()} L${x(0).f()},${y(0).f()} Z"
                Path(area, { classes("chart-area") })
                Path(line, { classes("chart-line") })
            }
            hover?.let { i ->
                Line(x(i), PAD_T, x(i), PAD_T + plotH, { classes("hover-line") })
                Circle(x(i), y(series[i].second), 5, { classes("hover-dot") })
            }
            // Invisible hit areas
            G {
                val band = if (n <= 1) plotW else plotW / (n - 1)
                series.forEachIndexed { i, _ ->
                    Rect(x(i) - band / 2, PAD_T, band, plotH, {
                        classes("hit")
                        onMouseEnter { hover = i }
                        onMouseMove { if (hover != i) hover = i }
                    })
                }
            }
        }
        hover?.let { i ->
            val (day, count) = series[i]
            Div({
                classes("chart-tooltip")
                attr("role", "status")
                style {
                    property("left", "${(x(i) / W * 100).f()}%")
                    property("top", "${(y(count) / H * 100).f()}%")
                }
            }) {
                Div({ classes("tt-title") }) { Text(Dates.shortLabel(day, currentYear)) }
                Div { Text(valueLabel(count)) }
            }
        }
    }
}

val PRIORITY_COLOR_VARS =
    mapOf(
        Priority.URGENT to "var(--prio-urgent)",
        Priority.HIGH to "var(--prio-high)",
        Priority.MEDIUM to "var(--prio-medium)",
        Priority.LOW to "var(--prio-low)",
    )

/** Donut of open tasks by priority, with legend. */
@Composable
fun PriorityDonut(data: Map<Priority, Int>) {
    val total = data.values.sum()
    val r = 70.0
    val c = 2 * PI * r
    Div({
        classes("donut-wrap")
        attr("data-testid", "chart-priority")
    }) {
        Svg(viewBox = "0 0 200 200", attrs = {
            classes("donut-svg")
            attr("role", "img")
            attr("aria-label", "Open tasks by priority: " + data.entries.joinToString(", ") { "${it.key.label} ${it.value}" })
        }) {
            Circle(100, 100, r, { classes("donut-track") })
            var offset = 0.0
            G({ attr("transform", "rotate(-90 100 100)") }) {
                data.forEach { (p, count) ->
                    if (count > 0 && total > 0) {
                        val len = c * count / total
                        val gap = if (data.values.count { it > 0 } > 1) 2.0 else 0.0
                        val dash = (len - gap).coerceAtLeast(0.5)
                        val o = offset
                        Circle(100, 100, r, {
                            classes("donut-seg")
                            style {
                                property("stroke", PRIORITY_COLOR_VARS.getValue(p))
                            }
                            attr("stroke-dasharray", "${dash.f()} ${(c - dash).f()}")
                            attr("stroke-dashoffset", (-o).f())
                        })
                        offset += len
                    }
                }
            }
            SvgText(total.toString(), 100, 100, { classes("donut-total") })
            SvgText("open", 100, 122, { classes("donut-caption") })
        }
        Ul({ classes("legend") }) {
            data.forEach { (p, count) ->
                Li {
                    Span({
                        classes("legend-swatch")
                        style { property("background", PRIORITY_COLOR_VARS.getValue(p)) }
                    })
                    Span({ classes("legend-label") }) { Text(p.label) }
                    Span({ classes("legend-value") }) {
                        Text("$count")
                        if (total > 0) Span({ classes("muted") }) { Text(" · ${(count * 100.0 / total).f()}%") }
                    }
                }
            }
        }
    }
}

/** Horizontal bars: completion % per project. */
@Composable
fun ProjectBars(items: List<ProjectProgress>) {
    Div({
        classes("hbars")
        attr("data-testid", "chart-projects")
        attr("role", "list")
    }) {
        if (items.isEmpty()) Div({ classes("muted") }) { Text("No projects yet.") }
        items.forEach { p ->
            Div({
                classes("hbar-row")
                attr("role", "listitem")
                attr("aria-label", "${p.project.name}: ${p.percent}% complete, ${p.done} of ${p.total} tasks")
            }) {
                Div({ classes("hbar-label") }) {
                    Span({
                        classes("dot")
                        style { property("background", p.project.color) }
                    })
                    Span({ classes("hbar-name") }) { Text(p.project.name) }
                }
                Div({ classes("hbar-track") }) {
                    Div({
                        classes("hbar-fill")
                        style {
                            property("width", "${p.percent}%")
                            property("background", p.project.color)
                        }
                    })
                }
                Div({ classes("hbar-value") }) {
                    Text("${p.percent}%")
                    Span({ classes("muted") }) { Text(" ${p.done}/${p.total}") }
                }
            }
        }
    }
}

/** Hand-drawn SVG horizontal bar chart: open tasks per assignee (plus "Unassigned"). */
@Composable
fun AssigneeBars(items: List<taskpilot.AssigneeLoad>) {
    val rowH = 38.0
    val labelW = 170.0
    val valueW = 44.0
    val width = 640.0
    val height = max(rowH, items.size * rowH) + 4
    val maxOpen = max(1, items.maxOfOrNull { it.open } ?: 0)
    val trackW = width - labelW - valueW
    Div({
        classes("chart-wrap")
        attr("data-testid", "chart-assignees")
    }) {
        if (items.isEmpty()) {
            Div({ classes("muted") }) { Text("No team members yet. Add them in Settings.") }
            return@Div
        }
        Svg(viewBox = "0 0 ${width.toInt()} ${height.toInt()}", attrs = {
            classes("chart-svg", "assignee-svg")
            attr("role", "img")
            attr(
                "aria-label",
                "Open tasks per assignee: " + items.joinToString(", ") { "${it.member?.name ?: "Unassigned"} ${it.open}" },
            )
        }) {
            items.forEachIndexed { i, load ->
                val y = i * rowH + 2
                val cy = y + rowH / 2
                val color = load.member?.color ?: "var(--text-muted)"
                G({ classes("assignee-row") }) {
                    Circle(14, cy, 12, {
                        classes("avatar-dot")
                        style { property("fill", color) }
                    })
                    SvgText(load.member?.let { taskpilot.initials(it.name) } ?: "–", 14, cy + 4, {
                        classes("avatar-dot-text")
                        style { property("fill", load.member?.let { taskpilot.readableTextColor(it.color) } ?: "var(--surface)") }
                    })
                    SvgText(load.member?.name ?: "Unassigned", 34, cy + 4, { classes("bar-label") })
                    Rect(labelW, cy - 7, trackW, 14, {
                        classes("bar-track")
                        attr("rx", "7")
                    })
                    val w = trackW * load.open / maxOpen
                    if (load.open > 0) {
                        Rect(labelW, cy - 7, max(w, 4.0), 14, {
                            classes("bar-fill")
                            attr("rx", "7")
                            style { property("fill", color) }
                        })
                    }
                    SvgText(load.open.toString(), width - 4, cy + 4, {
                        classes("bar-value")
                        attr("text-anchor", "end")
                    })
                }
            }
        }
    }
}
