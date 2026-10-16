package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.web.events.SyntheticDragEvent
import kotlinx.browser.document
import org.jetbrains.compose.web.attributes.Draggable
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.H1
import org.jetbrains.compose.web.dom.H2
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Section
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.w3c.dom.HTMLElement
import org.w3c.dom.asList
import taskpilot.BlockedCompletion
import taskpilot.DEFAULT_WORKFLOW
import taskpilot.Dates
import taskpilot.NO_PROJECT
import taskpilot.Status
import taskpilot.Task
import taskpilot.TaskQuery
import taskpilot.VIEW_PARAM
import taskpilot.WorkflowStatus
import taskpilot.applyWorkflowColumn
import taskpilot.blockedMessage
import taskpilot.blockedTaskIds
import taskpilot.boardQuery
import taskpilot.categoryKey
import taskpilot.columnTasks
import taskpilot.columnTasksBy
import taskpilot.dueDay
import taskpilot.effectiveWorkflow
import taskpilot.filterTasks
import taskpilot.isOverdue
import taskpilot.matchesAssignee
import taskpilot.moveTask
import taskpilot.moveTaskByKeyboard
import taskpilot.moveTaskByKeyboardIn
import taskpilot.moveTaskTo
import taskpilot.web.Router
import taskpilot.web.Store
import taskpilot.web.ui.Avatar
import taskpilot.web.ui.BlockedBadge
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconButton
import taskpilot.web.ui.IconView
import taskpilot.web.ui.PriorityBadge
import taskpilot.web.ui.RecurrenceIcon
import taskpilot.web.ui.SelectField
import taskpilot.web.ui.assigneeFilterOptions
import taskpilot.web.ui.projectOptions
import taskpilot.withStatus
import taskpilot.workflowColumnKey

private data class DropTarget(val key: String, val index: Int)

@Composable
fun BoardPage() {
    val params = Router.params()
    // The board applies every list filter except status (its columns) – e.g. when opened from a saved view.
    val query = boardQuery(TaskQuery.fromParams(params))
    val projectFilter = query.project
    val assigneeFilter = query.assignee
    val activeView = Store.view(params[VIEW_PARAM])
    val all = Store.tasks
    val today = Store.clock().today
    val visible = remember(all, query, today) { if (query.hasFilters) filterTasks(all, query, today, Store.projects) else all }

    fun setQuery(next: TaskQuery) = Router.navigate(Router.buildUrl("/board", next.toParams()), replace = true)
    val blockedIds = remember(all) { blockedTaskIds(all) }
    val layout = remember(projectFilter, Store.projects) { boardLayout(projectFilter) }
    var dragId by remember { mutableStateOf<String?>(null) }
    var drop by remember { mutableStateOf<DropTarget?>(null) }
    var focusId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(focusId, all) {
        val id = focusId ?: return@LaunchedEffect
        (document.querySelector("[data-card-id=\"$id\"]") as? HTMLElement)?.focus()
        focusId = null
    }

    Div({ classes("page-header") }) {
        Div {
            H1 { Text("Board") }
            P({ classes("subtitle") }) { Text("Drag cards between columns, or focus a card and use Shift + arrow keys.") }
        }
        Div({ classes("filter-selects") }) {
            Div({ classes("lsel") }) {
                org.jetbrains.compose.web.dom
                    .Label(forId = "board-project") { Text("Project") }
                SelectField(
                    projectFilter ?: "",
                    listOf("" to "All projects", NO_PROJECT to "No project") + projectOptions(),
                    { v -> setQuery(query.copy(project = v.ifEmpty { null })) },
                ) { id("board-project") }
            }
            Div({ classes("lsel") }) {
                org.jetbrains.compose.web.dom
                    .Label(forId = "board-assignee") { Text("Assignee") }
                SelectField(assigneeFilter ?: "", assigneeFilterOptions(), { v -> setQuery(query.copy(assignee = v.ifEmpty { null })) }) {
                    id("board-assignee")
                    attr("data-testid", "board-assignee-filter")
                }
            }
        }
    }

    if (activeView != null) ActiveViewBar(activeView, onBoard = true)
    val extra = query.copy(project = null, assignee = null)
    if (extra.hasFilters) {
        Div({
            classes("board-filter-note")
            attr("data-testid", "board-extra-filters")
        }) {
            Span { Text("Also filtered by: ${querySummary(extra).substringBeforeLast(" · by ")} · ${visible.size} of ${all.size} tasks") }
            Button({
                classes("btn", "btn-sm", "btn-ghost")
                attr("type", "button")
                onClick { setQuery(TaskQuery(project = projectFilter, assignee = assigneeFilter)) }
            }) { Text("Clear") }
        }
    }

    Div({ classes("board") }) {
        layout.columns.forEach { column ->
            val key = column.id
            val cards = columnTasksBy(visible, key, layout.keyOf)
            val target = drop?.takeIf { it.key == key }
            Section({
                classes("column", "column-$key")
                if (target != null) classes("drag-over")
                attr("data-testid", "board-column-$key")
                attr("data-category", column.category.key)
                attr("aria-labelledby", "col-title-$key")
                onDragOver { e ->
                    e.preventDefault()
                    e.dataTransfer?.dropEffect = "move"
                    val idx = dropIndex(e, dragId)
                    val next = DropTarget(key, idx)
                    if (drop != next) drop = next
                }
                onDragLeave { e ->
                    val col = e.currentTarget as? HTMLElement
                    val rel = e.nativeEvent.asDynamic().relatedTarget as? org.w3c.dom.Node
                    if (col != null && (rel == null || !col.contains(rel))) {
                        if (drop?.key == key) drop = null
                    }
                }
                onDrop { e ->
                    e.preventDefault()
                    val id = e.dataTransfer?.getData("text/plain")?.takeIf { it.isNotEmpty() } ?: dragId
                    val idx = dropIndex(e, id)
                    drop = null
                    dragId = null
                    if (id != null) applyMove(visible, id, column, idx, layout)
                }
            }) {
                Div({ classes("column-head") }) {
                    H2({ id("col-title-$key") }) {
                        Span({
                            classes("col-dot")
                            style { property("background", column.color) }
                        })
                        Text(column.name)
                    }
                    Span({ classes("col-count") }) { Text(cards.size.toString()) }
                    IconButton(Icon.Plus, "Add task to ${column.name}", extraClass = "subtle") {
                        Store.openNewTask(
                            Task(
                                id = "",
                                title = "",
                                status = column.category,
                                statusId = column.id,
                                projectId = projectFilter?.takeIf { it != NO_PROJECT },
                                createdAt = "",
                            ),
                        )
                    }
                }
                Div({
                    classes("column-body")
                    attr("role", "list")
                }) {
                    cards.forEachIndexed { i, t ->
                        val before = target != null && target.index == i && dragId != t.id
                        BoardCard(t, today, blocked = t.id in blockedIds, dragging = dragId == t.id, dropBefore = before, onDragStart = {
                            dragId = t.id
                        }, onDragEnd = {
                            dragId = null
                            drop = null
                        }, onKeyMove = { dx, dy ->
                            keyboardMove(visible, t, dx, dy, layout)
                            focusId = t.id
                        })
                    }
                    val rest = cards.count { it.id != dragId }
                    if (target != null && target.index >= rest) Div({ classes("drop-end") })
                    if (cards.isEmpty() && target == null) Div({ classes("column-empty") }) { Text("No tasks") }
                }
            }
        }
    }
}

/**
 * Board columns: a project's workflow statuses when a project is selected, otherwise the three
 * categories. [keyOf] maps a task to its column; [applyFor] moves a task into a column.
 */
private class BoardLayout(val columns: List<WorkflowStatus>, val keyOf: (Task) -> String, val applyFor: (WorkflowStatus) -> (Task) -> Task)

private fun boardLayout(projectId: String?): BoardLayout {
    val projects = Store.projects
    if (projectId == null || projectId == NO_PROJECT || projects.none { it.id == projectId }) {
        return BoardLayout(DEFAULT_WORKFLOW, categoryKey) { col -> { t -> t.withStatus(col.category, Store.clock().nowIso) } }
    }
    val columns = effectiveWorkflow(projects, projectId)
    return BoardLayout(columns, { workflowColumnKey(it, columns) }) { col ->
        { t ->
            applyWorkflowColumn(t, col, Store.projects, Store.clock().nowIso)
        }
    }
}

/** Index inside the column (excluding the dragged card) based on the pointer's Y position. */
private fun dropIndex(e: SyntheticDragEvent, dragId: String?): Int {
    val col = e.currentTarget as? HTMLElement ?: return 0
    val y = e.clientY.toDouble()
    val cards =
        col.querySelectorAll("[data-card-id]").asList().filterIsInstance<HTMLElement>().filter {
            it.getAttribute("data-card-id") != dragId
        }
    var idx = 0
    for (c in cards) {
        val rect = c.getBoundingClientRect()
        if (y > rect.top + rect.height / 2) idx++ else break
    }
    return idx
}

/**
 * Translates an index in the (possibly filtered) visible column into an index in the full
 * column, then applies the move through the undoable store.
 */
private fun applyMove(visible: List<Task>, id: String, column: WorkflowStatus, visibleIndex: Int, layout: BoardLayout) {
    val all = Store.tasks
    val visibleCol = columnTasksBy(visible, column.id, layout.keyOf).filter { it.id != id }
    val fullCol = columnTasksBy(all, column.id, layout.keyOf).filter { it.id != id }
    val fullIndex =
        if (visibleIndex >= visibleCol.size) {
            visibleCol.lastOrNull()?.let { last -> fullCol.indexOfFirst { it.id == last.id } + 1 } ?: fullCol.size
        } else {
            fullCol.indexOfFirst { it.id == visibleCol[visibleIndex].id }
        }
    val before = all.firstOrNull { it.id == id } ?: return
    if (rejectBlockedCompletion(before, column.category)) return
    Store.setTasks { moveTaskTo(it, id, column.id, fullIndex, layout.keyOf, layout.applyFor(column)) }
    if (layout.keyOf(before) != column.id) Store.announce("Moved \"${before.title}\" to ${column.name}")
}

/** Shows the "blocked by" error and returns true when [task] may not move into [status]. */
private fun rejectBlockedCompletion(task: Task, status: Status): Boolean {
    if (status != Status.DONE || task.status == Status.DONE) return false
    val blockers = Store.openBlockersOf(task.id)
    if (blockers.isEmpty()) return false
    Store.toast(blockedMessage(listOf(BlockedCompletion(task, blockers))), tone = "error")
    Store.announce("Cannot move \"${task.title}\" to Done: it has open blockers")
    return true
}

private fun keyboardMove(visible: List<Task>, task: Task, dx: Int, dy: Int, layout: BoardLayout) {
    val keys = layout.columns.map { it.id }
    val currentKey = layout.keyOf(task)
    val targetColumn = if (dx != 0) layout.columns.getOrNull(keys.indexOf(currentKey) + dx) ?: return else null
    if (targetColumn != null && rejectBlockedCompletion(task, targetColumn.category)) return
    val applyFor = { k: String -> layout.applyFor(layout.columns.first { it.id == k }) }
    if (visible.size == Store.tasks.size) {
        Store.setTasks { moveTaskByKeyboardIn(it, task.id, dx, dy, keys, layout.keyOf, applyFor) }
    } else {
        // Filtered board: compute the move on the visible subset, then map to the full column.
        val moved = moveTaskByKeyboardIn(visible, task.id, dx, dy, keys, layout.keyOf, applyFor)
        val after = moved.first { it.id == task.id }
        val key = layout.keyOf(after)
        val idx = columnTasksBy(moved, key, layout.keyOf).indexOfFirst { it.id == task.id }
        if (moved != visible) applyMove(visible, task.id, layout.columns.first { it.id == key }, idx, layout)
    }
    val updated = Store.task(task.id) ?: return
    val key = layout.keyOf(updated)
    val col = columnTasksBy(Store.tasks, key, layout.keyOf)
    val name = layout.columns.firstOrNull { it.id == key }?.name ?: updated.status.label
    Store.announce("${updated.title}: $name, position ${col.indexOfFirst { it.id == task.id } + 1} of ${col.size}")
}

@Composable
private fun BoardCard(
    t: Task,
    today: Int,
    dragging: Boolean,
    dropBefore: Boolean,
    onDragStart: () -> Unit,
    onDragEnd: () -> Unit,
    onKeyMove: (Int, Int) -> Unit,
    blocked: Boolean,
) {
    val project = Store.project(t.projectId)
    Div({
        classes("board-card", "prio-edge-${t.priority.key}")
        if (dragging) classes("dragging")
        if (dropBefore) classes("drop-before")
        attr("data-testid", "board-card")
        attr("data-card-id", t.id)
        attr("role", "listitem")
        attr("aria-roledescription", "Draggable task card")
        attr("aria-label", "${t.title}. ${t.priority.label} priority. Press Enter to open, Shift plus arrow keys to move.")
        tabIndex(0)
        draggable(Draggable.True)
        onDragStart { e ->
            e.dataTransfer?.setData("text/plain", t.id)
            e.dataTransfer?.effectAllowed = "move"
            onDragStart()
        }
        onDragEnd { onDragEnd() }
        onClick { Router.navigate("/tasks/${t.id}") }
        onKeyDown { e ->
            if (e.shiftKey) {
                val (dx, dy) =
                    when (e.key) {
                        "ArrowLeft" -> -1 to 0
                        "ArrowRight" -> 1 to 0
                        "ArrowUp" -> 0 to -1
                        "ArrowDown" -> 0 to 1
                        else -> 0 to 0
                    }
                if (dx != 0 || dy != 0) {
                    e.preventDefault()
                    onKeyMove(dx, dy)
                }
            } else if (e.key == "Enter") {
                e.preventDefault()
                Router.navigate("/tasks/${t.id}")
            }
        }
    }) {
        Div({ classes("card-top") }) {
            Div({ classes("card-title") }) { Text(t.title) }
            RecurrenceIcon(t.recurrence)
            Store.member(t.assigneeId)?.let { Avatar(it) }
        }
        Div({ classes("card-meta") }) {
            PriorityBadge(t.priority)
            if (blocked) BlockedBadge(Store.openBlockersOf(t.id))
            if (project != null) {
                Span({ classes("chip", "chip-sm") }) {
                    Span({
                        classes("dot")
                        style { property("background", project.color) }
                    })
                    Text(project.name)
                }
            }
        }
        val due = t.dueDay()
        val hasSubtasks = t.subtasks.isNotEmpty()
        if (due != null || hasSubtasks) {
            Div({ classes("card-foot") }) {
                if (due != null) {
                    Span({
                        classes("due")
                        if (t.isOverdue(today)) classes("due-overdue")
                    }) {
                        IconView(Icon.Calendar, 12)
                        Text(Dates.shortLabel(due, Dates.civil(today).first))
                    }
                }
                if (hasSubtasks) {
                    val done = t.subtasks.count { it.done }
                    Span({
                        classes("subtask-progress")
                        attr("title", "$done of ${t.subtasks.size} subtasks done")
                    }) {
                        IconView(Icon.Check, 12)
                        Text("$done/${t.subtasks.size}")
                        Span({ classes("mini-bar") }) {
                            Span({
                                classes("mini-bar-fill")
                                style { property("width", "${done * 100 / t.subtasks.size}%") }
                            })
                        }
                    }
                }
            }
        }
    }
}
