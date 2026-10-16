package taskpilot

val DEFAULT_WORKFLOW: List<WorkflowStatus> =
    listOf(
        WorkflowStatus("todo", "To do", "#64748b", Status.TODO),
        WorkflowStatus("in_progress", "In progress", "#d97706", Status.IN_PROGRESS),
        WorkflowStatus("done", "Done", "#059669", Status.DONE),
    )

const val WORKFLOW_NAME_MAX = 30

// ---- project tree -------------------------------------------------------------------------------

/** [id] plus all of its descendants. */
fun descendantIds(projects: List<Project>, id: String): Set<String> {
    val children = projects.groupBy { it.parentId }
    val out = linkedSetOf(id)
    val queue = ArrayDeque(listOf(id))
    while (queue.isNotEmpty()) {
        children[queue.removeFirst()].orEmpty().forEach { c -> if (out.add(c.id)) queue.addLast(c.id) }
    }
    return out
}

/** Ancestors of [id] from the parent up to the root (stops on cycles or missing parents). */
fun ancestors(projects: List<Project>, id: String): List<Project> {
    val byId = projects.associateBy { it.id }
    val out = mutableListOf<Project>()
    val seen = hashSetOf(id)
    var cur = byId[id]?.parentId
    while (cur != null && seen.add(cur)) {
        val p = byId[cur] ?: break
        out += p
        cur = p.parentId
    }
    return out
}

/** Whether [parentId] may become the parent of [id] (null is always fine; no self/descendant). */
fun canSetParent(projects: List<Project>, id: String, parentId: String?): Boolean =
    parentId == null || (projects.any { it.id == parentId } && parentId !in descendantIds(projects, id))

/** "Parent › Child" display path. */
fun projectPath(projects: List<Project>, id: String): String {
    val p = projects.firstOrNull { it.id == id } ?: return ""
    return (ancestors(projects, id).reversed() + p).joinToString(" › ") { it.name }
}

/** A project with its depth, in depth-first tree order (children keep their list order). */
data class ProjectNode(val project: Project, val depth: Int)

fun projectTree(projects: List<Project>): List<ProjectNode> {
    val ids = projects.map { it.id }.toSet()
    val children = projects.groupBy { p -> p.parentId?.takeIf { it in ids } }
    val out = mutableListOf<ProjectNode>()
    val seen = hashSetOf<String>()

    fun visit(p: Project, depth: Int) {
        if (!seen.add(p.id)) return
        out += ProjectNode(p, depth)
        children[p.id].orEmpty().forEach { visit(it, depth + 1) }
    }
    children[null].orEmpty().forEach { visit(it, 0) }
    projects.filter { it.id !in seen }.forEach { visit(it, 0) } // defensive: orphans in a cycle
    return out
}

// ---- workflows ----------------------------------------------------------------------------------

/** The workflow that applies to [projectId]: its own, else the nearest ancestor's, else the default. */
fun effectiveWorkflow(projects: List<Project>, projectId: String?): List<WorkflowStatus> {
    if (projectId == null) return DEFAULT_WORKFLOW
    val byId = projects.associateBy { it.id }
    val seen = hashSetOf<String>()
    var cur: String? = projectId
    while (cur != null && seen.add(cur)) {
        val p = byId[cur] ?: return DEFAULT_WORKFLOW
        p.workflow?.let { return it }
        cur = p.parentId
    }
    return DEFAULT_WORKFLOW
}

/** The project whose workflow [projectId] uses (itself or an ancestor), or null for the default workflow. */
fun workflowOwner(projects: List<Project>, projectId: String?): Project? {
    if (projectId == null) return null
    val byId = projects.associateBy { it.id }
    val seen = hashSetOf<String>()
    var cur: String? = projectId
    while (cur != null && seen.add(cur)) {
        val p = byId[cur] ?: return null
        if (p.workflow != null) return p
        cur = p.parentId
    }
    return null
}

fun Task.workflowStatus(projects: List<Project>): WorkflowStatus {
    val wf = effectiveWorkflow(projects, projectId)
    return wf.firstOrNull { it.id == statusId } ?: wf.firstOrNull { it.category == status }
        ?: DEFAULT_WORKFLOW.first { it.category == status }
}

/**
 * Restores the invariant "statusId exists in the task's workflow and its category equals
 * task.status". When they disagree the category wins (it is what category-based actions such as
 * "mark done" change); the id becomes the first workflow status of that category.
 */
fun normalizeTasks(tasks: List<Task>, projects: List<Project>): List<Task> {
    val cache = HashMap<String?, List<WorkflowStatus>>()
    var changed = false
    val out =
        tasks.map { t ->
            val wf = cache.getOrPut(t.projectId) { effectiveWorkflow(projects, t.projectId) }
            val current = wf.firstOrNull { it.id == t.statusId }
            if (current != null && current.category == t.status) {
                t
            } else {
                val target = wf.firstOrNull { it.category == t.status } ?: DEFAULT_WORKFLOW.first { it.category == t.status }
                changed = true
                t.copy(statusId = target.id)
            }
        }
    return if (changed) out else tasks
}

/** Validation error for a workflow, or null. Every category needs at least one status. */
fun validateWorkflow(statuses: List<WorkflowStatus>): String? {
    if (statuses.map { it.id }.toSet().size != statuses.size) return "Status ids must be unique."
    statuses.forEach { s ->
        if (s.name.isBlank()) return "Status names must not be empty."
        if (s.name.length > WORKFLOW_NAME_MAX) return "Status names can be at most $WORKFLOW_NAME_MAX characters."
    }
    if (statuses.map { it.name.trim().lowercase() }.toSet().size != statuses.size) return "Status names must be unique."
    val missing = Status.entries.filter { c -> statuses.none { it.category == c } }
    if (missing.isNotEmpty()) return "Each category needs at least one status (missing: ${missing.joinToString { it.label }})."
    return null
}

/** Slug-like id for a new status that is unique within [existing]. */
fun newStatusId(name: String, existing: List<WorkflowStatus>): String {
    val base =
        name
            .trim()
            .lowercase()
            .replace(Regex("[^a-z0-9]+"), "_")
            .trim('_')
            .ifEmpty { "status" }
            .take(24)
    var id = base
    var n = 2
    while (existing.any { it.id == id }) id = "${base}_${n++}"
    return id
}

/** Projects (the owner and every descendant inheriting from it) that use [owner]'s workflow. */
fun projectsUsingWorkflowOf(projects: List<Project>, ownerId: String?): Set<String?> =
    if (ownerId == null) {
        (projects.filter { workflowOwner(projects, it.id) == null }.map { it.id } + listOf<String?>(null)).toSet()
    } else {
        descendantIds(projects, ownerId).filter { workflowOwner(projects, it)?.id == ownerId }.toSet()
    }

/**
 * Removes status [statusId] from the workflow owned by [ownerId] (null = default is not editable here)
 * and moves its tasks to [targetId]. Returns null when not allowed (last of its category without a
 * same-category target is fine as long as the remaining workflow is valid).
 */
fun deleteWorkflowStatus(
    projects: List<Project>,
    tasks: List<Task>,
    ownerId: String,
    statusId: String,
    targetId: String,
    nowIso: String,
): Pair<List<Project>, List<Task>>? {
    val owner = projects.firstOrNull { it.id == ownerId } ?: return null
    val wf = owner.workflow ?: return null
    val target = wf.firstOrNull { it.id == targetId && it.id != statusId } ?: return null
    val remaining = wf.filterNot { it.id == statusId }
    if (validateWorkflow(remaining) != null) return null
    val affected = projectsUsingWorkflowOf(projects, ownerId)
    val newProjects = projects.map { if (it.id == ownerId) it.copy(workflow = remaining) else it }
    val newTasks =
        tasks.map { t -> if (t.projectId in affected && t.statusId == statusId) t.withWorkflowStatus(target, nowIso) else t }
    return newProjects to newTasks
}

// ---- deletion -----------------------------------------------------------------------------------

enum class SubProjectAction { MOVE_UP, DELETE }

/**
 * Deletes project [id]. Sub-projects move up one level (to the deleted project's parent) or are
 * deleted with it. Tasks of every deleted project are deleted or moved to "no project". Tasks that
 * leave a project are re-normalised to their new workflow by category.
 */
fun deleteProjectTree(
    projects: List<Project>,
    tasks: List<Task>,
    id: String,
    subProjects: SubProjectAction,
    deleteTasks: Boolean,
): Pair<List<Project>, List<Task>> {
    val project = projects.firstOrNull { it.id == id } ?: return projects to tasks
    val removed = if (subProjects == SubProjectAction.DELETE) descendantIds(projects, id) else setOf(id)
    // A child that moves up keeps the workflow it used so far.
    val inherited = effectiveWorkflow(projects, id)
    val newProjects =
        projects
            .filterNot { it.id in removed }
            .map { p ->
                if (p.parentId == id) {
                    p.copy(parentId = project.parentId, workflow = p.workflow ?: if (project.workflow != null) inherited else null)
                } else {
                    p
                }
            }
    val newTasks =
        if (deleteTasks) {
            tasks.filterNot { it.projectId in removed }
        } else {
            tasks.map { if (it.projectId in removed) it.copy(projectId = null) else it }
        }
    return newProjects to normalizeTasks(newTasks, newProjects)
}

/** Counts including all descendants. */
fun projectProgressWithDescendants(tasks: List<Task>, projects: List<Project>, roots: List<Project> = projects): List<ProjectProgress> {
    val byProject = tasks.groupBy { it.projectId }
    return roots.map { p ->
        val ids = descendantIds(projects, p.id)
        val list = ids.flatMap { byProject[it].orEmpty() }
        ProjectProgress(p, list.size, list.count { it.status == Status.DONE })
    }
}
