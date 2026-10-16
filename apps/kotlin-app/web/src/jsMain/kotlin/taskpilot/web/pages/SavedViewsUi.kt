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
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.Form
import org.jetbrains.compose.web.dom.Input
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Li
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.dom.Ul
import taskpilot.DueFilter
import taskpilot.NO_PROJECT
import taskpilot.SavedView
import taskpilot.TaskQuery
import taskpilot.UNASSIGNED
import taskpilot.VIEW_NAME_MAX
import taskpilot.boardIgnoredParts
import taskpilot.boardUrlParams
import taskpilot.listUrlParams
import taskpilot.validateViewName
import taskpilot.web.Route
import taskpilot.web.Router
import taskpilot.web.Store
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconButton
import taskpilot.web.ui.IconView
import taskpilot.web.ui.Modal
import taskpilot.web.ui.ModalHeader

fun listUrl(view: SavedView) = Router.buildUrl("/tasks", listUrlParams(view))

fun boardUrl(view: SavedView) = Router.buildUrl("/board", boardUrlParams(view))

/** Short human summary of a query, e.g. "High · Website · Alex Kim · “login”". */
fun querySummary(q: TaskQuery): String =
    buildList {
        if (q.search.isNotBlank()) add("“${q.search}”")
        if (q.statuses.isNotEmpty()) add(q.statuses.joinToString("/") { it.label })
        if (q.priorities.isNotEmpty()) add(q.priorities.joinToString("/") { it.label })
        q.project?.let { add(if (it == NO_PROJECT) "No project" else Store.project(it)?.name ?: "Removed project") }
        q.assignee?.let { add(if (it == UNASSIGNED) "Unassigned" else Store.member(it)?.name ?: "Removed member") }
        q.tag?.let { add("#$it") }
        if (q.due != DueFilter.ALL) add(q.due.label)
        add("by ${q.sort.label.lowercase()} ${if (q.ascending) "↑" else "↓"}")
    }.joinToString(" · ")

/** Sidebar "Views" section: one link per saved view (opens the list) plus a board shortcut. */
@Composable
fun SidebarViews() {
    val views = Store.views
    val activeId = Router.params()[taskpilot.VIEW_PARAM]
    val route = Router.route
    Div({
        classes("sidebar-views")
        attr("data-testid", "sidebar-views")
    }) {
        Div({ classes("sidebar-section-title") }) {
            IconView(Icon.Bookmark, 14)
            Span({ classes("nav-label") }) { Text("Views") }
        }
        if (views.isEmpty()) {
            P({ classes("sidebar-empty", "nav-label") }) { Text("Save filters from the task list to pin them here.") }
            return@Div
        }
        Ul({ classes("nav-list", "view-list") }) {
            views.forEach { v ->
                val active = v.id == activeId && (route == Route.Tasks || route == Route.Board)
                Li({ classes("view-item") }) {
                    org.jetbrains.compose.web.dom.A(listUrl(v), {
                        classes("nav-link", "view-link")
                        if (active) {
                            classes("active")
                            attr("aria-current", "page")
                        }
                        attr("data-testid", "saved-view-link")
                        attr("title", "${v.name}: ${querySummary(v.query)}")
                        onClick { e ->
                            if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                                e.preventDefault()
                                Store.drawerOpen = false
                                Router.navigate(listUrl(v))
                            }
                        }
                    }) {
                        Span({ classes("view-initial") }) { Text(v.name.take(1).uppercase()) }
                        Span({ classes("nav-label") }) { Text(v.name) }
                    }
                    IconButton(Icon.Board, "Open view ${v.name} on the board", testId = "saved-view-board", extraClass = "view-board-btn") {
                        Store.drawerOpen = false
                        Router.navigate(boardUrl(v))
                    }
                }
            }
        }
    }
}

/** Dialog to name the current list query as a saved view. */
@Composable
fun SaveViewDialog(query: TaskQuery, onClose: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Modal("save-view-title", onClose, testId = "save-view-modal") {
        ModalHeader("save-view-title", "Save view", onClose)
        Form(attrs = {
            classes("modal-body")
            attr("novalidate", "")
            onSubmit { e ->
                e.preventDefault()
                error = validateViewName(name, Store.views)
                if (error == null) {
                    val v = Store.createView(name, query)
                    Store.toast("View \"${v.name}\" saved", tone = "success")
                    onClose()
                    Router.navigate(listUrl(v), replace = true)
                }
            }
        }) {
            P({ classes("muted", "small") }) { Text("Saves: ${querySummary(query)}") }
            Div({
                classes("field")
                if (error != null) classes("has-error")
            }) {
                Label(forId = "save-view-name") { Text("Name") }
                Input(InputType.Text) {
                    id("save-view-name")
                    attr("data-testid", "save-view-name")
                    attr("data-autofocus", "")
                    attr("maxlength", (VIEW_NAME_MAX + 10).toString())
                    attr("autocomplete", "off")
                    placeholder("e.g. My urgent work")
                    value(name)
                    if (error != null) {
                        attr("aria-invalid", "true")
                        attr("aria-describedby", "save-view-error")
                    }
                    onInput {
                        name = it.value
                        error = null
                    }
                }
                error?.let {
                    Div({
                        classes("field-error")
                        id("save-view-error")
                        attr("role", "alert")
                    }) { Text(it) }
                }
            }
            Div({ classes("form-actions") }) {
                Button({
                    classes("btn", "btn-ghost")
                    attr("type", "button")
                    onClick { onClose() }
                }) { Text("Cancel") }
                Button({
                    classes("btn", "btn-primary")
                    attr("type", "submit")
                    attr("data-testid", "save-view-confirm")
                }) { Text("Save view") }
            }
        }
    }
}

/**
 * Banner shown when the list or board was opened from a saved view: name, rename, delete and a
 * switch to the other surface. [onBoard] selects the board variant.
 */
@Composable
fun ActiveViewBar(view: SavedView, onBoard: Boolean) {
    var renaming by remember(view.id) { mutableStateOf(false) }
    var name by remember(view.id, renaming) { mutableStateOf(view.name) }
    var error by remember(view.id, renaming) { mutableStateOf<String?>(null) }
    Div({
        classes("view-bar")
        attr("data-testid", "active-view")
        attr("role", "region")
        attr("aria-label", "Saved view")
    }) {
        IconView(Icon.Bookmark, 16)
        if (renaming) {
            Form(attrs = {
                classes("rename-form")
                onSubmit { e ->
                    e.preventDefault()
                    error = validateViewName(name, Store.views, editingId = view.id)
                    if (error == null) {
                        if (name.trim() != view.name) Store.renameView(view.id, name)
                        renaming = false
                    }
                }
            }) {
                Label(forId = "rename-view", attrs = { classes("sr-only") }) { Text("View name") }
                Input(InputType.Text) {
                    id("rename-view")
                    attr("data-testid", "rename-view-input")
                    value(name)
                    if (error != null) attr("aria-invalid", "true")
                    ref { el ->
                        el.focus()
                        el.select()
                        onDispose { }
                    }
                    onInput {
                        name = it.value
                        error = null
                    }
                    onKeyDown { if (it.key == "Escape") renaming = false }
                }
                Button({
                    classes("btn", "btn-sm", "btn-primary")
                    attr("type", "submit")
                }) { Text("Save") }
                Button({
                    classes("btn", "btn-sm", "btn-ghost")
                    attr("type", "button")
                    onClick { renaming = false }
                }) { Text("Cancel") }
            }
        } else {
            Span({ classes("view-bar-name") }) { Text(view.name) }
            Span({ classes("view-bar-summary", "muted") }) { Text(querySummary(view.query)) }
        }
        Div({ classes("view-bar-actions") }) {
            if (onBoard) {
                Button({
                    classes("btn", "btn-sm")
                    attr("type", "button")
                    onClick { Router.navigate(listUrl(view)) }
                }) {
                    IconView(Icon.Tasks, 14)
                    Text("Open as list")
                }
            } else {
                Button({
                    classes("btn", "btn-sm")
                    attr("type", "button")
                    attr("data-testid", "view-open-board")
                    onClick { Router.navigate(boardUrl(view)) }
                }) {
                    IconView(Icon.Board, 14)
                    Text("Open on board")
                }
            }
            if (!renaming) {
                IconButton(Icon.Edit, "Rename view ${view.name}", testId = "view-rename", extraClass = "subtle") { renaming = true }
            }
            IconButton(Icon.Trash, "Delete view ${view.name}", testId = "view-delete", extraClass = "subtle") {
                Store.deleteView(view.id)
                Router.navigate(
                    Router.buildUrl(
                        if (onBoard) "/board" else "/tasks",
                        Router
                            .params()
                            .filterKeys {
                                it != taskpilot.VIEW_PARAM
                            }.toList(),
                    ),
                    replace = true,
                )
            }
        }
        if (onBoard) {
            val ignored = boardIgnoredParts(view.query)
            if (ignored.isNotEmpty()) {
                Span({
                    classes("view-bar-note")
                    attr("data-testid", "view-board-ignored")
                }) { Text("Not applied on the board: " + ignored.joinToString("; ") + ".") }
            }
        }
        error?.let {
            Span({
                classes("field-error", "view-bar-error")
                attr("role", "alert")
            }) { Text(it) }
        }
    }
}
