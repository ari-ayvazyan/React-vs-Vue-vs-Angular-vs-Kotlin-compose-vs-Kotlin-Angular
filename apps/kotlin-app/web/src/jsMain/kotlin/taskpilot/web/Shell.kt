package taskpilot.web

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.browser.document
import kotlinx.browser.window
import kotlinx.coroutines.delay
import org.jetbrains.compose.web.attributes.InputType
import org.jetbrains.compose.web.attributes.placeholder
import org.jetbrains.compose.web.dom.Aside
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.Header
import org.jetbrains.compose.web.dom.Input
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Li
import org.jetbrains.compose.web.dom.Main
import org.jetbrains.compose.web.dom.Nav
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Table
import org.jetbrains.compose.web.dom.Tbody
import org.jetbrains.compose.web.dom.Td
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.dom.Tr
import org.jetbrains.compose.web.dom.Ul
import org.w3c.dom.events.Event
import org.w3c.dom.events.KeyboardEvent
import taskpilot.ThemeMode
import taskpilot.web.pages.ActivityPage
import taskpilot.web.pages.BoardPage
import taskpilot.web.pages.CalendarPage
import taskpilot.web.pages.DashboardPage
import taskpilot.web.pages.NotFoundPage
import taskpilot.web.pages.ProjectsPage
import taskpilot.web.pages.ReportsPage
import taskpilot.web.pages.SettingsPage
import taskpilot.web.pages.SidebarViews
import taskpilot.web.pages.TaskDetailPage
import taskpilot.web.pages.TasksPage
import taskpilot.web.pages.TimelinePage
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconButton
import taskpilot.web.ui.IconView
import taskpilot.web.ui.Kbd
import taskpilot.web.ui.Link
import taskpilot.web.ui.Modal
import taskpilot.web.ui.ModalHeader
import taskpilot.web.ui.NotificationsBell
import taskpilot.web.ui.TaskModal
import taskpilot.web.ui.Toasts

private data class NavItem(val path: String, val label: String, val icon: Icon, val testId: String, val shortcut: String?)

private val NAV =
    listOf(
        NavItem("/dashboard", "Dashboard", Icon.Dashboard, "nav-dashboard", "g d"),
        NavItem("/tasks", "Tasks", Icon.Tasks, "nav-tasks", "g t"),
        NavItem("/board", "Board", Icon.Board, "nav-board", "g b"),
        NavItem("/calendar", "Calendar", Icon.Calendar, "nav-calendar", "g c"),
        NavItem("/timeline", "Timeline", Icon.Timeline, "nav-timeline", "g l"),
        NavItem("/projects", "Projects", Icon.Projects, "nav-projects", null),
        NavItem("/reports", "Reports", Icon.Report, "nav-reports", "g r"),
        NavItem("/activity", "Activity", Icon.Activity, "nav-activity", "g a"),
        NavItem("/settings", "Settings", Icon.Settings, "nav-settings", null),
    )

@Composable
fun App() {
    GlobalShortcuts()
    Div({
        classes("app")
        if (Store.sidebarCollapsed) classes("sidebar-collapsed")
        if (Store.drawerOpen) classes("drawer-open")
    }) {
        A11ySkipLink()
        Sidebar()
        if (Store.drawerOpen) {
            Div({
                classes("drawer-scrim")
                onClick { Store.drawerOpen = false }
            })
        }
        Div({ classes("main-col") }) {
            TopBar()
            Main({
                classes("content")
                id("main")
                tabIndex(-1)
            }) {
                when (val r = Router.route) {
                    Route.Dashboard -> DashboardPage()
                    Route.Tasks -> TasksPage()
                    is Route.TaskDetail -> TaskDetailPage(r.id)
                    Route.Board -> BoardPage()
                    Route.Calendar -> CalendarPage()
                    Route.Projects -> ProjectsPage()
                    Route.Settings -> SettingsPage()
                    Route.Activity -> ActivityPage()
                    Route.Reports -> ReportsPage()
                    Route.Timeline -> TimelinePage()
                    is Route.NotFound -> NotFoundPage(r.path)
                }
            }
        }
    }
    TaskModal()
    if (Store.shortcutsOpen) ShortcutHelp()
    Toasts()
    Div({
        classes("sr-only")
        attr("aria-live", "polite")
        attr("aria-atomic", "true")
    }) { Text(Store.announcement) }
}

@Composable
private fun A11ySkipLink() {
    org.jetbrains.compose.web.dom.A("#main", {
        classes("skip-link")
        onClick { e ->
            e.preventDefault()
            (document.getElementById("main") as? org.w3c.dom.HTMLElement)?.focus()
        }
    }) { Text("Skip to content") }
}

@Composable
private fun Sidebar() {
    Aside({
        classes("sidebar")
        attr("aria-label", "Primary")
    }) {
        Div({ classes("brand") }) {
            Span({ classes("brand-mark") }) { IconView(Icon.Check, 16) }
            Span({ classes("brand-name") }) { Text("TaskPilot") }
            IconButton(Icon.Close, "Close navigation", extraClass = "drawer-close") { Store.drawerOpen = false }
        }
        Nav({ attr("aria-label", "Main navigation") }) {
            Ul({ classes("nav-list") }) {
                val current = Router.route
                NAV.forEach { item ->
                    val active =
                        when (item.path) {
                            "/tasks" -> current == Route.Tasks || current is Route.TaskDetail
                            else -> Router.parse(item.path) == current
                        }
                    Li {
                        org.jetbrains.compose.web.dom.A(item.path, {
                            classes("nav-link")
                            if (active) {
                                classes("active")
                                attr("aria-current", "page")
                            }
                            attr("data-testid", item.testId)
                            attr("title", item.label)
                            onClick { e ->
                                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                                    e.preventDefault()
                                    Store.drawerOpen = false
                                    Router.navigate(item.path)
                                }
                            }
                        }) {
                            IconView(item.icon, 18)
                            Span({ classes("nav-label") }) { Text(item.label) }
                            if (item.shortcut != null) Kbd({ classes("nav-kbd") }) { Text(item.shortcut) }
                        }
                    }
                }
            }
        }
        SidebarViews()
        Div({ classes("sidebar-footer") }) {
            Button({
                classes("nav-link", "collapse-btn")
                attr("type", "button")
                attr("aria-label", if (Store.sidebarCollapsed) "Expand sidebar" else "Collapse sidebar")
                attr("aria-expanded", (!Store.sidebarCollapsed).toString())
                attr("title", if (Store.sidebarCollapsed) "Expand sidebar" else "Collapse sidebar")
                onClick { Store.toggleSidebar() }
            }) {
                IconView(Icon.Collapse, 18)
                Span({ classes("nav-label") }) { Text("Collapse") }
            }
            Button({
                classes("nav-link")
                attr("type", "button")
                attr("title", "Keyboard shortcuts (?)")
                onClick { Store.shortcutsOpen = true }
            }) {
                IconView(Icon.Keyboard, 18)
                Span({ classes("nav-label") }) { Text("Shortcuts") }
                Kbd({ classes("nav-kbd") }) { Text("?") }
            }
        }
    }
}

@Composable
private fun TopBar() {
    Header({ classes("topbar") }) {
        IconButton(Icon.Menu, "Open navigation", extraClass = "menu-btn") { Store.drawerOpen = true }
        GlobalSearch()
        Div({ classes("topbar-actions") }) {
            PomodoroIndicator()
            NotificationsBell()
            val mode = Store.settings.theme
            val dark = remember(mode, Store.clockTick) { Theme.isDark() }
            Button({
                classes("icon-btn")
                attr("type", "button")
                attr("data-testid", "theme-toggle")
                val label =
                    when (mode) {
                        ThemeMode.SYSTEM -> "Theme: system (${if (dark) "dark" else "light"}). Switch theme"
                        ThemeMode.LIGHT -> "Theme: light. Switch to dark"
                        ThemeMode.DARK -> "Theme: dark. Switch to light"
                    }
                attr("aria-label", label)
                attr("title", label)
                onClick { Store.cycleTheme() }
            }) {
                IconView(if (mode == ThemeMode.DARK || (mode == ThemeMode.SYSTEM && dark)) Icon.Moon else Icon.Sun)
            }
            Button({
                classes("btn", "btn-primary", "new-task-btn")
                attr("type", "button")
                attr("data-testid", "new-task-button")
                attr("title", "New task (n)")
                onClick { Store.openNewTask() }
            }) {
                IconView(Icon.Plus, 16)
                Span({ classes("btn-label") }) { Text("New task") }
            }
        }
    }
}

@Composable
private fun GlobalSearch() {
    val onTasks = Router.route == Route.Tasks
    val urlQuery = if (onTasks) Router.params()["q"].orEmpty() else ""
    var text by remember { mutableStateOf(urlQuery) }
    var dirty by remember { mutableStateOf(false) }
    // Mirror the URL when it changes from elsewhere (list search box, back button, leaving /tasks).
    LaunchedEffect(urlQuery, onTasks) {
        if (!dirty) text = urlQuery
    }
    LaunchedEffect(text, dirty) {
        if (!dirty) return@LaunchedEffect
        delay(200)
        dirty = false
        goSearch(text)
    }
    Div({ classes("global-search") }) {
        Label(forId = "global-search", attrs = { classes("sr-only") }) { Text("Search tasks") }
        IconView(Icon.Search, 16, "icon search-icon")
        Input(InputType.Search) {
            id("global-search")
            attr("data-testid", "global-search")
            attr("autocomplete", "off")
            placeholder("Search tasks…  ( / )")
            value(text)
            onInput {
                text = it.value
                dirty = true
            }
            onKeyDown { e ->
                if (e.key == "Enter") {
                    e.preventDefault()
                    dirty = false
                    goSearch(text)
                } else if (e.key == "Escape") {
                    (e.target as? org.w3c.dom.HTMLElement)?.blur()
                }
            }
        }
    }
}

private fun goSearch(text: String) {
    val onTasks = Router.route == Route.Tasks
    val base = if (onTasks) Router.params().toMutableMap() else mutableMapOf()
    if (onTasks && base["q"].orEmpty() == text.trim()) return
    if (text.isBlank()) base.remove("q") else base["q"] = text.trim()
    base.remove("page")
    base.remove(taskpilot.VIEW_PARAM)
    val order = listOf("q", "status", "priority", "project", "tag", "due", "sort", "dir", "page")
    val params = base.entries.sortedBy { order.indexOf(it.key).let { i -> if (i < 0) 99 else i } }.map { it.key to it.value }
    if (!onTasks && text.isBlank()) return
    Router.navigate(Router.buildUrl("/tasks", params), replace = onTasks)
}

@Composable
private fun PomodoroIndicator() {
    val id = Pomodoro.taskId ?: return
    if (!Pomodoro.running) return
    val task = Store.task(id)
    Button({
        classes("pomo-mini")
        attr("type", "button")
        attr("data-testid", "pomodoro-indicator")
        attr("title", "Pomodoro running for ${task?.title ?: "task"}")
        onClick { Router.navigate("/tasks/$id") }
    }) {
        Span({ classes("pomo-pulse") })
        IconView(Icon.Timer, 16)
        Span({ classes("pomo-mini-time") }) { Text(Pomodoro.format(Pomodoro.remainingMs())) }
    }
}

/** Single-key shortcuts; ignored while typing in form fields or when a dialog is open. */
@Composable
private fun GlobalShortcuts() {
    DisposableEffect(Unit) {
        var pendingG = 0.0
        val handler: (Event) -> Unit = handler@{ ev ->
            val e = ev as KeyboardEvent
            val mod = e.ctrlKey || e.metaKey
            val typing = Platform.isTypingTarget(e.target)
            val dialogOpen = document.querySelector("[aria-modal=true]") != null
            if (mod && !e.altKey && e.key.lowercase() == "z" && !typing && !dialogOpen) {
                e.preventDefault()
                if (e.shiftKey) Store.redo() else Store.undo()
                return@handler
            }
            if (mod && !e.altKey && e.key.lowercase() == "y" && !typing && !dialogOpen) {
                e.preventDefault()
                Store.redo()
                return@handler
            }
            if (e.key == "Escape") {
                if (Store.drawerOpen) Store.drawerOpen = false
                if (Store.notificationsOpen) Store.notificationsOpen = false
                return@handler
            }
            if (mod || e.altKey || typing || dialogOpen) return@handler
            val now = window.performance.now()
            if (now - pendingG < 1200) {
                pendingG = 0.0
                val target =
                    when (e.key) {
                        "d" -> "/dashboard"
                        "t" -> "/tasks"
                        "b" -> "/board"
                        "c" -> "/calendar"
                        "p" -> "/projects"
                        "s" -> "/settings"
                        "a" -> "/activity"
                        "l" -> "/timeline"
                        "r" -> "/reports"
                        else -> null
                    }
                if (target != null) {
                    e.preventDefault()
                    Router.navigate(target)
                    return@handler
                }
            }
            when (e.key) {
                "g" -> pendingG = now
                "n" -> {
                    e.preventDefault()
                    Store.openNewTask()
                }
                "/" -> {
                    e.preventDefault()
                    val list = document.querySelector("[data-testid=task-list-search]") as? org.w3c.dom.HTMLElement
                    (list ?: document.getElementById("global-search") as? org.w3c.dom.HTMLElement)?.focus()
                }
                "?" -> {
                    e.preventDefault()
                    Store.shortcutsOpen = true
                }
            }
        }
        document.addEventListener("keydown", handler)
        onDispose { document.removeEventListener("keydown", handler) }
    }
}

@Composable
private fun ShortcutHelp() {
    val close = { Store.shortcutsOpen = false }
    val mod = if (Platform.isMac) "⌘" else "Ctrl"
    Modal("shortcuts-title", close) {
        ModalHeader("shortcuts-title", "Keyboard shortcuts", close)
        Div({ classes("modal-body") }) {
            Table({ classes("shortcut-table") }) {
                Tbody {
                    listOf(
                        listOf("n") to "New task",
                        listOf("/") to "Focus search",
                        listOf("g", "d") to "Go to dashboard",
                        listOf("g", "t") to "Go to tasks",
                        listOf("g", "b") to "Go to board",
                        listOf("g", "c") to "Go to calendar",
                        listOf("g", "p") to "Go to projects",
                        listOf("g", "s") to "Go to settings",
                        listOf("g", "a") to "Go to activity",
                        listOf("g", "l") to "Go to timeline",
                        listOf("g", "r") to "Go to reports",
                        listOf("?") to "Show this help",
                        listOf("Esc") to "Close dialogs",
                        listOf(mod, "Z") to "Undo",
                        listOf(mod, "Shift", "Z") to "Redo",
                        listOf("Shift", "← →") to "Board: move focused card between columns",
                        listOf("Shift", "↑ ↓") to "Board: reorder focused card",
                    ).forEach { (keys, desc) ->
                        Tr {
                            Td {
                                keys.forEachIndexed { i, k ->
                                    if (i > 0) Span({ classes("kbd-sep") }) { Text(if (keys[0] == "g") "then" else "+") }
                                    Kbd { Text(k) }
                                }
                            }
                            Td { Text(desc) }
                        }
                    }
                }
            }
        }
    }
}
