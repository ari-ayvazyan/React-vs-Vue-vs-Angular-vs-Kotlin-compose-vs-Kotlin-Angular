package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import org.jetbrains.compose.web.attributes.InputType
import org.jetbrains.compose.web.attributes.forId
import org.jetbrains.compose.web.attributes.onSubmit
import org.jetbrains.compose.web.attributes.placeholder
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.CheckboxInput
import org.jetbrains.compose.web.dom.DDescription
import org.jetbrains.compose.web.dom.DList
import org.jetbrains.compose.web.dom.DTerm
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.Form
import org.jetbrains.compose.web.dom.H1
import org.jetbrains.compose.web.dom.H2
import org.jetbrains.compose.web.dom.Input
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Li
import org.jetbrains.compose.web.dom.Nav
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Section
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.dom.Ul
import org.jetbrains.compose.web.svg.Circle
import org.jetbrains.compose.web.svg.Svg
import taskpilot.Dates
import taskpilot.Recurrence
import taskpilot.Status
import taskpilot.Subtask
import taskpilot.Task
import taskpilot.isOverdue
import taskpilot.newId
import taskpilot.web.Pomodoro
import taskpilot.web.Router
import taskpilot.web.Store
import taskpilot.web.ui.Avatar
import taskpilot.web.ui.BlockedBadge
import taskpilot.web.ui.EmptyState
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconButton
import taskpilot.web.ui.IconView
import taskpilot.web.ui.Link
import taskpilot.web.ui.PriorityBadge
import taskpilot.web.ui.ProjectChip
import taskpilot.web.ui.RecurrenceIcon
import taskpilot.web.ui.StatusBadge
import taskpilot.web.ui.TaskForm
import taskpilot.web.ui.formatMinutes

@Composable
fun TaskDetailPage(id: String) {
    val task = Store.task(id)
    Nav({
        classes("breadcrumb")
        attr("aria-label", "Breadcrumb")
    }) {
        Link("/tasks") { Text("Tasks") }
        Span({ attr("aria-hidden", "true") }) { Text(" / ") }
        Span({ attr("aria-current", "page") }) { Text(task?.title ?: "Not found") }
    }
    if (task == null) {
        EmptyState("Task not found", "It may have been deleted, or the link is wrong.") {
            Link("/tasks", "btn") { Text("Back to tasks") }
        }
        return
    }
    val today = Store.clock().today
    Div({ classes("page-header") }) {
        Div {
            H1({ classes("detail-title") }) { Text(task.title) }
            Div({ classes("detail-meta") }) {
                StatusBadge(task)
                PriorityBadge(task.priority)
                ProjectChip(Store.project(task.projectId))
                Span({ classes("assignee") }) {
                    val member = Store.member(task.assigneeId)
                    Avatar(member)
                    Span { Text(member?.name ?: "Unassigned") }
                }
                if (task.recurrence != Recurrence.NONE) {
                    Span({ classes("chip", "chip-muted") }) {
                        RecurrenceIcon(task.recurrence)
                        Text(task.recurrence.label)
                    }
                }
                val blockers = Store.openBlockersOf(task.id)
                if (task.status != Status.DONE && blockers.isNotEmpty()) BlockedBadge(blockers)
                if (task.isOverdue(today)) {
                    Span({ classes("badge", "badge-danger") }) {
                        IconView(Icon.Alert, 12)
                        Text("Overdue")
                    }
                }
            }
        }
        Div({ classes("header-actions") }) {
            Button({
                classes("btn")
                attr("type", "button")
                onClick { Store.toggleDone(task.id) }
            }) {
                IconView(Icon.Check, 16)
                Text(if (task.status == Status.DONE) "Reopen" else "Mark done")
            }
            Button({
                classes("btn", "btn-danger")
                attr("type", "button")
                attr("data-testid", "delete-task")
                onClick {
                    Store.deleteTasks(listOf(task.id))
                    Router.navigate("/tasks")
                }
            }) {
                IconView(Icon.Trash, 16)
                Text("Delete")
            }
        }
    }
    Div({ classes("detail-grid") }) {
        Div({ classes("detail-main") }) {
            Section({ classes("card") }) {
                Div({ classes("card-head") }) { H2 { Text("Details") } }
                TaskForm(task, "Save changes", onSave = { r ->
                    Store.saveTask(task.id, r.draft, r.fields)
                    Store.toast("Changes saved", tone = "success")
                })
            }
            SubtasksCard(task)
            CommentsCard(task)
            TaskActivityCard(task)
        }
        Div({ classes("detail-side") }) {
            PomodoroCard(task)
            DependenciesCard(task)
            Section({ classes("card") }) {
                Div({ classes("card-head") }) { H2 { Text("Time") } }
                val est = task.estimateMinutes
                Div({ classes("time-stat") }) {
                    Span({ classes("time-big") }) { Text(formatMinutes(task.timeSpentMinutes)) }
                    Span({ classes("muted") }) { Text(if (est != null) " of ${formatMinutes(est)} estimated" else " tracked") }
                }
                if (est != null) {
                    val pct = (task.timeSpentMinutes * 100 / est).coerceAtMost(100)
                    Div({
                        classes("progress")
                        if (task.timeSpentMinutes > est) classes("over")
                        attr("role", "progressbar")
                        attr("aria-label", "Time spent versus estimate")
                        attr("aria-valuenow", pct.toString())
                        attr("aria-valuemin", "0")
                        attr("aria-valuemax", "100")
                    }) {
                        Div({
                            classes("progress-fill")
                            style { property("width", "$pct%") }
                        })
                    }
                }
                DList({ classes("meta-list") }) {
                    DTerm { Text("Created") }
                    DDescription { Text(formatIso(task.createdAt)) }
                    DTerm { Text("Completed") }
                    DDescription { Text(task.completedAt?.let { formatIso(it) } ?: "—") }
                    DTerm { Text("Due") }
                    DDescription {
                        Text(task.dueDate?.let { Dates.parse(it) }?.let { relativeDue(it, today) + " (${task.dueDate})" } ?: "No due date")
                    }
                }
            }
        }
    }
}

private fun formatIso(iso: String): String {
    val clock = Store.clock()
    val day = clock.localDay(iso) ?: return iso
    return Dates.shortLabel(day, Dates.civil(clock.today).first) + ", " + Dates.civil(day).first
}

@Composable
private fun SubtasksCard(task: Task) {
    var newTitle by remember(task.id) { mutableStateOf("") }
    var error by remember(task.id) { mutableStateOf<String?>(null) }
    val done = task.subtasks.count { it.done }
    Section({ classes("card") }) {
        Div({ classes("card-head") }) {
            H2 { Text("Subtasks") }
            Span({ classes("muted") }) { Text("$done of ${task.subtasks.size} done") }
        }
        if (task.subtasks.isNotEmpty()) {
            Div({
                classes("progress", "thin")
                attr("aria-hidden", "true")
            }) {
                Div({
                    classes("progress-fill")
                    style { property("width", "${done * 100 / task.subtasks.size}%") }
                })
            }
        }
        Ul({ classes("subtasks") }) {
            task.subtasks.forEach { s ->
                Li({
                    classes("subtask")
                    if (s.done) classes("done")
                }) {
                    Label {
                        CheckboxInput(s.done) {
                            onChange { e ->
                                Store.updateTask(task.id) { t ->
                                    t.copy(
                                        subtasks =
                                            t.subtasks.map {
                                                if (it.id ==
                                                    s.id
                                                ) {
                                                    it.copy(done = e.value)
                                                } else {
                                                    it
                                                }
                                            },
                                    )
                                }
                            }
                        }
                        Span { Text(s.title) }
                    }
                    IconButton(Icon.Trash, "Delete subtask ${s.title}", extraClass = "subtle") {
                        Store.updateTask(task.id) { t -> t.copy(subtasks = t.subtasks.filterNot { it.id == s.id }) }
                    }
                }
            }
        }
        Form(attrs = {
            classes("subtask-form")
            onSubmit { e ->
                e.preventDefault()
                val title = newTitle.trim()
                if (title.isEmpty()) {
                    error = "Enter a subtask title."
                    return@onSubmit
                }
                if (title.length > 120) {
                    error = "Subtask title must be at most 120 characters."
                    return@onSubmit
                }
                error = null
                Store.updateTask(task.id) { t -> t.copy(subtasks = t.subtasks + Subtask(newId("sub"), title, false)) }
                newTitle = ""
            }
        }) {
            Label(forId = "new-subtask", attrs = { classes("sr-only") }) { Text("New subtask") }
            Input(InputType.Text) {
                id("new-subtask")
                placeholder("Add a subtask…")
                value(newTitle)
                if (error != null) {
                    attr("aria-invalid", "true")
                    attr("aria-describedby", "new-subtask-error")
                }
                onInput {
                    newTitle = it.value
                    error = null
                }
            }
            Button({
                classes("btn")
                attr("type", "submit")
            }) {
                IconView(Icon.Plus, 16)
                Text("Add")
            }
        }
        error?.let {
            P({
                classes("field-error")
                id("new-subtask-error")
                attr("role", "alert")
            }) { Text(it) }
        }
    }
}

@Composable
private fun PomodoroCard(task: Task) {
    val mine = Pomodoro.isFor(task.id)
    val running = mine && Pomodoro.running
    val total = if (mine) Pomodoro.durationMs else Store.settings.pomodoroMinutes * 60_000L
    val remaining = if (mine) Pomodoro.remainingMs() else total
    val fraction = if (total > 0) remaining.toDouble() / total else 0.0
    Section({
        classes("card", "pomodoro")
        if (running) classes("running")
        attr("data-testid", "pomodoro")
    }) {
        Div({ classes("card-head") }) {
            H2 { Text("Pomodoro") }
            Span({ classes("muted") }) { Text("${total / 60_000} min focus") }
        }
        Div({ classes("pomo-dial") }) {
            PomodoroRing(fraction)
            Div({
                classes("pomo-time")
                attr("role", "timer")
                attr("aria-live", "off")
                attr("data-testid", "pomodoro-time")
            }) { Text(Pomodoro.format(remaining)) }
        }
        if (!mine && Pomodoro.taskId != null && Pomodoro.running) {
            P({ classes("muted", "small") }) { Text("Another task's timer is running; starting here will stop it.") }
        }
        Div({ classes("pomo-controls") }) {
            if (running) {
                Button({
                    classes("btn", "btn-primary")
                    attr("type", "button")
                    attr("data-testid", "pomodoro-pause")
                    onClick { Pomodoro.pause() }
                }) {
                    IconView(Icon.Pause, 16)
                    Text("Pause")
                }
            } else {
                Button({
                    classes("btn", "btn-primary")
                    attr("type", "button")
                    attr("data-testid", "pomodoro-start")
                    onClick { Pomodoro.start(task.id) }
                }) {
                    IconView(Icon.Play, 16)
                    Text(if (mine && remaining < total) "Resume" else "Start")
                }
            }
            Button({
                classes("btn")
                attr("type", "button")
                attr("data-testid", "pomodoro-reset")
                if (!mine) attr("disabled", "")
                onClick { Pomodoro.reset() }
            }) {
                IconView(Icon.Reset, 16)
                Text("Reset")
            }
        }
    }
}

@Composable
private fun PomodoroRing(fraction: Double) {
    val r = 52.0
    val c = 2 * kotlin.math.PI * r
    Svg(viewBox = "0 0 120 120", attrs = {
        classes("pomo-ring")
        attr("aria-hidden", "true")
    }) {
        Circle(60, 60, r, { classes("ring-track") })
        Circle(60, 60, r, {
            classes("ring-fill")
            attr("stroke-dasharray", "$c $c")
            attr("stroke-dashoffset", (c * (1 - fraction)).toString())
            attr("transform", "rotate(-90 60 60)")
        })
    }
}
