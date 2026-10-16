@file:OptIn(ExperimentalJsExport::class)

package taskpilot

/** Field limits from the spec. */
@JsExport
object Limits {
    const val TITLE_MAX: Int = 120
    const val DESCRIPTION_MAX: Int = 2000
    const val TAGS_MAX: Int = 8
    const val PROJECT_NAME_MAX: Int = 40
    const val MEMBER_NAME_MAX: Int = 60
    const val COMMENT_MAX: Int = 2000
    const val SUBTASK_TITLE_MAX: Int = 120
    const val POMODORO_MIN: Int = 1
    const val POMODORO_MAX: Int = 120
    val PAGE_SIZES: Array<Int> = arrayOf(10, 25, 50, 100)
}

/** Raw form input for creating / editing a task. Text fields are validated and normalized by [validateTaskDraft]. */
@JsExport
class TaskDraft(
    val title: String,
    val description: String,
    val status: String,
    val priority: String,
    val projectId: String,
    val tagsText: String,
    val dueDate: String,
    val estimateText: String,
    val assigneeId: String,
    val recurrence: String,
) {
    companion object {
        fun empty(): TaskDraft = TaskDraft("", "", Status.TODO, Priority.MEDIUM, "", "", "", "", "", Recurrence.NONE)

        fun fromTask(task: Task): TaskDraft =
            TaskDraft(
                task.title,
                task.description,
                task.status,
                task.priority,
                task.projectId.orEmpty(),
                task.tags.joinToString(", "),
                task.dueDate.orEmpty(),
                task.estimateMinutes?.toString().orEmpty(),
                task.assigneeId.orEmpty(),
                task.recurrence,
            )
    }
}

@JsExport
class FieldError(
    val field: String,
    val message: String,
)

@JsExport
class DraftValidation(
    val errors: Array<FieldError>,
) {
    val valid: Boolean get() = errors.isEmpty()

    /** First error message for [field], or "" when the field is valid. */
    fun error(field: String): String = errors.firstOrNull { it.field == field }?.message.orEmpty()
}

/** Splits free tag text on commas / whitespace, lowercases, strips a leading '#', and de-duplicates. */
@JsExport
fun parseTags(text: String): Array<String> =
    text
        .split(Regex("[,\\s]+"))
        .map { it.trim().removePrefix("#").lowercase() }
        .filter { it.isNotEmpty() }
        .distinct()
        .toTypedArray()

internal fun parseEstimate(text: String): Int? = text.trim().takeIf { Regex("^\\d+$").matches(it) }?.toIntOrNull()

/** Validates a task draft; returns inline field errors (empty when valid). */
@JsExport
fun validateTaskDraft(draft: TaskDraft): DraftValidation {
    val errors = mutableListOf<FieldError>()
    val title = draft.title.trim()
    if (title.isEmpty()) {
        errors += FieldError("title", "Title is required.")
    } else if (title.length > Limits.TITLE_MAX) {
        errors += FieldError("title", "Title must be at most ${Limits.TITLE_MAX} characters (currently ${title.length}).")
    }
    if (draft.description.length > Limits.DESCRIPTION_MAX) {
        errors +=
            FieldError(
                "description",
                "Description must be at most ${Limits.DESCRIPTION_MAX} characters (currently ${draft.description.length}).",
            )
    }
    val tags = parseTags(draft.tagsText)
    if (tags.size > Limits.TAGS_MAX) {
        errors += FieldError("tags", "At most ${Limits.TAGS_MAX} tags are allowed (currently ${tags.size}).")
    } else if (tags.any { it.length > 30 }) {
        errors += FieldError("tags", "Each tag must be at most 30 characters.")
    }
    val est = draft.estimateText.trim()
    if (est.isNotEmpty()) {
        val value = parseEstimate(est)
        if (value == null || value <= 0) errors += FieldError("estimate", "Estimate must be a positive whole number of minutes.")
    }
    if (draft.dueDate.isNotEmpty() && parseDay(draft.dueDate) == null) {
        errors += FieldError("dueDate", "Due date must be a valid date (YYYY-MM-DD).")
    }
    // Any status id of the project's workflow (or a category); the store resolves it against the workflow.
    if (draft.status.isBlank()) errors += FieldError("status", "Status is required.")
    if (draft.priority !in Priority.all) errors += FieldError("priority", "Unknown priority.")
    if (draft.recurrence !in Recurrence.all) errors += FieldError("recurrence", "Unknown recurrence.")
    return DraftValidation(errors.toTypedArray())
}

private val HEX_COLOR = Regex("^#[0-9a-fA-F]{6}$")

internal fun isHexColor(value: String): Boolean = HEX_COLOR.matches(value)

/** Validates a project name/color; returns an error message or "". */
@JsExport
fun validateProject(
    name: String,
    color: String,
): String {
    val n = name.trim()
    return when {
        n.isEmpty() -> "Project name is required."
        n.length > Limits.PROJECT_NAME_MAX -> "Project name must be at most ${Limits.PROJECT_NAME_MAX} characters."
        !isHexColor(color) -> "Colour must be a hex value like #6366f1."
        else -> ""
    }
}

/** Validates a member name/colour; returns an error message or "". */
@JsExport
fun validateMember(
    name: String,
    color: String,
): String {
    val n = name.trim()
    return when {
        n.isEmpty() -> "Name is required."
        n.length > Limits.MEMBER_NAME_MAX -> "Name must be at most ${Limits.MEMBER_NAME_MAX} characters."
        !isHexColor(color) -> "Colour must be a hex value like #0ea5e9."
        else -> ""
    }
}

/** Palette offered by the project colour picker. */
@JsExport
val PROJECT_PALETTE: Array<String> =
    arrayOf("#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6", "#64748b", "#f97316")
