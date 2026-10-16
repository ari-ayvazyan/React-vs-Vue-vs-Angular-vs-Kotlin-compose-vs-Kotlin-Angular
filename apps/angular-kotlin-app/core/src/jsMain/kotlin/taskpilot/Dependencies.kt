@file:OptIn(ExperimentalJsExport::class)

package taskpilot

/** Tasks in [task]'s `blockedBy` that exist and are not done. */
@JsExport
fun openBlockers(
    state: AppState,
    task: Task,
): Array<Task> =
    task.blockedBy
        .mapNotNull { state.findTask(it) }
        .filter { !it.isDone }
        .toTypedArray()

/** Existing blocker tasks of [task] (open or done), in `blockedBy` order. */
@JsExport
fun blockerTasks(
    state: AppState,
    task: Task,
): Array<Task> = task.blockedBy.mapNotNull { state.findTask(it) }.toTypedArray()

/** Tasks that list [taskId] as a blocker. */
@JsExport
fun blockedTasks(
    state: AppState,
    taskId: String,
): Array<Task> = state.tasks.filter { taskId in it.blockedBy }.toTypedArray()

/** True if [task] has at least one open blocker. */
@JsExport
fun isBlocked(
    state: AppState,
    task: Task,
): Boolean = task.blockedBy.any { id -> state.findTask(id)?.let { !it.isDone } == true }

/** True when [target] is reachable from [start] by following `blockedBy` edges. */
internal fun dependsOn(
    state: AppState,
    start: String,
    target: String,
): Boolean {
    val seen = HashSet<String>()
    val stack = ArrayDeque(listOf(start))
    while (stack.isNotEmpty()) {
        val id = stack.removeLast()
        if (id == target) return true
        if (!seen.add(id)) continue
        state.findTask(id)?.blockedBy?.forEach { stack.addLast(it) }
    }
    return false
}

/** Why [blockerId] cannot be added as a blocker of [taskId], or "" when it can. */
@JsExport
fun validateBlocker(
    state: AppState,
    taskId: String,
    blockerId: String,
): String {
    val task = state.findTask(taskId) ?: return "Task not found."
    val blocker = state.findTask(blockerId) ?: return "The selected task no longer exists."
    return when {
        taskId == blockerId -> "A task cannot block itself."
        blockerId in task.blockedBy -> "“${blocker.title}” is already a blocker."
        dependsOn(state, blockerId, taskId) ->
            "Can't add “${blocker.title}”: it already depends on “${task.title}”, so this would create a cycle."
        else -> ""
    }
}

/** Candidates for the blocker picker: matching tasks that can be added without a cycle (max [limit]). */
@JsExport
fun blockerCandidates(
    state: AppState,
    taskId: String,
    search: String,
    limit: Int,
): Array<Task> {
    val terms = searchTerms(search)
    return state.tasks
        .asSequence()
        .filter { it.id != taskId && matchesSearch(it, terms) }
        .filter { validateBlocker(state, taskId, it.id).isEmpty() }
        .sortedWith(compareBy<Task> { it.isDone }.thenBy { it.title.lowercase() })
        .take(limit.coerceAtLeast(1))
        .toList()
        .toTypedArray()
}

/** "“A”, “B” and 2 more" – used in error messages. */
internal fun titleList(tasks: List<Task>): String {
    val names = tasks.map { "“${it.title}”" }
    return when {
        names.size <= 3 -> names.joinToString(", ")
        else -> names.take(3).joinToString(", ") + " and ${names.size - 3} more"
    }
}
