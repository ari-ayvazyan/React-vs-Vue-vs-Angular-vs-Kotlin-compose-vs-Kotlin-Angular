package taskpilot

/** 2024-06-12 (a Wednesday), 12:00 UTC. */
val TODAY: Int = Dates.epochDay(2024, 6, 12)
val NOW_MS: Long = TODAY * Dates.DAY_MS + 12 * 3_600_000L
val CLOCK = Clock(NOW_MS, 0)

fun day(offset: Int): String = Dates.format(TODAY + offset)

fun iso(offsetDays: Int): String = Dates.isoFromMillis(NOW_MS + offsetDays * Dates.DAY_MS)

fun task(
    id: String,
    title: String = "Task $id",
    status: Status = Status.TODO,
    priority: Priority = Priority.MEDIUM,
    due: String? = null,
    tags: List<String> = emptyList(),
    projectId: String? = null,
    createdAt: String = iso(-10),
    completedAt: String? = null,
    description: String = "",
    order: Int = 0,
    spent: Int = 0,
) = Task(
    id = id,
    title = title,
    description = description,
    status = status,
    priority = priority,
    projectId = projectId,
    tags = tags,
    dueDate = due,
    timeSpentMinutes = spent,
    createdAt = createdAt,
    completedAt = completedAt,
    order = order,
)
