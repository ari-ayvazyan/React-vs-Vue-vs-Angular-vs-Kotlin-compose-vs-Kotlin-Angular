package taskpilot

private val boardOrder = compareBy<Task>({ it.order }, { it.createdAt }, { it.id })

/** Category key of a task: the column key on boards that show the three categories. */
val categoryKey: (Task) -> String = { it.status.key }

/** Tasks of the column [key] (as computed by [keyOf]), in display order. */
fun columnTasksBy(tasks: List<Task>, key: String, keyOf: (Task) -> String): List<Task> =
    tasks.filter { keyOf(it) == key }.sortedWith(boardOrder)

/** Tasks of one category column, in display order. */
fun columnTasks(tasks: List<Task>, status: Status): List<Task> = columnTasksBy(tasks, status.key, categoryKey)

/**
 * Moves task [id] into column [targetKey] at [toIndex] (index within the target column *excluding*
 * the moved task) and renumbers `order` in the affected columns. [apply] puts the task into the
 * target column (e.g. sets its status).
 */
fun moveTaskTo(
    tasks: List<Task>,
    id: String,
    targetKey: String,
    toIndex: Int,
    keyOf: (Task) -> String,
    apply: (Task) -> Task,
): List<Task> {
    val moving = tasks.firstOrNull { it.id == id } ?: return tasks
    val sourceKey = keyOf(moving)
    val target = columnTasksBy(tasks, targetKey, keyOf).filter { it.id != id }.toMutableList()
    target.add(toIndex.coerceIn(0, target.size), if (sourceKey == targetKey) moving else apply(moving))
    val updated = HashMap<String, Task>()
    target.forEachIndexed { i, t -> updated[t.id] = t.copy(order = i) }
    if (sourceKey != targetKey) {
        columnTasksBy(tasks, sourceKey, keyOf).filter { it.id != id }.forEachIndexed { i, t -> updated[t.id] = t.copy(order = i) }
    }
    val result = tasks.map { updated[it.id] ?: it }
    return if (result == tasks) tasks else result
}

/** Category-board move (columns are the three categories). Handles `completedAt`. */
fun moveTask(tasks: List<Task>, id: String, toStatus: Status, toIndex: Int, nowIso: String): List<Task> =
    moveTaskTo(tasks, id, toStatus.key, toIndex, categoryKey) { it.withStatus(toStatus, nowIso) }

/**
 * Keyboard move across ordered column [keys]: [dx] = -1/+1 changes column, [dy] = -1/+1 reorders.
 * [applyFor] returns how to put a task into a column.
 */
fun moveTaskByKeyboardIn(
    tasks: List<Task>,
    id: String,
    dx: Int,
    dy: Int,
    keys: List<String>,
    keyOf: (Task) -> String,
    applyFor: (String) -> (Task) -> Task,
): List<Task> {
    val task = tasks.firstOrNull { it.id == id } ?: return tasks
    val key = keyOf(task)
    val col = columnTasksBy(tasks, key, keyOf)
    val index = col.indexOfFirst { it.id == id }
    return if (dx != 0) {
        val nk = keys.getOrNull(keys.indexOf(key) + dx) ?: return tasks
        moveTaskTo(tasks, id, nk, minOf(index, columnTasksBy(tasks, nk, keyOf).size), keyOf, applyFor(nk))
    } else {
        val ni = index + dy
        if (ni < 0 || ni >= col.size) return tasks
        moveTaskTo(tasks, id, key, ni, keyOf, applyFor(key))
    }
}

/** Category-board keyboard move. */
fun moveTaskByKeyboard(tasks: List<Task>, id: String, dx: Int, dy: Int, nowIso: String): List<Task> =
    moveTaskByKeyboardIn(tasks, id, dx, dy, Status.entries.map { it.key }, categoryKey) { k ->
        val s = Status.fromKey(k)!!
        return@moveTaskByKeyboardIn { t: Task -> t.withStatus(s, nowIso) }
    }

/** Appends to the end of a column: the next free `order` value. */
fun nextOrder(tasks: List<Task>, status: Status): Int = (tasks.filter { it.status == status }.maxOfOrNull { it.order } ?: -1) + 1

/** Column key of [task] on a workflow board with [columns]: its own status if shown, else the first column of its category. */
fun workflowColumnKey(task: Task, columns: List<WorkflowStatus>): String =
    columns.firstOrNull { it.id == task.statusId }?.id ?: columns.firstOrNull { it.category == task.status }?.id ?: task.statusId

/**
 * Puts [task] into board column [column]. If the task's own workflow (e.g. a customised
 * sub-project) has that status it is used, otherwise the first of its statuses with the same category.
 */
fun applyWorkflowColumn(task: Task, column: WorkflowStatus, projects: List<Project>, nowIso: String): Task {
    val wf = effectiveWorkflow(projects, task.projectId)
    val target = wf.firstOrNull { it.id == column.id } ?: wf.firstOrNull { it.category == column.category } ?: column
    return task.withWorkflowStatus(target, nowIso)
}
