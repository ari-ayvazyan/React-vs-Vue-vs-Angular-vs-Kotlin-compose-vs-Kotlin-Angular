package taskpilot

/** Due date of the next occurrence: [from] (or [today] if null) advanced by one interval. Months clamp to the last day. */
fun nextDueDate(from: String?, recurrence: Recurrence, today: Int): String? {
    val base = from?.let { Dates.parse(it) } ?: today
    val next =
        when (recurrence) {
            Recurrence.NONE -> return from
            Recurrence.DAILY -> base + 1
            Recurrence.WEEKLY -> base + 7
            Recurrence.MONTHLY -> {
                val (y, m, d) = Dates.civil(base)
                val (ny, nm) = shiftMonth(y, m, 1)
                Dates.epochDay(ny, nm, minOf(d, Dates.daysInMonth(ny, nm)))
            }
        }
    return Dates.format(next)
}

/** The fresh `todo` copy created when a recurring task is completed. */
fun nextOccurrence(task: Task, newId: String, nowIso: String, today: Int, order: Int): Task =
    task.copy(
        id = newId,
        status = Status.TODO,
        statusId = Status.TODO.key,
        completedAt = null,
        dueDate = nextDueDate(task.dueDate, task.recurrence, today),
        subtasks = task.subtasks.mapIndexed { i, s -> s.copy(id = "$newId-s${i + 1}", done = false) },
        timeSpentMinutes = 0,
        createdAt = nowIso,
        order = order,
    )

/**
 * Compares a task list before and after a mutation and appends the next occurrence for every
 * recurring task that just transitioned into `done`. Pure, so a single undo step reverts both.
 */
fun spawnRecurrences(
    before: List<Task>,
    after: List<Task>,
    nowIso: String,
    today: Int,
    idFor: (Task) -> String,
): List<Task> {
    val previous = before.associateBy { it.id }
    val completed =
        after.filter { t ->
            t.recurrence != Recurrence.NONE && t.status == Status.DONE && previous[t.id]?.let { it.status != Status.DONE } == true
        }
    if (completed.isEmpty()) return after
    var order = nextOrder(after, Status.TODO)
    return after + completed.map { nextOccurrence(it, idFor(it), nowIso, today, order++) }
}
