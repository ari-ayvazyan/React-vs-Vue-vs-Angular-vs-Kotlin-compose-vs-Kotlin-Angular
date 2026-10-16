@file:OptIn(ExperimentalJsExport::class)

package taskpilot

/**
 * A board column: a workflow status (board filtered to one project) or a status category ("All projects").
 * [id] is the status id or the category; for the default workflow both are todo / in_progress / done.
 */
@JsExport
class BoardColumn(
    val id: String,
    val name: String,
    val color: String,
    val category: String,
    val byCategory: Boolean,
    val tasks: Array<Task>,
)

private val CATEGORY_COLORS = mapOf(Status.TODO to "#64748b", Status.IN_PROGRESS to "#2563eb", Status.DONE to "#059669")

/** Column definitions (without tasks) for a board filtered by [projectFilter]. */
internal fun boardColumnDefs(
    state: AppState,
    projectFilter: String,
): List<BoardColumn> =
    if (state.findProject(projectFilter) != null) {
        workflowFor(state, projectFilter).map { BoardColumn(it.id, it.name, it.color, it.category, false, emptyArray()) }
    } else {
        Status.all.map { BoardColumn(it, Status.label(it), CATEGORY_COLORS.getValue(it), it, true, emptyArray()) }
    }

/**
 * Index of the column a task belongs to: its status id when the board shows a workflow (falling back to the first
 * column of the task's category for sub-projects with a different workflow), otherwise its category.
 */
private fun columnIndex(
    defs: List<BoardColumn>,
    task: Task,
): Int {
    if (defs.first().byCategory) return defs.indexOfFirst { it.id == task.category }
    val exact = defs.indexOfFirst { it.id == task.status }
    return if (exact >= 0) exact else defs.indexOfFirst { it.category == task.category }.coerceAtLeast(0)
}

/**
 * Board columns for a task-list query (status, sort and page are ignored: columns are statuses, cards keep their
 * manual order). With a project filter the columns are that project's workflow, otherwise the three categories.
 */
@JsExport
fun boardColumns(
    state: AppState,
    query: TaskQuery,
    today: String,
): Array<BoardColumn> {
    val defs = boardColumnDefs(state, query.projectId)
    val buckets = defs.map { mutableListOf<Task>() }
    for (t in filterTasks(state, query.forBoard(), parseDay(today) ?: Clock.today())) {
        val i = columnIndex(defs, t)
        if (i >= 0) buckets[i] += t
    }
    return defs
        .mapIndexed { i, d ->
            BoardColumn(d.id, d.name, d.color, d.category, d.byCategory, buckets[i].sortedWith(ORDER).toTypedArray())
        }.toTypedArray()
}

private val ORDER = compareBy<Task> { it.order }.thenBy { it.createdAt }

/**
 * Tasks of one column of the "All projects" board (a category) or of a project board (a status id), optionally
 * filtered by project (including sub-projects) and assignee.
 */
@JsExport
fun boardColumn(
    state: AppState,
    column: String,
    projectFilter: String,
    assigneeFilter: String,
): Array<Task> =
    boardColumns(state, TaskQuery.DEFAULT.withProject(projectFilter).withAssignee(assigneeFilter), formatDay(Clock.today()))
        .firstOrNull { it.id == column }
        ?.tasks ?: emptyArray()

internal fun matchesAssignee(
    task: Task,
    assigneeFilter: String,
): Boolean =
    when (assigneeFilter) {
        "" -> true
        UNASSIGNED -> task.assigneeId == null
        else -> task.assigneeId == assigneeFilter
    }

/**
 * Moves [taskId] into column [columnId] of the board filtered by [boardProject] ("" = all projects / categories),
 * before [beforeId] (null = end). The task gets the column's status if its own workflow has it, otherwise the
 * first status of the column's category in its workflow (keeping its status when it already is in that category
 * on a category board). Orders of the target column are renumbered densely.
 */
internal fun moveTaskToColumnIn(
    state: AppState,
    taskId: String,
    columnId: String,
    beforeId: String?,
    boardProject: String,
): Array<Task> {
    val moving = state.findTask(taskId) ?: return state.tasks
    if (beforeId == taskId) return state.tasks
    val defs = boardColumnDefs(state, boardProject)
    val col = defs.firstOrNull { it.id == columnId } ?: return state.tasks
    val ownWorkflow = workflowFor(state, moving.projectId)
    val newStatus =
        when {
            col.byCategory && moving.category == col.category -> moving.status
            !col.byCategory && ownWorkflow.any { it.id == col.id } -> col.id
            else -> firstOfCategory(ownWorkflow, col.category).id
        }
    val newCategory = ownWorkflow.firstOrNull { it.id == newStatus }?.category ?: col.category
    val matcher = ProjectMatcher(state, if (col.byCategory) "" else boardProject)
    val target =
        state.tasks
            .filter { it.id != taskId && matcher.matches(it) && columnIndex(defs, it) == defs.indexOf(col) }
            .sortedWith(ORDER)
            .toMutableList()
    val insertAt = beforeId?.let { id -> target.indexOfFirst { it.id == id } }?.takeIf { it >= 0 } ?: target.size
    target.add(insertAt, moving.copy(status = newStatus, category = newCategory))
    val updated = HashMap<String, Task>()
    target.forEachIndexed { i, t -> updated[t.id] = if (t.order == i && t.id != taskId) t else t.copy(order = i) }
    // Close the gap in the column the card left.
    val sourceIdx = columnIndex(defs, moving)
    if (sourceIdx != defs.indexOf(col)) {
        state.tasks
            .filter { it.id != taskId && matcher.matches(it) && columnIndex(defs, it) == sourceIdx }
            .sortedWith(ORDER)
            .forEachIndexed { i, t -> if (t.order != i) updated[t.id] = t.copy(order = i) }
    }
    return state.tasks.map { updated[it.id] ?: it }.toTypedArray()
}
