package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.H1
import org.jetbrains.compose.web.dom.H2
import org.jetbrains.compose.web.dom.Li
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Section
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.dom.Ul
import taskpilot.Dates
import taskpilot.Task
import taskpilot.completedPerDay
import taskpilot.computeKpis
import taskpilot.dueDay
import taskpilot.openByPriority
import taskpilot.openPerAssignee
import taskpilot.overdueTasks
import taskpilot.productivityStreak
import taskpilot.projectProgressWithDescendants
import taskpilot.upcomingDeadlines
import taskpilot.web.Store
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconView
import taskpilot.web.ui.Link
import taskpilot.web.ui.PriorityBadge

@Composable
fun DashboardPage() {
    val tasks = Store.tasks
    val projects = Store.projects
    val clock = Store.clock()
    val today = clock.today
    val kpis = remember(tasks, today) { computeKpis(tasks, clock) }
    val series = remember(tasks, today) { completedPerDay(tasks, clock, 30) }
    val byPriority = remember(tasks) { openByPriority(tasks) }
    // Top-level projects, each including its sub-projects.
    val progress = remember(tasks, projects) { projectProgressWithDescendants(tasks, projects, projects.filter { it.parentId == null }) }
    val upcoming = remember(tasks, today) { upcomingDeadlines(tasks, today, 8) }
    val overdue = remember(tasks, today) { overdueTasks(tasks, today, 8) }
    val streak = remember(tasks, today) { productivityStreak(tasks, clock) }
    val members = Store.members
    val perAssignee = remember(tasks, members) { openPerAssignee(tasks, members) }
    val (y, m, d) = Dates.civil(today)

    Div({ classes("page-header") }) {
        Div {
            H1 { Text("Dashboard") }
            P({ classes("subtitle") }) {
                Text("${Dates.WEEKDAY_SHORT[Dates.weekdayMonFirst(today)]}, ${Dates.MONTH_NAMES[m - 1]} $d, $y")
            }
        }
        Div({
            classes("streak")
            attr("data-testid", "streak")
            attr("title", "Consecutive days with at least one completed task")
        }) {
            IconView(Icon.Flame, 18)
            Span({ classes("streak-value") }) { Text(streak.toString()) }
            Span { Text(if (streak == 1) " day streak" else " day streak") }
        }
    }

    Section({
        classes("kpi-grid")
        attr("aria-label", "Key figures")
    }) {
        Kpi("kpi-total", "Total tasks", kpis.total.toString(), null)
        Kpi("kpi-open", "Open", kpis.open.toString(), "/tasks?status=todo,in_progress")
        Kpi("kpi-overdue", "Overdue", kpis.overdue.toString(), "/tasks?due=overdue", tone = if (kpis.overdue > 0) "danger" else null)
        Kpi("kpi-completed-7d", "Completed · 7 days", kpis.completed7d.toString(), null, tone = "success")
        Kpi("kpi-completion-rate", "Completion rate", "${kpis.completionRate}%", null)
        Kpi("kpi-hours", "Hours tracked", kpis.hoursTracked.toString(), null)
    }

    Div({ classes("dash-grid") }) {
        Section({ classes("card", "span-2") }) {
            CardHead("Completed per day", "Last 30 days")
            CompletedChart(series, today)
        }
        Section({ classes("card") }) {
            CardHead("Open tasks by priority", null)
            PriorityDonut(byPriority)
        }
        Section({ classes("card", "span-2") }) {
            CardHead("Open tasks per assignee", null)
            AssigneeBars(perAssignee)
        }
        Section({ classes("card") }) {
            CardHead("Project completion", null)
            ProjectBars(progress)
        }
        // Two equal-width lists fill the last row of the three-column grid.
        Div({ classes("dash-lists") }) {
            Section({ classes("card") }) {
                CardHead("Upcoming deadlines", "Next 7 days")
                TaskMiniList(upcoming, "Nothing due in the next 7 days.", today)
            }
            Section({ classes("card") }) {
                CardHead("Overdue", if (kpis.overdue > overdue.size) "Showing ${overdue.size} of ${kpis.overdue}" else null)
                TaskMiniList(overdue, "No overdue tasks. Nice!", today, overdueList = true)
                if (kpis.overdue > overdue.size) {
                    Link("/tasks?due=overdue", "see-all") { Text("See all overdue →") }
                }
            }
        }
    }
}

@Composable
private fun CardHead(title: String, sub: String?) {
    Div({ classes("card-head") }) {
        H2 { Text(title) }
        if (sub != null) Span({ classes("muted") }) { Text(sub) }
    }
}

@Composable
private fun Kpi(testId: String, label: String, value: String, href: String?, tone: String? = null) {
    val body: @Composable () -> Unit = {
        Div({ classes("kpi-label") }) { Text(label) }
        Div({
            classes("kpi-value")
            attr("data-testid", testId)
        }) { Text(value) }
    }
    if (href != null) {
        Link(href, "kpi kpi-link" + (tone?.let { " kpi-$it" } ?: "")) { body() }
    } else {
        Div({
            classes("kpi")
            tone?.let { classes("kpi-$it") }
        }) { body() }
    }
}

fun relativeDue(day: Int, today: Int): String {
    val diff = day - today
    return when {
        diff == 0 -> "Today"
        diff == 1 -> "Tomorrow"
        diff == -1 -> "Yesterday"
        diff < 0 -> "${-diff} days ago"
        diff < 7 -> "In $diff days"
        else -> Dates.shortLabel(day, Dates.civil(today).first)
    }
}

@Composable
private fun TaskMiniList(tasks: List<Task>, empty: String, today: Int, overdueList: Boolean = false) {
    if (tasks.isEmpty()) {
        P({ classes("muted", "mini-empty") }) { Text(empty) }
        return
    }
    Ul({ classes("mini-list") }) {
        tasks.forEach { t ->
            Li {
                Link("/tasks/${t.id}", "mini-item") {
                    Span({ classes("mini-title") }) { Text(t.title) }
                    Span({ classes("mini-meta") }) {
                        PriorityBadge(t.priority)
                        val dd = t.dueDay()
                        if (dd != null) {
                            Span({ classes("due", if (overdueList) "due-overdue" else "due-soon") }) { Text(relativeDue(dd, today)) }
                        }
                    }
                }
            }
        }
    }
}
