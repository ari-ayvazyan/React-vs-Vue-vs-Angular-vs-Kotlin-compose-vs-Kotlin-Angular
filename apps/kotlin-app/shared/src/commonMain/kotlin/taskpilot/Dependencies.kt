package taskpilot

/** Blockers of [task] that exist in [tasks] and are not done yet. */
fun openBlockers(task: Task, tasks: List<Task>): List<Task> {
    if (task.blockedBy.isEmpty()) return emptyList()
    val byId = tasks.associateBy { it.id }
    return openBlockers(task, byId)
}

private fun openBlockers(task: Task, byId: Map<String, Task>): List<Task> =
    task.blockedBy.mapNotNull { byId[it] }.filter { it.status != Status.DONE }

fun Task.isBlocked(tasks: List<Task>): Boolean = status != Status.DONE && openBlockers(this, tasks).isNotEmpty()

/** Ids of all tasks that are currently blocked (open and with at least one open blocker). */
fun blockedTaskIds(tasks: List<Task>): Set<String> {
    val byId = tasks.associateBy { it.id }
    return tasks.filter { it.status != Status.DONE && openBlockers(it, byId).isNotEmpty() }.map { it.id }.toSet()
}

/** Tasks that list [taskId] as a blocker. */
fun blockedTasksOf(taskId: String, tasks: List<Task>): List<Task> = tasks.filter { taskId in it.blockedBy }

/**
 * Path that would close a cycle if [blockerId] were added to [taskId]'s blockers: a chain
 * `blockerId → … → taskId` following existing blockedBy edges. Null when adding is safe.
 */
fun dependencyCycle(tasks: List<Task>, taskId: String, blockerId: String): List<String>? {
    if (taskId == blockerId) return listOf(taskId)
    val byId = tasks.associateBy { it.id }
    val parent = HashMap<String, String>()
    val queue = ArrayDeque(listOf(blockerId))
    val seen = hashSetOf(blockerId)
    while (queue.isNotEmpty()) {
        val current = queue.removeFirst()
        if (current == taskId) {
            val path = mutableListOf(current)
            var c = current
            while (c != blockerId) {
                c = parent.getValue(c)
                path.add(c)
            }
            return path.reversed()
        }
        byId[current]?.blockedBy?.forEach { next ->
            if (seen.add(next)) {
                parent[next] = current
                queue.addLast(next)
            }
        }
    }
    return null
}

/** Human readable reason why [blockerId] cannot block [taskId], or null if it can. */
fun dependencyError(tasks: List<Task>, taskId: String, blockerId: String): String? {
    val byId = tasks.associateBy { it.id }
    val task = byId[taskId] ?: return "Task not found."
    if (byId[blockerId] == null) return "Blocking task not found."
    if (blockerId in task.blockedBy) return "\"${byId.getValue(blockerId).title}\" already blocks this task."
    val cycle = dependencyCycle(tasks, taskId, blockerId) ?: return null
    if (cycle.size == 1) return "A task cannot block itself."
    val chain = (cycle + blockerId).joinToString(" → ") { "\"${byId[it]?.title ?: it}\"" }
    return "That would create a cycle: $chain. A task cannot (indirectly) block itself."
}

data class BlockedCompletion(val task: Task, val blockers: List<Task>)

/**
 * Rejects every transition into `done` (between [before] and [after]) of a task that still has open
 * blockers in the resulting state. Rejected tasks keep their previous status, completion time and
 * order; all other changes are kept. Blockers completed in the same change count as done.
 */
fun enforceBlockers(before: List<Task>, after: List<Task>): Pair<List<Task>, List<BlockedCompletion>> {
    val previous = before.associateBy { it.id }
    var current = after
    val rejected = LinkedHashMap<String, BlockedCompletion>()
    while (true) {
        val byId = current.associateBy { it.id }
        val violations =
            current.filter { t ->
                val old = previous[t.id]
                t.id !in rejected && t.status == Status.DONE && old != null && old.status != Status.DONE &&
                    openBlockers(t, byId).isNotEmpty()
            }
        if (violations.isEmpty()) break
        violations.forEach { rejected[it.id] = BlockedCompletion(it, openBlockers(it, byId)) }
        val ids = violations.map { it.id }.toSet()
        current =
            current.map { t ->
                if (t.id in ids) {
                    val old = previous.getValue(t.id)
                    t.copy(status = old.status, statusId = old.statusId, completedAt = old.completedAt, order = old.order)
                } else {
                    t
                }
            }
    }
    return current to rejected.values.toList()
}

fun blockedMessage(rejected: List<BlockedCompletion>): String =
    if (rejected.size == 1) {
        val r = rejected.single()
        "Can't complete \"${r.task.title}\": blocked by " + r.blockers.joinToString(", ") { "\"${it.title}\"" } + "."
    } else {
        "${rejected.size} tasks can't be completed because they have open blockers: " +
            rejected.joinToString("; ") { r -> "\"${r.task.title}\" (by " + r.blockers.joinToString(", ") { "\"${it.title}\"" } + ")" }
    }
