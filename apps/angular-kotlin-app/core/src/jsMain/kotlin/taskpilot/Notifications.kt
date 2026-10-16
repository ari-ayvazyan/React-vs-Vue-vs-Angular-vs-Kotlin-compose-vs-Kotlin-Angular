@file:OptIn(ExperimentalJsExport::class)

package taskpilot

/** A notification for one member ([userId]). [key] de-duplicates (e.g. one due reminder per task per day). */
@JsExport
class AppNotification(
    val id: String,
    val userId: String,
    val type: String,
    val taskId: String,
    val text: String,
    val at: String,
    val read: Boolean,
    val key: String,
) {
    internal fun markedRead(): AppNotification = if (read) this else AppNotification(id, userId, type, taskId, text, at, true, key)
}

@JsExport
object NotificationType {
    const val ASSIGNED: String = "assigned"
    const val MENTIONED: String = "mentioned"
    const val DUE: String = "due"
    const val BLOCKER_DONE: String = "blocker_done"

    val all: Array<String> = arrayOf(ASSIGNED, MENTIONED, DUE, BLOCKER_DONE)
}

internal const val NOTIFICATION_LIMIT = 500

/**
 * Notifications caused by the change from [before] to [after]: assignments, @mentions in new comments and
 * completed blockers (sent to the assignee of each still-open blocked task). Every member is a possible
 * recipient; the UI shows those of the current user. Actions by the current user on their own tasks also notify,
 * since in this local app every action is performed by the current user.
 */
internal fun changeNotifications(
    before: AppState,
    after: AppState,
    at: String,
    newId: () -> String,
): List<AppNotification> {
    if (before.tasks === after.tasks) return emptyList()
    val old = before.tasks.associateBy { it.id }
    val out = mutableListOf<AppNotification>()

    fun notify(
        userId: String?,
        type: String,
        task: Task,
        text: String,
    ) {
        if (userId == null || after.findMember(userId) == null) return
        val id = newId()
        out += AppNotification(id, userId, type, task.id, text, at, false, "$type:$id")
    }

    val newlyDone = mutableListOf<Task>()
    for (t in after.tasks) {
        val o = old[t.id]
        if (t.assigneeId != null && t.assigneeId != o?.assigneeId) {
            notify(t.assigneeId, NotificationType.ASSIGNED, t, "You were assigned “${t.title}”.")
        }
        if (o != null && o.comments !== t.comments) {
            val known = o.comments.mapTo(HashSet()) { it.id }
            for (c in t.comments.filter { it.id !in known }) {
                val author = after.findMember(c.authorId)?.name ?: "Someone"
                renderComment(c.body, after.members)
                    .mapNotNull { seg -> seg.memberId.ifEmpty { null } }
                    .distinct()
                    .forEach { notify(it, NotificationType.MENTIONED, t, "$author mentioned you on “${t.title}”.") }
            }
        }
        if (o != null && !o.isDone && t.isDone) newlyDone += t
    }
    for (blocker in newlyDone) {
        for (t in after.tasks) {
            if (blocker.id in t.blockedBy && !t.isDone) {
                notify(t.assigneeId, NotificationType.BLOCKER_DONE, t, "Blocker “${blocker.title}” of “${t.title}” was completed.")
            }
        }
    }
    return out
}

/**
 * Due reminders for [userId]: open tasks assigned to them that are overdue or due within 24 hours
 * (today or tomorrow). At most one per task per day, enforced by the key `due:<task>:<day>`.
 */
internal fun dueNotifications(
    state: AppState,
    userId: String,
    today: Int,
    at: String,
    newId: () -> String,
): List<AppNotification> {
    if (state.findMember(userId) == null) return emptyList()
    val existing = state.notifications.mapTo(HashSet()) { it.key }
    val day = formatDay(today)
    return state.tasks
        .filter { it.assigneeId == userId && !it.isDone }
        .mapNotNull { t ->
            val due = parseDay(t.dueDate) ?: return@mapNotNull null
            if (due > today + 1) return@mapNotNull null
            val key = "${NotificationType.DUE}:${t.id}:$day"
            if (key in existing) return@mapNotNull null
            val text =
                when {
                    due < today -> "“${t.title}” is overdue (due ${DateFmt.short(t.dueDate)})."
                    due == today -> "“${t.title}” is due today."
                    else -> "“${t.title}” is due tomorrow."
                }
            AppNotification(newId(), userId, NotificationType.DUE, t.id, text, at, false, key)
        }
}

/** Appends notifications, keeping only the newest [NOTIFICATION_LIMIT]. */
internal fun withNotifications(
    state: AppState,
    added: List<AppNotification>,
): AppState {
    if (added.isEmpty()) return state
    val all = state.notifications + added
    return state.copy(notifications = if (all.size > NOTIFICATION_LIMIT) all.copyOfRange(all.size - NOTIFICATION_LIMIT, all.size) else all)
}

/** Notifications of [userId], newest first. */
@JsExport
fun notificationsFor(
    state: AppState,
    userId: String,
): Array<AppNotification> =
    state.notifications
        .filter { it.userId == userId }
        .asReversed()
        .toTypedArray()

@JsExport
fun unreadCount(
    state: AppState,
    userId: String,
): Int = state.notifications.count { it.userId == userId && !it.read }
