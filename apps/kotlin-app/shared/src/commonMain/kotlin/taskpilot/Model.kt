package taskpilot

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class Priority(val label: String, val rank: Int) {
    @SerialName("low")
    LOW("Low", 0),

    @SerialName("medium")
    MEDIUM("Medium", 1),

    @SerialName("high")
    HIGH("High", 2),

    @SerialName("urgent")
    URGENT("Urgent", 3),
    ;

    val key: String get() = name.lowercase()

    companion object {
        fun fromKey(key: String): Priority? = entries.firstOrNull { it.key == key }
    }
}

@Serializable
enum class Status(val label: String) {
    @SerialName("todo")
    TODO("To do"),

    @SerialName("in_progress")
    IN_PROGRESS("In progress"),

    @SerialName("done")
    DONE("Done"),
    ;

    val key: String get() = name.lowercase()

    companion object {
        fun fromKey(key: String): Status? = entries.firstOrNull { it.key == key }
    }
}

@Serializable
data class Project(
    val id: String,
    val name: String,
    val color: String,
    val createdAt: String,
    /** Parent project (any depth, never a cycle); null for a top-level project. */
    val parentId: String? = null,
    /** Custom workflow; null inherits the parent's (or the default workflow at the top level). */
    val workflow: List<WorkflowStatus>? = null,
)

/** One column/state of a project workflow. [category] drives all status-dependent logic. */
@Serializable
data class WorkflowStatus(
    val id: String,
    val name: String,
    val color: String,
    val category: Status,
)

@Serializable
data class Subtask(
    val id: String,
    val title: String,
    val done: Boolean,
)

@Serializable
data class Task(
    val id: String,
    val title: String,
    val description: String = "",
    /** The workflow status' category (kept in sync with [statusId] by [normalizeTasks]). */
    val status: Status = Status.TODO,
    /** Id of the status in the task's project workflow. Old (v1) data defaults to the category key. */
    val statusId: String = status.key,
    val priority: Priority = Priority.MEDIUM,
    val projectId: String? = null,
    val tags: List<String> = emptyList(),
    val dueDate: String? = null,
    val estimateMinutes: Int? = null,
    val timeSpentMinutes: Int = 0,
    val subtasks: List<Subtask> = emptyList(),
    val createdAt: String,
    val completedAt: String? = null,
    val order: Int = 0,
    val assigneeId: String? = null,
    val recurrence: Recurrence = Recurrence.NONE,
    val blockedBy: List<String> = emptyList(),
    val comments: List<Comment> = emptyList(),
)

@Serializable
data class Comment(
    val id: String,
    val authorId: String?,
    val body: String,
    val createdAt: String,
)

@Serializable
enum class Recurrence(val label: String) {
    @SerialName("none")
    NONE("Does not repeat"),

    @SerialName("daily")
    DAILY("Daily"),

    @SerialName("weekly")
    WEEKLY("Weekly"),

    @SerialName("monthly")
    MONTHLY("Monthly"),
    ;

    val key: String get() = name.lowercase()

    companion object {
        fun fromKey(key: String): Recurrence? = entries.firstOrNull { it.key == key }
    }
}

@Serializable
data class Member(
    val id: String,
    val name: String,
    val color: String,
)

@Serializable
enum class ThemeMode {
    @SerialName("light")
    LIGHT,

    @SerialName("dark")
    DARK,

    @SerialName("system")
    SYSTEM,
}

@Serializable
data class Settings(
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val pomodoroMinutes: Int = 25,
    val pageSize: Int = 25,
    val currentUserId: String? = DEFAULT_CURRENT_USER,
)

const val DEFAULT_CURRENT_USER = "m1"

@Serializable
data class AppState(
    val tasks: List<Task> = emptyList(),
    val projects: List<Project> = emptyList(),
    val settings: Settings = Settings(),
    val members: List<Member> = emptyList(),
    val activity: List<ActivityEntry> = emptyList(),
    val views: List<SavedView> = emptyList(),
    val notifications: List<Notification> = emptyList(),
    val schemaVersion: Int = SCHEMA_VERSION,
)

/** Storage/export schema: 1 = original, 2 = sub-projects + workflows (task.statusId). */
const val SCHEMA_VERSION = 2

/**
 * Returns a copy moved to category [status], maintaining `completedAt` per spec. The status id is
 * set to the category key as a hint; [normalizeTasks] maps it to the first status of that
 * category in the task's workflow.
 */
fun Task.withStatus(status: Status, nowIso: String): Task =
    when {
        status == this.status -> this
        status == Status.DONE -> copy(status = status, statusId = status.key, completedAt = nowIso)
        else -> copy(status = status, statusId = status.key, completedAt = null)
    }

/** Moves to a concrete workflow status; `completedAt` follows the category transition. */
fun Task.withWorkflowStatus(ws: WorkflowStatus, nowIso: String): Task = withStatus(ws.category, nowIso).copy(statusId = ws.id)
