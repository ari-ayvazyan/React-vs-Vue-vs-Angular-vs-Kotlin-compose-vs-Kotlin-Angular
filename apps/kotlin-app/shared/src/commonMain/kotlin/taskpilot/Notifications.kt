package taskpilot

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class NotificationType {
    @SerialName("assigned")
    ASSIGNED,

    @SerialName("mentioned")
    MENTIONED,

    @SerialName("due_soon")
    DUE_SOON,

    @SerialName("overdue")
    OVERDUE,

    @SerialName("blocker_done")
    BLOCKER_DONE,
}

/**
 * A notification for member [userId] about [taskId]. [key] de-duplicates time-based notifications
 * (one due/overdue reminder per task per day).
 */
@Serializable
data class Notification(
    val id: String,
    val userId: String,
    val type: NotificationType,
    val taskId: String,
    val message: String,
    val at: String,
    val read: Boolean = false,
    val key: String? = null,
)

/** Older read notifications are dropped first once more than this many are stored. */
const val NOTIFICATION_LIMIT = 300

/**
 * Event notifications caused by a change from [before] to [after], done by [actorName]:
 * assignment (to the new assignee), mentions in new comments (to each mentioned member) and a
 * completed blocker (to the assignee of every open task it blocks). Tasks in [generatedTaskIds]
 * (e.g. the next occurrence of a recurring task) were created by the app, not assigned by anyone,
 * so they do not produce an assignment notification.
 */
fun notificationsForChange(
    before: List<Task>,
    after: List<Task>,
    members: List<Member>,
    actorName: String,
    at: String,
    newId: () -> String,
    generatedTaskIds: Set<String> = emptySet(),
): List<Notification> {
    if (before === after) return emptyList()
    val memberIds = members.map { it.id }.toSet()
    val old = before.associateBy { it.id }
    val out = mutableListOf<Notification>()
    for (t in after) {
        val o = old[t.id]
        if (o === t) continue
        val assignee = t.assigneeId
        if (assignee != null && assignee in memberIds && assignee != o?.assigneeId && t.id !in generatedTaskIds) {
            out += Notification(newId(), assignee, NotificationType.ASSIGNED, t.id, "$actorName assigned you \"${t.title}\"", at)
        }
        val oldComments =
            o
                ?.comments
                ?.map { it.id }
                ?.toSet()
                .orEmpty()
        t.comments.filter { it.id !in oldComments }.forEach { c ->
            mentionedMemberIds(c.body, members).forEach { m ->
                out += Notification(newId(), m, NotificationType.MENTIONED, t.id, "$actorName mentioned you on \"${t.title}\"", at)
            }
        }
        if (o != null && o.status != Status.DONE && t.status == Status.DONE) {
            after
                .filter { d -> t.id in d.blockedBy && d.status != Status.DONE && d.assigneeId != null && d.assigneeId in memberIds }
                .forEach { d ->
                    out +=
                        Notification(
                            newId(),
                            d.assigneeId!!,
                            NotificationType.BLOCKER_DONE,
                            d.id,
                            "Blocker \"${t.title}\" of \"${d.title}\" was completed",
                            at,
                        )
                }
        }
    }
    return out
}

/**
 * Due-date reminders for [userId]: one per open assigned task per day, "overdue" when the due day
 * has passed, "due soon" when it is due within 24 hours (today or tomorrow). Skips keys already
 * present in [existing].
 */
fun dueNotifications(
    tasks: List<Task>,
    existing: List<Notification>,
    userId: String,
    today: Int,
    at: String,
    newId: () -> String,
): List<Notification> {
    val seen = existing.mapNotNull { it.key }.toHashSet()
    val out = mutableListOf<Notification>()
    for (t in tasks) {
        if (t.assigneeId != userId || t.status == Status.DONE) continue
        val due = t.dueDay() ?: continue
        val type =
            when {
                due < today -> NotificationType.OVERDUE
                due <= today + 1 -> NotificationType.DUE_SOON
                else -> continue
            }
        val key = "due:$userId:${t.id}:$today"
        if (key in seen) continue
        seen += key
        val message =
            when {
                type == NotificationType.OVERDUE -> "\"${t.title}\" is overdue (due ${t.dueDate})"
                due == today -> "\"${t.title}\" is due today"
                else -> "\"${t.title}\" is due tomorrow"
            }
        out += Notification(newId(), userId, type, t.id, message, at, key = key)
    }
    return out
}

/** Appends [added] and trims to [NOTIFICATION_LIMIT], dropping the oldest read ones first. */
fun appendNotifications(list: List<Notification>, added: List<Notification>): List<Notification> {
    if (added.isEmpty()) return list
    val all = list + added
    if (all.size <= NOTIFICATION_LIMIT) return all
    var excess = all.size - NOTIFICATION_LIMIT
    val dropRead =
        all
            .filter { it.read }
            .take(excess)
            .map { it.id }
            .toSet()
    excess -= dropRead.size
    return all.filterNot { it.id in dropRead }.drop(excess)
}

fun unreadCount(list: List<Notification>, userId: String?): Int = list.count { it.userId == userId && !it.read }

/** The user's notifications, newest first. */
fun notificationsFor(list: List<Notification>, userId: String?): List<Notification> = list.filter { it.userId == userId }.asReversed()

fun markRead(list: List<Notification>, id: String): List<Notification> = list.map { if (it.id == id) it.copy(read = true) else it }

fun markAllRead(list: List<Notification>, userId: String): List<Notification> =
    list.map { if (it.userId == userId && !it.read) it.copy(read = true) else it }
