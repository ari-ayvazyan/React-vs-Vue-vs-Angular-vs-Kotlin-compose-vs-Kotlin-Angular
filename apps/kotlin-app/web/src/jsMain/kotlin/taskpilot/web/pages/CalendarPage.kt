package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import org.jetbrains.compose.web.attributes.forId
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.H1
import org.jetbrains.compose.web.dom.H2
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import taskpilot.Dates
import taskpilot.Status
import taskpilot.Task
import taskpilot.matchesAssignee
import taskpilot.monthGrid
import taskpilot.shiftMonth
import taskpilot.tasksByDueDay
import taskpilot.web.Router
import taskpilot.web.Store
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconButton
import taskpilot.web.ui.Link
import taskpilot.web.ui.SelectField
import taskpilot.web.ui.assigneeFilterOptions

@Composable
fun CalendarPage() {
    val today = Store.clock().today
    val (ty, tm, _) = Dates.civil(today)
    var ym by remember { mutableStateOf(ty to tm) }
    var expanded by remember { mutableStateOf(setOf<Int>()) }
    val (year, month) = ym
    val grid = remember(year, month) { monthGrid(year, month) }
    val assigneeFilter = Router.params()["assignee"]
    val byDay = remember(Store.tasks, assigneeFilter) { tasksByDueDay(Store.tasks.filter { it.matchesAssignee(assigneeFilter) }) }
    val monthTitle = "${Dates.MONTH_NAMES[month - 1]} $year"

    Div({ classes("page-header") }) {
        Div { H1 { Text("Calendar") } }
        Div({ classes("lsel") }) {
            Label(forId = "calendar-assignee") { Text("Assignee") }
            SelectField(assigneeFilter ?: "", assigneeFilterOptions(), { v ->
                Router.navigate(Router.buildUrl("/calendar", if (v.isEmpty()) emptyList() else listOf("assignee" to v)), replace = true)
            }) {
                id("calendar-assignee")
                attr("data-testid", "calendar-assignee-filter")
            }
        }
        Div({ classes("cal-nav") }) {
            IconButton(Icon.ChevronLeft, "Previous month", testId = "calendar-prev") {
                ym = shiftMonth(year, month, -1)
                expanded = emptySet()
            }
            H2({
                classes("cal-title")
                attr("aria-live", "polite")
                attr("data-testid", "calendar-title")
            }) { Text(monthTitle) }
            IconButton(Icon.ChevronRight, "Next month", testId = "calendar-next") {
                ym = shiftMonth(year, month, 1)
                expanded = emptySet()
            }
            Button({
                classes("btn", "btn-sm")
                attr("type", "button")
                attr("data-testid", "calendar-today")
                onClick {
                    ym = ty to tm
                    expanded = emptySet()
                }
            }) { Text("Today") }
        }
    }

    Div({
        classes("calendar")
        attr("data-testid", "calendar-grid")
        attr("role", "grid")
        attr("aria-label", monthTitle)
    }) {
        Div({
            classes("cal-row", "cal-head")
            attr("role", "row")
        }) {
            Dates.WEEKDAY_SHORT.forEach { d ->
                Div({
                    classes("cal-weekday")
                    attr("role", "columnheader")
                }) { Text(d) }
            }
        }
        grid.days.chunked(7).forEach { week ->
            Div({
                classes("cal-row")
                attr("role", "row")
            }) {
                week.forEach { day ->
                    DayCell(day, grid.inMonth(day), day == today, byDay[day].orEmpty(), day in expanded) {
                        expanded =
                            expanded + day
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(day: Int, inMonth: Boolean, isToday: Boolean, tasks: List<Task>, isExpanded: Boolean, onExpand: () -> Unit) {
    val (_, _, d) = Dates.civil(day)
    Div({
        classes("cal-cell")
        if (!inMonth) classes("outside")
        if (isToday) classes("today")
        attr("role", "gridcell")
        attr("data-date", Dates.format(day))
        if (isToday) attr("aria-current", "date")
    }) {
        Div({ classes("cal-cell-head") }) {
            Span({ classes("cal-day-num") }) { Text(d.toString()) }
            Button({
                classes("cal-add")
                attr("type", "button")
                attr("aria-label", "Add task due ${Dates.format(day)}")
                attr("title", "Add task")
                onClick {
                    Store.openNewTask(Task(id = "", title = "", dueDate = Dates.format(day), createdAt = ""))
                }
            }) { Text("+") }
        }
        val shown = if (isExpanded) tasks else tasks.take(3)
        shown.forEach { t ->
            Link("/tasks/${t.id}", "cal-task prio-edge-${t.priority.key}" + if (t.status == Status.DONE) " done" else "") {
                Text(t.title)
            }
        }
        if (!isExpanded && tasks.size > 3) {
            Button({
                classes("cal-more")
                attr("type", "button")
                attr("aria-label", "Show ${tasks.size - 3} more tasks on ${Dates.format(day)}")
                onClick { onExpand() }
            }) {
                Text("+${tasks.size - 3}")
                Span({ classes("more-word") }) { Text(" more") }
            }
        }
    }
}
