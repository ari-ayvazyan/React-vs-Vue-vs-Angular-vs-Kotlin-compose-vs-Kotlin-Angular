package taskpilot

/** Raw form input, as typed by the user. */
data class TaskDraft(
    val title: String = "",
    val description: String = "",
    val status: Status = Status.TODO,
    val statusId: String = status.key,
    val priority: Priority = Priority.MEDIUM,
    val projectId: String? = null,
    val tagsText: String = "",
    val dueDate: String = "",
    val estimateText: String = "",
    val assigneeId: String? = null,
    val recurrence: Recurrence = Recurrence.NONE,
) {
    companion object {
        fun from(task: Task) =
            TaskDraft(
                title = task.title,
                description = task.description,
                status = task.status,
                statusId = task.statusId,
                priority = task.priority,
                projectId = task.projectId,
                tagsText = task.tags.joinToString(", "),
                dueDate = task.dueDate.orEmpty(),
                estimateText = task.estimateMinutes?.toString().orEmpty(),
                assigneeId = task.assigneeId,
                recurrence = task.recurrence,
            )
    }
}

object Limits {
    const val TITLE_MAX = 120
    const val DESCRIPTION_MAX = 2000
    const val TAGS_MAX = 8
    const val MEMBER_NAME_MAX = 40
}

/** Splits on commas/whitespace, lowercases, trims and de-duplicates (keeping first occurrence order). */
fun parseTags(text: String): List<String> =
    text
        .split(',', ' ', '\n', '\t')
        .map { it.trim().trimStart('#').lowercase() }
        .filter { it.isNotEmpty() }
        .distinct()

data class ValidatedDraft(
    val title: String,
    val description: String,
    val tags: List<String>,
    val dueDate: String?,
    val estimateMinutes: Int?,
)

sealed interface DraftResult {
    data class Ok(val value: ValidatedDraft) : DraftResult

    data class Invalid(val errors: Map<String, String>) : DraftResult
}

fun validateDraft(draft: TaskDraft): DraftResult {
    val errors = LinkedHashMap<String, String>()
    val title = draft.title.trim()
    when {
        title.isEmpty() -> errors["title"] = "Title is required."
        title.length > Limits.TITLE_MAX ->
            errors["title"] =
                "Title must be at most ${Limits.TITLE_MAX} characters (currently ${title.length})."
    }
    if (draft.description.length > Limits.DESCRIPTION_MAX) {
        errors["description"] = "Description must be at most ${Limits.DESCRIPTION_MAX} characters (currently ${draft.description.length})."
    }
    val tags = parseTags(draft.tagsText)
    if (tags.size > Limits.TAGS_MAX) errors["tags"] = "At most ${Limits.TAGS_MAX} tags allowed (you have ${tags.size})."
    val due = draft.dueDate.trim()
    if (due.isNotEmpty() && Dates.parse(due) == null) errors["dueDate"] = "Enter a valid date (YYYY-MM-DD)."
    val est = draft.estimateText.trim()
    var estimate: Int? = null
    if (est.isNotEmpty()) {
        val n = if (Regex("^\\d+$").matches(est)) est.toIntOrNull() else null
        if (n == null || n <= 0) errors["estimate"] = "Estimate must be a positive whole number of minutes." else estimate = n
    }
    if (errors.isNotEmpty()) return DraftResult.Invalid(errors)
    return DraftResult.Ok(
        ValidatedDraft(
            title = title,
            description = draft.description,
            tags = tags,
            dueDate = due.ifEmpty { null },
            estimateMinutes = estimate,
        ),
    )
}
