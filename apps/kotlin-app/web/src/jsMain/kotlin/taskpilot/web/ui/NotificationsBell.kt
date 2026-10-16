package taskpilot.web.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import kotlinx.browser.document
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.H2
import org.jetbrains.compose.web.dom.Li
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.dom.Ul
import org.w3c.dom.HTMLElement
import org.w3c.dom.Node
import org.w3c.dom.events.Event
import taskpilot.Notification
import taskpilot.NotificationType
import taskpilot.notificationsFor
import taskpilot.unreadCount
import taskpilot.web.Router
import taskpilot.web.Store

private fun iconFor(type: NotificationType) =
    when (type) {
        NotificationType.ASSIGNED -> Icon.Users
        NotificationType.MENTIONED -> Icon.Message
        NotificationType.DUE_SOON -> Icon.Clock
        NotificationType.OVERDUE -> Icon.Alert
        NotificationType.BLOCKER_DONE -> Icon.Lock
    }

/** Top-bar bell with unread badge and a dropdown panel of the current user's notifications. */
@Composable
fun NotificationsBell() {
    val user = Store.currentUser
    val all = Store.notifications
    val mine = remember(all, user?.id) { notificationsFor(all, user?.id) }
    val unread = remember(all, user?.id) { unreadCount(all, user?.id) }
    val open = Store.notificationsOpen
    val holder = remember { arrayOfNulls<HTMLElement>(1) }

    // Close on outside click while open.
    DisposableEffect(open) {
        if (!open) {
            onDispose { }
        } else {
            val listener: (Event) -> Unit = { e ->
                val root = holder[0]
                if (root != null && !root.contains(e.target as? Node)) Store.notificationsOpen = false
            }
            document.addEventListener("mousedown", listener)
            onDispose { document.removeEventListener("mousedown", listener) }
        }
    }

    Div({
        classes("notif-wrap")
        ref { el ->
            holder[0] = el
            onDispose { holder[0] = null }
        }
        onKeyDown { e ->
            if (e.key == "Escape" && open) {
                e.stopPropagation()
                Store.notificationsOpen = false
                (holder[0]?.querySelector("[data-testid=notifications-bell]") as? HTMLElement)?.focus()
            }
        }
    }) {
        Button({
            classes("icon-btn", "bell-btn")
            attr("type", "button")
            attr("data-testid", "notifications-bell")
            attr("aria-haspopup", "true")
            attr("aria-expanded", open.toString())
            attr("aria-controls", "notifications-panel")
            val label = if (unread == 0) "Notifications" else "Notifications, $unread unread"
            attr("aria-label", label)
            attr("title", label)
            onClick { Store.notificationsOpen = !open }
        }) {
            IconView(Icon.Bell)
            if (unread > 0) {
                Span({
                    classes("bell-count")
                    attr("data-testid", "notifications-count")
                    attr("aria-hidden", "true")
                }) { Text(if (unread > 99) "99+" else unread.toString()) }
            }
        }
        if (open) {
            Div({
                classes("notif-panel")
                id("notifications-panel")
                attr("role", "region")
                attr("aria-label", "Notifications")
                attr("data-testid", "notifications-panel")
            }) {
                Div({ classes("notif-head") }) {
                    H2 { Text("Notifications") }
                    Button({
                        classes("btn", "btn-ghost", "btn-sm")
                        attr("type", "button")
                        attr("data-testid", "notifications-mark-all")
                        if (unread == 0) attr("disabled", "")
                        onClick { Store.markAllNotificationsRead() }
                    }) {
                        IconView(Icon.Check, 14)
                        Text("Mark all as read")
                    }
                }
                when {
                    user == null ->
                        P(
                            { classes("muted", "notif-empty") },
                        ) { Text("Choose a current user in Settings to receive notifications.") }
                    mine.isEmpty() -> P({ classes("muted", "notif-empty") }) { Text("You're all caught up.") }
                    else ->
                        Ul({ classes("notif-list") }) {
                            mine.take(100).forEach { n -> NotificationItem(n) }
                        }
                }
                if (user != null) {
                    P({ classes("notif-foot", "muted", "small") }) { Text("Showing notifications for ${user.name}.") }
                }
            }
        }
    }
}

@Composable
private fun NotificationItem(n: Notification) {
    Li({
        classes("notif-item", "nt-${n.type.name.lowercase()}")
        if (!n.read) classes("unread")
        attr("data-testid", "notification-item")
        attr("data-read", n.read.toString())
    }) {
        Button({
            classes("notif-open")
            attr("type", "button")
            attr("data-testid", "notification-open")
            onClick {
                Store.markNotificationRead(n.id)
                Store.notificationsOpen = false
                Router.navigate("/tasks/${n.taskId}")
            }
        }) {
            Span({ classes("notif-icon") }) { IconView(iconFor(n.type), 16) }
            Span({ classes("notif-text") }) {
                Span({ classes("notif-msg") }) { Text(n.message) }
                Span({ classes("muted", "small") }) {
                    Text(formatDateTime(n.at) + if (Store.task(n.taskId) == null) " · task deleted" else "")
                }
            }
            if (!n.read) {
                Span({
                    classes("unread-dot")
                    attr("aria-label", "Unread")
                })
            }
        }
        if (!n.read) {
            IconButton(Icon.Check, "Mark as read", testId = "notification-mark-read", extraClass = "subtle") {
                Store.markNotificationRead(n.id)
            }
        }
    }
}
