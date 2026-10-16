package taskpilot.web.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.web.attributes.SelectAttrsScope
import kotlinx.browser.document
import kotlinx.browser.window
import org.jetbrains.compose.web.attributes.selected
import org.jetbrains.compose.web.dom.A
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.Option
import org.jetbrains.compose.web.dom.Select
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.events.SyntheticKeyboardEvent
import org.w3c.dom.HTMLElement
import org.w3c.dom.HTMLSelectElement
import org.w3c.dom.asList
import taskpilot.Priority
import taskpilot.Project
import taskpilot.Status
import taskpilot.web.Router
import taskpilot.web.Store
import taskpilot.workflowStatus

private const val FOCUSABLE =
    "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), " +
        "textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"

private fun focusables(root: HTMLElement): List<HTMLElement> =
    root.querySelectorAll(FOCUSABLE).asList().filterIsInstance<HTMLElement>().filter {
        it.offsetParent != null ||
            it == document.activeElement
    }

/**
 * Accessible modal dialog: traps Tab focus, closes on Esc or backdrop click, and restores
 * focus to the previously focused element when it leaves the composition.
 */
@Composable
fun Modal(
    titleId: String,
    onClose: () -> Unit,
    testId: String? = null,
    wide: Boolean = false,
    content: @Composable () -> Unit,
) {
    Div({
        classes("modal-backdrop")
        onMouseDown { e -> if (e.target == e.currentTarget) onClose() }
    }) {
        Div({
            classes("modal")
            if (wide) classes("modal-wide")
            attr("role", "dialog")
            attr("aria-modal", "true")
            attr("aria-labelledby", titleId)
            testId?.let { attr("data-testid", it) }
            tabIndex(-1)
            onKeyDown { e -> handleModalKey(e, onClose) }
            ref { el ->
                val previous = document.activeElement as? HTMLElement
                val target = el.querySelector("[data-autofocus]") as? HTMLElement ?: focusables(el).firstOrNull() ?: el
                target.focus()
                onDispose {
                    // Restore focus after the DOM settles (the trigger may have re-rendered).
                    window.setTimeout({ if (previous != null && document.body?.contains(previous) == true) previous.focus() }, 0)
                }
            }
        }) { content() }
    }
}

private fun handleModalKey(e: SyntheticKeyboardEvent, onClose: () -> Unit) {
    when (e.key) {
        "Escape" -> {
            e.preventDefault()
            e.stopPropagation()
            onClose()
        }
        "Tab" -> {
            val root = e.currentTarget as? HTMLElement ?: return
            val items = focusables(root)
            if (items.isEmpty()) {
                e.preventDefault()
                return
            }
            val active = document.activeElement
            if (e.shiftKey && (active == items.first() || active == root)) {
                e.preventDefault()
                items.last().focus()
            } else if (!e.shiftKey && active == items.last()) {
                e.preventDefault()
                items.first().focus()
            }
        }
    }
}

@Composable
fun ModalHeader(titleId: String, title: String, onClose: () -> Unit) {
    Div({ classes("modal-header") }) {
        org.jetbrains.compose.web.dom
            .H2({ id(titleId) }) { Text(title) }
        IconButton(Icon.Close, "Close dialog", onClick = onClose)
    }
}

@Composable
fun IconButton(icon: Icon, label: String, testId: String? = null, extraClass: String? = null, onClick: () -> Unit) {
    Button({
        classes("icon-btn")
        extraClass?.let { classes(it) }
        attr("type", "button")
        attr("aria-label", label)
        attr("title", label)
        testId?.let { attr("data-testid", it) }
        onClick { onClick() }
    }) { IconView(icon) }
}

/** Select whose DOM value is kept in sync with [value] (Compose HTML has no controlled select). */
@Composable
fun SelectField(
    value: String,
    options: List<Pair<String, String>>,
    onChange: (String) -> Unit,
    attrs: (SelectAttrsScope.() -> Unit)? = null,
) {
    val holder = remember { arrayOfNulls<HTMLSelectElement>(1) }
    Select({
        ref { el ->
            holder[0] = el
            el.value = value
            onDispose { holder[0] = null }
        }
        onChange { e -> e.value?.let(onChange) }
        attrs?.invoke(this)
    }) {
        options.forEach { (v, label) ->
            Option(v, { if (v == value) selected() }) { Text(label) }
        }
    }
    SideEffect { holder[0]?.let { if (it.value != value) it.value = value } }
}

/** In-app link: real href (open in new tab works) but navigates via the History API. */
@Composable
fun Link(href: String, className: String? = null, testId: String? = null, content: @Composable () -> Unit) {
    A(href, {
        className?.let { classes(*it.split(' ').toTypedArray()) }
        testId?.let { attr("data-testid", it) }
        onClick { e ->
            if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button.toInt() == 0) {
                e.preventDefault()
                Store.drawerOpen = false
                Router.navigate(href)
            }
        }
    }) { content() }
}

/** Options for assignee filters: any, unassigned, then every member. */
fun assigneeFilterOptions(): List<Pair<String, String>> =
    listOf("" to "All assignees", taskpilot.UNASSIGNED to "Unassigned") + Store.members.map { it.id to it.name }

@Composable
fun PriorityBadge(priority: Priority) {
    Span({ classes("badge", "prio-${priority.key}") }) { Text(priority.label) }
}

@Composable
fun StatusBadge(status: Status) {
    Span({ classes("badge", "status-${status.key}") }) { Text(status.label) }
}

/** Badge with the task's workflow status name and colour (category class kept for the default look). */
@Composable
fun StatusBadge(task: taskpilot.Task) {
    val ws = task.workflowStatus(Store.projects)
    val isDefault = taskpilot.DEFAULT_WORKFLOW.any { it == ws }
    Span({
        classes("badge", "status-${ws.category.key}")
        if (!isDefault) {
            classes("status-custom")
            style { property("--status-color", ws.color) }
        }
        attr("data-status-id", ws.id)
        attr("title", "${ws.name} (${ws.category.label})")
    }) { Text(ws.name) }
}

/** Project options in tree order, indented by depth (for selects). */
fun projectOptions(): List<Pair<String, String>> =
    taskpilot.projectTree(Store.projects).map { (p, depth) ->
        p.id to
            ("\u00A0\u00A0".repeat(depth) + (if (depth > 0) "↳ " else "") + p.name)
    }

@Composable
fun ProjectChip(project: Project?) {
    if (project == null) {
        Span({ classes("chip", "chip-muted") }) { Text("No project") }
    } else {
        Span({ classes("chip") }) {
            Span({
                classes("dot")
                style { property("background", project.color) }
                attr("aria-hidden", "true")
            })
            Text(project.name)
        }
    }
}

@Composable
fun TagChip(tag: String) {
    Span({ classes("tag") }) { Text("#$tag") }
}

@Composable
fun EmptyState(title: String, body: String, action: (@Composable () -> Unit)? = null) {
    Div({ classes("empty") }) {
        Div({ classes("empty-title") }) { Text(title) }
        Div({ classes("empty-body") }) { Text(body) }
        action?.invoke()
    }
}

@Composable
fun Toasts() {
    Div({
        classes("toasts")
        attr("aria-live", "polite")
        attr("role", "status")
    }) {
        Store.toasts.forEach { t ->
            Div({
                classes("toast", "toast-${t.tone}")
                attr("data-testid", "toast")
            }) {
                Span({ classes("toast-msg") }) { Text(t.message) }
                if (t.actionLabel != null && t.action != null) {
                    Button({
                        classes("toast-action")
                        attr("type", "button")
                        onClick {
                            Store.dismissToast(t.id)
                            t.action.invoke()
                        }
                    }) { Text(t.actionLabel) }
                }
                Button({
                    classes("toast-close")
                    attr("type", "button")
                    attr("aria-label", "Dismiss notification")
                    onClick { Store.dismissToast(t.id) }
                }) { IconView(Icon.Close, 14) }
            }
        }
    }
}

fun formatMinutes(minutes: Int): String =
    when {
        minutes < 60 -> "${minutes}m"
        minutes % 60 == 0 -> "${minutes / 60}h"
        else -> "${minutes / 60}h ${minutes % 60}m"
    }

@Composable
fun Kbd(
    attrs: org.jetbrains.compose.web.dom.AttrBuilderContext<HTMLElement>? = null,
    content: org.jetbrains.compose.web.dom.ContentBuilder<HTMLElement>? = null,
) = org.jetbrains.compose.web.dom
    .TagElement("kbd", attrs, content)

/** Round avatar with the member's initials on their colour (text colour picked for contrast). */
@Composable
fun Avatar(member: taskpilot.Member?, size: String = "sm", showTitle: Boolean = true) {
    if (member == null) {
        Span({
            classes("avatar", "avatar-$size", "avatar-empty")
            attr("data-testid", "avatar")
            attr("role", "img")
            attr("aria-label", "Unassigned")
            if (showTitle) attr("title", "Unassigned")
        }) { Text("–") }
        return
    }
    Span({
        classes("avatar", "avatar-$size")
        attr("data-testid", "avatar")
        attr("role", "img")
        attr("aria-label", "Assigned to ${member.name}")
        if (showTitle) attr("title", member.name)
        style {
            property("background", member.color)
            property("color", taskpilot.readableTextColor(member.color))
        }
    }) { Text(taskpilot.initials(member.name)) }
}

/** Small "repeats" marker for recurring tasks. */
@Composable
fun RecurrenceIcon(recurrence: taskpilot.Recurrence) {
    if (recurrence == taskpilot.Recurrence.NONE) return
    Span({
        classes("recur")
        attr("data-testid", "recurrence-icon")
        attr("role", "img")
        attr("aria-label", "Repeats ${recurrence.label.lowercase()}")
        attr("title", "Repeats ${recurrence.label.lowercase()}")
    }) { IconView(Icon.Repeat, 13) }
}

/** "Blocked" marker for tasks with open blockers; [blockers] are listed in the tooltip. */
@Composable
fun BlockedBadge(blockers: List<taskpilot.Task>) {
    val names = blockers.joinToString(", ") { "\"${it.title}\"" }
    Span({
        classes("badge", "badge-blocked")
        attr("data-testid", "blocked-indicator")
        attr("title", "Blocked by $names")
        attr("aria-label", "Blocked by $names")
    }) {
        IconView(Icon.Lock, 12)
        Text("Blocked")
    }
}

private val dateTimeOptions: kotlin.js.Date.LocaleOptions =
    kotlin.js.dateLocaleOptions {
        month = "short"
        day = "numeric"
        hour = "2-digit"
        minute = "2-digit"
    }

/** Local, human readable timestamp such as "Oct 16, 02:05 PM". */
fun formatDateTime(iso: String): String {
    val ms = taskpilot.Dates.millisFromIso(iso) ?: return iso
    return kotlin.js.Date(ms.toDouble()).toLocaleString("en-US", dateTimeOptions)
}
