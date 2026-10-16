package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import org.jetbrains.compose.web.attributes.InputType
import org.jetbrains.compose.web.attributes.forId
import org.jetbrains.compose.web.attributes.placeholder
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.CheckboxInput
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.Fieldset
import org.jetbrains.compose.web.dom.H1
import org.jetbrains.compose.web.dom.Input
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Legend
import org.jetbrains.compose.web.dom.Nav
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Table
import org.jetbrains.compose.web.dom.Tbody
import org.jetbrains.compose.web.dom.Td
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.dom.Th
import org.jetbrains.compose.web.dom.Thead
import org.jetbrains.compose.web.dom.Tr
import taskpilot.Dates
import taskpilot.DueFilter
import taskpilot.NO_PROJECT
import taskpilot.Priority
import taskpilot.SortField
import taskpilot.Status
import taskpilot.Task
import taskpilot.TaskQuery
import taskpilot.VIEW_PARAM
import taskpilot.allTags
import taskpilot.blockedTaskIds
import taskpilot.dueDay
import taskpilot.filterTasks
import taskpilot.isOverdue
import taskpilot.paginate
import taskpilot.sortTasks
import taskpilot.tasksToCsv
import taskpilot.web.Platform
import taskpilot.web.Router
import taskpilot.web.Store
import taskpilot.web.ui.Avatar
import taskpilot.web.ui.BlockedBadge
import taskpilot.web.ui.EmptyState
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconView
import taskpilot.web.ui.Link
import taskpilot.web.ui.PriorityBadge
import taskpilot.web.ui.ProjectChip
import taskpilot.web.ui.RecurrenceIcon
import taskpilot.web.ui.SelectField
import taskpilot.web.ui.StatusBadge
import taskpilot.web.ui.TagChip
import taskpilot.web.ui.assigneeFilterOptions
import taskpilot.web.ui.projectOptions

private fun pushQuery(q: TaskQuery, replace: Boolean = false) = Router.navigate(Router.buildUrl("/tasks", q.toParams()), replace)

@Composable
fun TasksPage() {
    val query = TaskQuery.fromParams(Router.params())
    val tasks = Store.tasks
    val clock = Store.clock()
    val today = clock.today
    val pageSize = Store.settings.pageSize
    val filtered =
        remember(
            tasks,
            query.copy(page = 1),
            today,
        ) { sortTasks(filterTasks(tasks, query, today, Store.projects), query.sort, query.ascending) }
    val page = paginate(filtered, query.page, pageSize)
    val blockedIds = remember(tasks) { blockedTaskIds(tasks) }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var savingView by remember { mutableStateOf(false) }
    val existingSelected = selected.filter { id -> tasks.any { it.id == id } }.toSet()

    Div({ classes("page-header") }) {
        Div {
            H1 { Text("Tasks") }
            P({ classes("subtitle") }) {
                Text(
                    if (query.hasFilters) {
                        "${filtered.size} of ${tasks.size} tasks match"
                    } else {
                        "${tasks.size} tasks"
                    },
                )
            }
        }
        Div({ classes("header-actions") }) {
            Button({
                classes("btn")
                attr("type", "button")
                attr("data-testid", "export-csv")
                attr("title", "Download the ${filtered.size} tasks matching the current filters, in the current sort order")
                if (filtered.isEmpty()) attr("disabled", "")
                onClick {
                    // Exactly the filtered + sorted tasks (all pages), not just the visible page.
                    val csv = tasksToCsv(filtered, Store.projects, Store.members)
                    Platform.download("taskpilot-tasks-${Store.clock().nowIso.take(10)}.csv", csv, "text/csv;charset=utf-8")
                    Store.toast("Exported ${filtered.size} task${if (filtered.size == 1) "" else "s"} to CSV", tone = "success")
                }
            }) {
                IconView(Icon.Download, 16)
                Text("Export CSV")
            }
            Button({
                classes("btn")
                attr("type", "button")
                attr("data-testid", "save-view-button")
                attr("title", "Save the current filters, search and sort as a view")
                onClick { savingView = true }
            }) {
                IconView(Icon.Bookmark, 16)
                Text("Save view")
            }
        }
    }
    if (savingView) SaveViewDialog(query) { savingView = false }
    Store.view(Router.params()[VIEW_PARAM])?.let { ActiveViewBar(it, onBoard = false) }

    Filters(query, tasks)

    if (existingSelected.isNotEmpty()) BulkBar(existingSelected) { selected = emptySet() }

    if (page.items.isEmpty()) {
        EmptyState(
            if (tasks.isEmpty()) "No tasks yet" else "No tasks match",
            if (tasks.isEmpty()) "Create your first task to get started." else "Try a different search or clear the filters.",
        ) {
            if (query.hasFilters) {
                Button({
                    classes("btn")
                    attr("type", "button")
                    onClick { pushQuery(TaskQuery(sort = query.sort, ascending = query.ascending)) }
                }) { Text("Clear filters") }
            }
        }
        return
    }

    val pageIds = page.items.map { it.id }
    val allOnPage = pageIds.all { it in existingSelected }
    Div({ classes("table-card") }) {
        Table({ classes("task-table") }) {
            Thead {
                Tr {
                    Th({
                        classes("col-check")
                        attr("scope", "col")
                    }) {
                        CheckboxInput(allOnPage) {
                            attr("aria-label", "Select all tasks on this page")
                            attr("data-testid", "select-all")
                            onChange { e ->
                                selected = if (e.value) existingSelected + pageIds else existingSelected - pageIds.toSet()
                            }
                        }
                    }
                    Th({ attr("scope", "col") }) { Span({ classes("sr-only") }) { Text("Done") } }
                    SortHeader("Title", SortField.TITLE, query)
                    Th({ attr("scope", "col") }) { Text("Project") }
                    Th({
                        attr("scope", "col")
                        classes("col-assignee")
                    }) { Text("Assignee") }
                    SortHeader("Priority", SortField.PRIORITY, query)
                    Th({ attr("scope", "col") }) { Text("Status") }
                    SortHeader("Due", SortField.DUE, query)
                    Th({
                        attr("scope", "col")
                        classes("col-tags")
                    }) { Text("Tags") }
                }
            }
            Tbody {
                page.items.forEach { t ->
                    val blockers = if (t.id in blockedIds) Store.openBlockersOf(t.id) else emptyList()
                    TaskRow(t, t.id in existingSelected, today, blockers) { checked ->
                        selected = if (checked) existingSelected + t.id else existingSelected - t.id
                    }
                }
            }
        }
    }

    Nav({
        classes("pagination")
        attr("aria-label", "Pagination")
    }) {
        Button({
            classes("btn", "btn-ghost")
            attr("type", "button")
            attr("data-testid", "pagination-prev")
            if (page.page <= 1) attr("disabled", "")
            onClick { pushQuery(query.copy(page = page.page - 1)) }
        }) {
            IconView(Icon.ChevronLeft, 16)
            Text("Previous")
        }
        Span({
            classes("page-info")
            attr("aria-live", "polite")
        }) {
            val from = (page.page - 1) * pageSize + 1
            Text("Page ${page.page} of ${page.pageCount} · $from–${from + page.items.size - 1} of ${page.total}")
        }
        Button({
            classes("btn", "btn-ghost")
            attr("type", "button")
            attr("data-testid", "pagination-next")
            if (page.page >= page.pageCount) attr("disabled", "")
            onClick { pushQuery(query.copy(page = page.page + 1)) }
        }) {
            Text("Next")
            IconView(Icon.ChevronRight, 16)
        }
    }
}

@Composable
private fun SortHeader(label: String, field: SortField, query: TaskQuery) {
    val active = query.sort == field
    Th({
        attr("scope", "col")
        attr(
            "aria-sort",
            if (!active) {
                "none"
            } else if (query.ascending) {
                "ascending"
            } else {
                "descending"
            },
        )
    }) {
        Button({
            classes("sort-btn")
            if (active) classes("active")
            attr("type", "button")
            attr("title", "Sort by ${label.lowercase()}")
            onClick { pushQuery(query.copy(sort = field, ascending = if (active) !query.ascending else true, page = 1)) }
        }) {
            Text(label)
            Span({
                classes("sort-arrow")
                attr("aria-hidden", "true")
            }) {
                Text(
                    if (!active) {
                        "↕"
                    } else if (query.ascending) {
                        "↑"
                    } else {
                        "↓"
                    },
                )
            }
        }
    }
}

@Composable
private fun TaskRow(t: Task, isSelected: Boolean, today: Int, blockers: List<Task>, onSelect: (Boolean) -> Unit) {
    val overdue = t.isOverdue(today)
    Tr({
        classes("task-row")
        if (overdue) classes("overdue")
        if (t.status == taskpilot.Status.DONE) classes("is-done")
        if (isSelected) classes("selected")
        attr("data-testid", "task-row")
    }) {
        Td({ classes("col-check") }) {
            CheckboxInput(isSelected) {
                attr("aria-label", "Select ${t.title}")
                onChange { onSelect(it.value) }
            }
        }
        Td({ classes("col-done") }) {
            val done = t.status == taskpilot.Status.DONE
            Button({
                classes("done-toggle")
                if (done) classes("checked")
                attr("type", "button")
                attr("role", "switch")
                attr("aria-checked", done.toString())
                attr("aria-label", if (done) "Mark ${t.title} as not done" else "Mark ${t.title} as done")
                attr("data-testid", "toggle-done")
                onClick { Store.toggleDone(t.id) }
            }) { IconView(Icon.Check, 14) }
        }
        Td({ classes("col-title") }) {
            Link("/tasks/${t.id}", "task-link") { Text(t.title) }
            RecurrenceIcon(t.recurrence)
            if (blockers.isNotEmpty()) BlockedBadge(blockers)
            if (t.subtasks.isNotEmpty()) {
                Span({ classes("subtask-count") }) { Text("${t.subtasks.count { it.done }}/${t.subtasks.size}") }
            }
        }
        Td({ classes("col-project") }) { ProjectChip(Store.project(t.projectId)) }
        Td({ classes("col-assignee") }) {
            val member = Store.member(t.assigneeId)
            Span({ classes("assignee") }) {
                Avatar(member)
                Span({ classes("assignee-name") }) { Text(member?.name ?: "Unassigned") }
            }
        }
        Td({ classes("col-priority") }) { PriorityBadge(t.priority) }
        Td({ classes("col-status") }) { StatusBadge(t) }
        Td({ classes("col-due") }) {
            val d = t.dueDay()
            if (d == null) {
                Span({ classes("muted") }) { Text("—") }
            } else {
                Span({
                    classes("due")
                    if (overdue) classes("due-overdue")
                    attr("title", t.dueDate ?: "")
                }) {
                    if (overdue) {
                        IconView(Icon.Alert, 13)
                        Span({ classes("sr-only") }) { Text("Overdue: ") }
                    }
                    Text(Dates.shortLabel(d, Dates.civil(today).first))
                }
            }
        }
        Td({ classes("col-tags") }) { t.tags.forEach { TagChip(it) } }
    }
}

@Composable
private fun Filters(query: TaskQuery, tasks: List<Task>) {
    var text by remember { mutableStateOf(query.search) }
    var dirty by remember { mutableStateOf(false) }
    LaunchedEffect(query.search) { if (!dirty) text = query.search }
    LaunchedEffect(text, dirty) {
        if (!dirty) return@LaunchedEffect
        delay(200)
        dirty = false
        if (text != query.search) pushQuery(query.copy(search = text, page = 1), replace = true)
    }
    val tags = remember(tasks) { allTags(tasks) }

    Div({ classes("filters", "card") }) {
        Div({ classes("filter-row") }) {
            Div({ classes("search-box") }) {
                Label(forId = "list-search", attrs = { classes("sr-only") }) { Text("Search tasks") }
                IconView(Icon.Search, 16, "icon search-icon")
                Input(InputType.Search) {
                    id("list-search")
                    attr("data-testid", "task-list-search")
                    attr("autocomplete", "off")
                    placeholder("Search title, description, tags…")
                    value(text)
                    onInput {
                        text = it.value
                        dirty = true
                    }
                }
            }
            Div({ classes("filter-selects") }) {
                LabeledSelect(
                    "f-project",
                    "Project",
                    query.project ?: "",
                    listOf("" to "All projects", NO_PROJECT to "No project") + projectOptions(),
                ) {
                    pushQuery(query.copy(project = it.ifEmpty { null }, page = 1))
                }
                LabeledSelect("f-assignee", "Assignee", query.assignee ?: "", assigneeFilterOptions()) {
                    pushQuery(query.copy(assignee = it.ifEmpty { null }, page = 1))
                }
                LabeledSelect("f-tag", "Tag", query.tag ?: "", listOf("" to "All tags") + tags.map { it to "#$it" }) {
                    pushQuery(query.copy(tag = it.ifEmpty { null }, page = 1))
                }
                LabeledSelect("f-due", "Due", query.due.key, DueFilter.entries.map { it.key to it.label }) {
                    pushQuery(query.copy(due = DueFilter.fromKey(it), page = 1))
                }
                LabeledSelect("f-sort", "Sort", query.sort.key, SortField.entries.map { it.key to it.label }) {
                    pushQuery(query.copy(sort = SortField.fromKey(it) ?: SortField.DUE, page = 1))
                }
                Button({
                    classes("btn", "btn-ghost", "dir-btn")
                    attr("type", "button")
                    attr(
                        "aria-label",
                        if (query.ascending) "Sort ascending (click for descending)" else "Sort descending (click for ascending)",
                    )
                    attr("data-testid", "sort-direction")
                    onClick { pushQuery(query.copy(ascending = !query.ascending, page = 1)) }
                }) { Text(if (query.ascending) "↑ Asc" else "↓ Desc") }
            }
        }
        Div({ classes("filter-row", "chips-row") }) {
            ChipGroup("Status", Status.entries.map { it.key to it.label }, query.statuses.map { it.key }.toSet()) { key ->
                val s = Status.fromKey(key)!!
                pushQuery(query.copy(statuses = if (s in query.statuses) query.statuses - s else query.statuses + s, page = 1))
            }
            ChipGroup("Priority", Priority.entries.map { it.key to it.label }, query.priorities.map { it.key }.toSet()) { key ->
                val p = Priority.fromKey(key)!!
                pushQuery(query.copy(priorities = if (p in query.priorities) query.priorities - p else query.priorities + p, page = 1))
            }
            if (query.hasFilters) {
                Button({
                    classes("btn", "btn-ghost", "btn-sm", "clear-btn")
                    attr("type", "button")
                    onClick {
                        text = ""
                        pushQuery(TaskQuery(sort = query.sort, ascending = query.ascending))
                    }
                }) { Text("Clear filters") }
            }
        }
    }
}

@Composable
private fun LabeledSelect(id: String, label: String, value: String, options: List<Pair<String, String>>, onChange: (String) -> Unit) {
    Div({ classes("lsel") }) {
        Label(forId = id) { Text(label) }
        SelectField(value, options, onChange) { id(id) }
    }
}

@Composable
private fun ChipGroup(label: String, options: List<Pair<String, String>>, active: Set<String>, onToggle: (String) -> Unit) {
    Fieldset({ classes("chip-group") }) {
        Legend { Text(label) }
        options.forEach { (key, text) ->
            val on = key in active
            Button({
                classes("filter-chip", "fc-$key")
                if (on) classes("on")
                attr("type", "button")
                attr("aria-pressed", on.toString())
                attr("data-testid", "filter-${label.lowercase()}-$key")
                onClick { onToggle(key) }
            }) { Text(text) }
        }
    }
}

@Composable
private fun BulkBar(selected: Set<String>, clear: () -> Unit) {
    Div({
        classes("bulk-bar")
        attr("role", "region")
        attr("aria-label", "Bulk actions")
    }) {
        Span({ classes("bulk-count") }) { Text("${selected.size} selected") }
        Button({
            classes("btn", "btn-sm")
            attr("type", "button")
            attr("data-testid", "bulk-done")
            onClick {
                val changed = Store.setStatus(selected, Status.DONE)
                if (changed > 0) Store.toast("Marked $changed as done", actionLabel = "Undo") { Store.undo() }
                clear()
            }
        }) {
            IconView(Icon.Check, 14)
            Text("Mark done")
        }
        Div({ classes("lsel", "lsel-inline") }) {
            Label(forId = "bulk-project") { Text("Move to") }
            SelectField("__", listOf("__" to "Choose project…", "" to "No project") + projectOptions(), { v ->
                if (v != "__") {
                    Store.moveToProject(selected, v.ifEmpty { null })
                    Store.toast("Moved ${selected.size} task(s)", actionLabel = "Undo") { Store.undo() }
                    clear()
                }
            }) { id("bulk-project") }
        }
        Button({
            classes("btn", "btn-sm", "btn-danger")
            attr("type", "button")
            attr("data-testid", "bulk-delete")
            onClick {
                Store.deleteTasks(selected)
                clear()
            }
        }) {
            IconView(Icon.Trash, 14)
            Text("Delete")
        }
        Button({
            classes("btn", "btn-sm", "btn-ghost")
            attr("type", "button")
            onClick { clear() }
        }) { Text("Clear selection") }
    }
}
