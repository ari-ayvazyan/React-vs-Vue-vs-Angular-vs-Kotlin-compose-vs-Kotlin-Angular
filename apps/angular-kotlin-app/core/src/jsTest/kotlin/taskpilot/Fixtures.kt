package taskpilot

internal const val TODAY = "2026-10-16" // a Friday

internal fun day(iso: String): Int = parseDay(iso)!!

internal fun task(
    id: String,
    title: String = "Task $id",
    status: String = Status.TODO,
    priority: String = Priority.MEDIUM,
    projectId: String? = null,
    tags: Array<String> = emptyArray(),
    dueDate: String? = null,
    createdAt: String = "2026-10-01T10:00:00.000Z",
    completedAt: String? = null,
    order: Int = 0,
    description: String = "",
    timeSpent: Int = 0,
    assigneeId: String? = null,
    recurrence: String = Recurrence.NONE,
    subtasks: Array<Subtask> = emptyArray(),
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
        null,
        timeSpent,
        subtasks,
        createdAt,
        completedAt,
        order,
        assigneeId,
        recurrence,
    )

/** In-memory key/value storage; [initial] is stored under [STORAGE_KEY] (or [key]). */
internal fun memoryStore(
    initial: String? = null,
    key: String = STORAGE_KEY,
): Pair<TaskStore, () -> String?> {
    val storage = HashMap<String, String>()
    if (initial != null) storage[key] = initial
    val store = TaskStore({ storage[it] }, { k, v -> storage[k] = v }, { storage.remove(it) })
    return store to { storage[STORAGE_KEY] }
}

/** Minimal state around a task list (no projects / members). */
internal fun stateOf(
    tasks: Array<Task>,
    projects: Array<Project> = emptyArray(),
): AppState = AppState(tasks, projects, Settings.DEFAULT, emptyArray())

internal fun draft(
    title: String,
    status: String = Status.TODO,
    tags: String = "",
    estimate: String = "",
    description: String = "",
    due: String = "",
    project: String = "",
    assignee: String = "",
    recurrence: String = Recurrence.NONE,
): TaskDraft = TaskDraft(title, description, status, Priority.HIGH, project, tags, due, estimate, assignee, recurrence)
