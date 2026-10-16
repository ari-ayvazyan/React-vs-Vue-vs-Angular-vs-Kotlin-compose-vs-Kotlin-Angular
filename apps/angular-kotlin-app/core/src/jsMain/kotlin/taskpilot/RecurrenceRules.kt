@file:OptIn(ExperimentalJsExport::class)

package taskpilot

/** Adds [months] calendar months to an epoch day, clamping the day of month (Jan 31 + 1 month = Feb 28/29). */
internal fun addMonths(
    epochDay: Int,
    months: Int,
): Int {
    val (y, m, d) = CivilDate.civilFromDays(epochDay)
    val index = y * 12 + (m - 1) + months
    val ny = IntMath.floorDiv(index, 12)
    val nm = index - ny * 12 + 1
    return CivilDate.daysFromCivil(ny, nm, minOf(d, CivilDate.daysInMonth(ny, nm)))
}

/**
 * Due date of the next occurrence: the old due date (or [today] when there is none) advanced by one interval.
 * Returns null for non-recurring tasks.
 */
internal fun nextOccurrenceDay(
    dueDate: String?,
    recurrence: String,
    today: Int,
): Int? {
    val base = parseDay(dueDate) ?: today
    return when (recurrence) {
        Recurrence.DAILY -> base + 1
        Recurrence.WEEKLY -> base + 7
        Recurrence.MONTHLY -> addMonths(base, 1)
        else -> null
    }
}

/** Exported variant for previews in the UI ("next: Fri, Oct 23"). Returns "" for non-recurring tasks. */
@JsExport
fun nextOccurrenceDate(
    dueDate: String?,
    recurrence: String,
    today: String,
): String = nextOccurrenceDay(dueDate, recurrence, parseDay(today) ?: Clock.today())?.let { formatDay(it) } ?: ""

/**
 * Builds the next occurrence of a just-completed recurring task: status todo, advanced due date, subtasks reset,
 * no time tracked. Everything else (title, description, priority, project, tags, assignee, estimate, recurrence)
 * is carried over.
 */
internal fun nextOccurrence(
    completed: Task,
    newId: String,
    subtaskId: (Int) -> String,
    today: Int,
    nowIso: String,
    order: Int,
): Task? {
    val due = nextOccurrenceDay(completed.dueDate, completed.recurrence, today) ?: return null
    return Task(
        id = newId,
        title = completed.title,
        description = completed.description,
        status = Status.TODO,
        priority = completed.priority,
        projectId = completed.projectId,
        tags = completed.tags.copyOf(),
        dueDate = formatDay(due),
        estimateMinutes = completed.estimateMinutes,
        timeSpentMinutes = 0,
        subtasks = completed.subtasks.mapIndexed { i, s -> Subtask(subtaskId(i), s.title, false) }.toTypedArray(),
        createdAt = nowIso,
        completedAt = null,
        order = order,
        assigneeId = completed.assigneeId,
        recurrence = completed.recurrence,
    )
}
