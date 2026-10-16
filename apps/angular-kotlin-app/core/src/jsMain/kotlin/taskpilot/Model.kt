@file:OptIn(ExperimentalJsExport::class)

package taskpilot

import kotlin.math.pow

/** Allowed task statuses, in board-column order. */
@JsExport
object Status {
    const val TODO: String = "todo"
    const val IN_PROGRESS: String = "in_progress"
    const val DONE: String = "done"

    val all: Array<String> = arrayOf(TODO, IN_PROGRESS, DONE)

    fun label(status: String): String =
        when (status) {
            TODO -> "To do"
            IN_PROGRESS -> "In progress"
            DONE -> "Done"
            else -> status
        }
}

/** Allowed task priorities, lowest first. */
@JsExport
object Priority {
    const val LOW: String = "low"
    const val MEDIUM: String = "medium"
    const val HIGH: String = "high"
    const val URGENT: String = "urgent"

    val all: Array<String> = arrayOf(LOW, MEDIUM, HIGH, URGENT)

    fun rank(priority: String): Int = all.indexOf(priority)

    fun label(priority: String): String = priority.replaceFirstChar { it.uppercaseChar() }

    fun color(priority: String): String =
        when (priority) {
            LOW -> "#64748b"
            MEDIUM -> "#3b82f6"
            HIGH -> "#f59e0b"
            URGENT -> "#ef4444"
            else -> "#94a3b8"
        }
}

/** Theme preference values. */
@JsExport
object Theme {
    const val LIGHT: String = "light"
    const val DARK: String = "dark"
    const val SYSTEM: String = "system"

    val all: Array<String> = arrayOf(LIGHT, DARK, SYSTEM)

    /** Top-bar toggle: switches to the opposite of the currently *resolved* theme. */
    fun toggle(
        theme: String,
        prefersDark: Boolean,
    ): String = if (resolve(theme, prefersDark) == DARK) LIGHT else DARK

    /** Resolves the effective theme ("light" or "dark"). */
    fun resolve(
        theme: String,
        prefersDark: Boolean,
    ): String =
        when (theme) {
            LIGHT -> LIGHT
            DARK -> DARK
            else -> if (prefersDark) DARK else LIGHT
        }
}

/** Recurrence intervals; a completed recurring task spawns its next occurrence. */
@JsExport
object Recurrence {
    const val NONE: String = "none"
    const val DAILY: String = "daily"
    const val WEEKLY: String = "weekly"
    const val MONTHLY: String = "monthly"

    val all: Array<String> = arrayOf(NONE, DAILY, WEEKLY, MONTHLY)

    fun label(recurrence: String): String =
        when (recurrence) {
            DAILY -> "Daily"
            WEEKLY -> "Weekly"
            MONTHLY -> "Monthly"
            else -> "Does not repeat"
        }
}

/** A team member tasks can be assigned to. */
@JsExport
class Member(
    val id: String,
    val name: String,
    val color: String,
) {
    val initials: String get() = initialsOf(name)

    /** Text colour (dark or white) with sufficient contrast on [color]. */
    val textColor: String get() = readableTextColor(color)
}

/** A comment on a task. [authorId] references a [Member] (may dangle after the member is deleted). */
@JsExport
class Comment(
    val id: String,
    val authorId: String,
    val body: String,
    val createdAt: String,
)

@JsExport
class Project(
    val id: String,
    val name: String,
    val color: String,
    val createdAt: String,
    /** Parent project id (sub-projects, any depth, no cycles); null for a top-level project. */
    val parentId: String? = null,
    /** Own workflow; null = inherit the parent's (or the default workflow for top-level projects). */
    val workflow: Array<WorkflowStatus>? = null,
) {
    val hasOwnWorkflow: Boolean get() = workflow != null
}

@JsExport
class Subtask(
    val id: String,
    val title: String,
    val done: Boolean,
)

@JsExport
class Task(
    val id: String,
    val title: String,
    val description: String,
    val status: String,
    val priority: String,
    val projectId: String?,
    val tags: Array<String>,
    val dueDate: String?,
    val estimateMinutes: Int?,
    val timeSpentMinutes: Int,
    val subtasks: Array<Subtask>,
    val createdAt: String,
    val completedAt: String?,
    val order: Int,
    val assigneeId: String?,
    val recurrence: String,
    /** Ids of tasks that must be done before this one can be completed. */
    val blockedBy: Array<String> = emptyArray(),
    /** Comments, oldest first. */
    val comments: Array<Comment> = emptyArray(),
    /**
     * Category (todo / in_progress / done) of [status] in the task's effective workflow. A cached, derived value:
     * the store recomputes it (and `completedAt`) after every change, so all status-dependent logic reads it.
     */
    val category: String = categoryOfStatusId(status),
) {
    val isDone: Boolean get() = category == Status.DONE

    val subtasksDone: Int get() = subtasks.count { it.done }

    val isRecurring: Boolean get() = recurrence != Recurrence.NONE
}

@JsExport
class Settings(
    val theme: String,
    val pomodoroMinutes: Int,
    val pageSize: Int,
    /** Member acting as the current user (comment author, activity actor). */
    val currentUserId: String = DEFAULT_USER_ID,
) {
    companion object {
        const val DEFAULT_USER_ID: String = "m1"
        val DEFAULT: Settings = Settings(Theme.SYSTEM, 25, 25, DEFAULT_USER_ID)
    }
}

@JsExport
class AppState(
    val tasks: Array<Task>,
    val projects: Array<Project>,
    val settings: Settings,
    val members: Array<Member>,
    /** Activity log, oldest first (UI lists it newest first). */
    val activity: Array<ActivityEntry> = emptyArray(),
    /** Saved task-list views, in sidebar order. */
    val views: Array<SavedView> = emptyArray(),
    /** Notifications for all members, oldest first (not part of undo history). */
    val notifications: Array<AppNotification> = emptyArray(),
) {
    fun findTask(id: String): Task? = tasks.firstOrNull { it.id == id }

    fun findMember(id: String?): Member? = if (id == null) null else members.firstOrNull { it.id == id }

    fun findProject(id: String?): Project? = if (id == null) null else projects.firstOrNull { it.id == id }

    /** All distinct tags in use, sorted alphabetically. */
    fun allTags(): Array<String> =
        tasks
            .flatMap { it.tags.asList() }
            .distinct()
            .sorted()
            .toTypedArray()

    companion object {
        val EMPTY: AppState = AppState(emptyArray(), emptyArray(), Settings.DEFAULT, emptyArray())
    }
}

internal fun Task.copy(
    title: String = this.title,
    description: String = this.description,
    status: String = this.status,
    priority: String = this.priority,
    projectId: String? = this.projectId,
    tags: Array<String> = this.tags,
    dueDate: String? = this.dueDate,
    estimateMinutes: Int? = this.estimateMinutes,
    timeSpentMinutes: Int = this.timeSpentMinutes,
    subtasks: Array<Subtask> = this.subtasks,
    createdAt: String = this.createdAt,
    completedAt: String? = this.completedAt,
    order: Int = this.order,
    assigneeId: String? = this.assigneeId,
    recurrence: String = this.recurrence,
    blockedBy: Array<String> = this.blockedBy,
    comments: Array<Comment> = this.comments,
    category: String = this.category,
): Task =
    Task(
        id,
        title,
        description,
        status,
        priority,
        projectId,
        tags,
        dueDate,
        estimateMinutes,
        timeSpentMinutes,
        subtasks,
        createdAt,
        completedAt,
        order,
        assigneeId,
        recurrence,
        blockedBy,
        comments,
        category,
    )

/** Category implied by a status id when no workflow is known (the default workflow uses the category ids). */
internal fun categoryOfStatusId(status: String): String = if (status in Status.all) status else Status.TODO

internal fun Member.copy(
    name: String = this.name,
    color: String = this.color,
): Member = Member(id, name, color)

internal fun Project.copy(
    name: String = this.name,
    color: String = this.color,
    parentId: String? = this.parentId,
    workflow: Array<WorkflowStatus>? = this.workflow,
): Project = Project(id, name, color, createdAt, parentId, workflow)

internal fun Settings.copy(
    theme: String = this.theme,
    pomodoroMinutes: Int = this.pomodoroMinutes,
    pageSize: Int = this.pageSize,
    currentUserId: String = this.currentUserId,
): Settings = Settings(theme, pomodoroMinutes, pageSize, currentUserId)

internal fun AppState.copy(
    tasks: Array<Task> = this.tasks,
    projects: Array<Project> = this.projects,
    settings: Settings = this.settings,
    members: Array<Member> = this.members,
    activity: Array<ActivityEntry> = this.activity,
    views: Array<SavedView> = this.views,
    notifications: Array<AppNotification> = this.notifications,
): AppState = AppState(tasks, projects, settings, members, activity, views, notifications)

/** Initials for an avatar: first letters of the first and last word, or the first two letters of a single word. */
internal fun initialsOf(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    return when {
        words.isEmpty() -> "?"
        words.size == 1 -> words[0].take(2).uppercase()
        else -> (words.first().take(1) + words.last().take(1)).uppercase()
    }
}

/** "#ffffff" or a near-black, whichever contrasts better with the hex background (WCAG relative luminance). */
internal fun readableTextColor(hex: String): String {
    if (!isHexColor(hex)) return "#ffffff"

    fun channel(i: Int): Double {
        val c = hex.substring(i, i + 2).toInt(16) / 255.0
        return if (c <= 0.03928) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
    }
    val l = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
    val contrastWhite = 1.05 / (l + 0.05)
    val contrastDark = (l + 0.05) / 0.0587 // #0f172a has luminance ~0.0087
    return if (contrastWhite >= contrastDark) "#ffffff" else "#0f172a"
}
