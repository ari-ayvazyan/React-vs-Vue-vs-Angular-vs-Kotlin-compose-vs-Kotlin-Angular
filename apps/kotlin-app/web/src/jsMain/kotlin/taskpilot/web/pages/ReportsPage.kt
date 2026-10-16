package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import org.jetbrains.compose.web.attributes.forId
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.H1
import org.jetbrains.compose.web.dom.H2
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Section
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.svg.Circle
import org.jetbrains.compose.web.svg.G
import org.jetbrains.compose.web.svg.Line
import org.jetbrains.compose.web.svg.Rect
import org.jetbrains.compose.web.svg.Svg
import org.jetbrains.compose.web.svg.SvgText
import org.jetbrains.compose.web.svg.Title
import taskpilot.CycleTime
import taskpilot.NO_PROJECT
import taskpilot.Workload
import taskpilot.burndown
import taskpilot.cycleTimeByPriority
import taskpilot.initials
import taskpilot.readableTextColor
import taskpilot.web.Router
import taskpilot.web.Store
import taskpilot.web.ui.SelectField
import taskpilot.web.ui.projectOptions
import taskpilot.workloadPerAssignee
import kotlin.math.ceil
import kotlin.math.max

private const val ALL_PROJECTS = "all"

private fun fmt(v: Double): String {
    val r = kotlin.math.round(v * 10) / 10
    return if (r == kotlin.math.floor(r)) r.toLong().toString() else r.toString()
}

/** `/reports`: burndown per project, workload per assignee and cycle time by priority. */
@Composable
fun ReportsPage() {
    val params = Router.params()
    val projects = Store.projects
    val selected = params["project"] ?: projects.firstOrNull()?.id ?: ALL_PROJECTS
    val projectId = if (selected == ALL_PROJECTS) null else selected
    val tasks = Store.tasks
    val clock = Store.clock()
    val today = clock.today
    val series = remember(tasks, projects, projectId, today) { burndown(tasks, clock, projectId, projects = projects) }
    val workload = remember(tasks, Store.members) { workloadPerAssignee(tasks, Store.members) }
    val cycle = remember(tasks) { cycleTimeByPriority(tasks) }
    val projectName =
        when (projectId) {
            null -> "All projects"
            NO_PROJECT -> "No project"
            else -> Store.project(projectId)?.name ?: "Removed project"
        }

    Div({ classes("page-header") }) {
        Div {
            H1 { Text("Reports") }
            P({ classes("subtitle") }) { Text("Progress, workload and speed, computed from your local data.") }
        }
    }
    Div({ classes("reports-grid") }) {
        Section({ classes("card", "span-2") }) {
            Div({ classes("card-head") }) {
                Div {
                    H2 { Text("Burndown · $projectName") }
                    Span({ classes("muted", "small") }) {
                        val first = series.firstOrNull()?.second ?: 0
                        val last = series.lastOrNull()?.second ?: 0
                        Text("Open tasks per day, last 30 days: $first → $last")
                    }
                }
                Div({ classes("lsel", "lsel-inline") }) {
                    Label(forId = "burndown-project") { Text("Project") }
                    SelectField(
                        selected,
                        projectOptions() + (NO_PROJECT to "No project") + (ALL_PROJECTS to "All projects"),
                        { v -> Router.navigate(Router.buildUrl("/reports", listOf("project" to v)), replace = true) },
                    ) {
                        id("burndown-project")
                        attr("data-testid", "burndown-project")
                    }
                }
            }
            LineChart(
                series,
                today,
                testId = "chart-burndown",
                valueLabel = { "$it open" },
                ariaLabel = { n, _, peak ->
                    "Open tasks per day in $projectName over the last $n days, from ${series.firstOrNull()?.second ?: 0} " +
                        "to ${series.lastOrNull()?.second ?: 0}, peak $peak."
                },
            )
        }
        Section({ classes("card") }) {
            Div({ classes("card-head") }) {
                H2 { Text("Workload") }
                Span({ classes("muted", "small") }) { Text("Estimated hours of open tasks") }
            }
            WorkloadChart(workload)
        }
        Section({ classes("card") }) {
            Div({ classes("card-head") }) {
                H2 { Text("Average cycle time") }
                Span({ classes("muted", "small") }) { Text("Created → completed, by priority") }
            }
            CycleTimeChart(cycle)
        }
    }
}

@Composable
private fun WorkloadChart(items: List<Workload>) {
    val rowH = 40.0
    val labelW = 150.0
    val valueW = 70.0
    val width = 520.0
    val height = max(rowH, items.size * rowH) + 4
    val maxH = max(1.0, items.maxOfOrNull { it.hours } ?: 0.0)
    val trackW = width - labelW - valueW
    Div({
        classes("chart-wrap")
        attr("data-testid", "chart-workload")
    }) {
        if (items.isEmpty()) {
            P({ classes("muted") }) { Text("No team members yet.") }
            return@Div
        }
        Svg(viewBox = "0 0 ${width.toInt()} ${height.toInt()}", attrs = {
            classes("chart-svg", "assignee-svg")
            attr("role", "img")
            attr(
                "aria-label",
                "Open estimated hours per assignee: " +
                    items.joinToString(", ") { "${it.member?.name ?: "Unassigned"} ${fmt(it.hours)} hours" },
            )
        }) {
            items.forEachIndexed { i, w ->
                val cy = i * rowH + 2 + rowH / 2
                val color = w.member?.color ?: "var(--text-muted)"
                G({
                    classes("assignee-row")
                    attr("data-testid", "workload-row")
                }) {
                    Circle(14, cy, 12, {
                        classes("avatar-dot")
                        style { property("fill", color) }
                    })
                    SvgText(w.member?.let { initials(it.name) } ?: "–", 14, cy + 4, {
                        classes("avatar-dot-text")
                        style { property("fill", w.member?.let { readableTextColor(it.color) } ?: "var(--surface)") }
                    })
                    SvgText(w.member?.name ?: "Unassigned", 34, cy + 4, { classes("bar-label") })
                    Rect(labelW, cy - 7, trackW, 14, {
                        classes("bar-track")
                        attr("rx", "7")
                    })
                    if (w.minutes > 0) {
                        Rect(labelW, cy - 7, max(4.0, trackW * w.hours / maxH), 14, {
                            classes("bar-fill")
                            attr("rx", "7")
                            style { property("fill", color) }
                        })
                    }
                    SvgText("${fmt(w.hours)} h", width - 4, cy + 4, {
                        classes("bar-value")
                        attr("text-anchor", "end")
                    })
                    Title(
                        "${w.member?.name ?: "Unassigned"}: ${fmt(w.hours)} h across ${w.openTasks} open tasks" +
                            if (w.unestimated > 0) " (${w.unestimated} without estimate)" else "",
                    )
                }
            }
        }
    }
}

@Composable
private fun CycleTimeChart(items: List<CycleTime>) {
    val width = 420.0
    val height = 240.0
    val padL = 36.0
    val padB = 42.0
    val padT = 22.0
    val plotH = height - padT - padB
    val maxV = items.mapNotNull { it.averageDays }.maxOrNull() ?: 0.0
    val step = max(1.0, ceil(maxV / 4.0))
    val yMax = step * 4
    val slot = (width - padL - 10) / items.size

    fun y(v: Double) = padT + plotH - v / yMax * plotH
    Div({
        classes("chart-wrap")
        attr("data-testid", "chart-cycle-time")
    }) {
        Svg(viewBox = "0 0 ${width.toInt()} ${height.toInt()}", attrs = {
            classes("chart-svg")
            attr("role", "img")
            attr(
                "aria-label",
                "Average cycle time in days by priority: " +
                    items.joinToString(", ") { "${it.priority.label} ${it.averageDays?.let(::fmt) ?: "no data"}" },
            )
        }) {
            for (k in 0..4) {
                val v = step * k
                Line(padL, y(v), width - 10, y(v), { classes("grid-line") })
                SvgText(fmt(v), padL - 8, y(v) + 4, { classes("axis-label", "axis-y") })
            }
            items.forEachIndexed { i, c ->
                val cx = padL + slot * i + slot / 2
                val barW = slot * 0.55
                G({ attr("data-testid", "cycle-bar") }) {
                    val avg = c.averageDays
                    if (avg != null) {
                        Rect(cx - barW / 2, y(avg), barW, max(1.0, padT + plotH - y(avg)), {
                            classes("cycle-bar")
                            attr("rx", "4")
                            style { property("fill", PRIORITY_COLOR_VARS.getValue(c.priority)) }
                        })
                        SvgText("${fmt(avg)} d", cx, y(avg) - 6, {
                            classes("bar-value-top")
                            attr("text-anchor", "middle")
                        })
                    } else {
                        SvgText("–", cx, padT + plotH - 6, {
                            classes("axis-label")
                            attr("text-anchor", "middle")
                        })
                    }
                    SvgText(c.priority.label, cx, height - 22, {
                        classes("axis-label", "axis-strong")
                        attr("text-anchor", "middle")
                    })
                    SvgText("n = ${c.count}", cx, height - 6, {
                        classes("axis-label")
                        attr("text-anchor", "middle")
                    })
                }
            }
        }
    }
}
