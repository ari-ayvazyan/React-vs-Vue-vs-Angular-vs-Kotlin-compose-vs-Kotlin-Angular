@file:OptIn(ExperimentalJsExport::class)

package taskpilot

/** One status of a project workflow. [category] is todo, in_progress or done. */
@JsExport
class WorkflowStatus(
    val id: String,
    val name: String,
    val color: String,
    val category: String,
)

@JsExport
object Workflows {
    /** Default workflow of every project (and of tasks without a project). Ids equal the categories. */
    val DEFAULT: Array<WorkflowStatus> =
        arrayOf(
            WorkflowStatus(Status.TODO, "To do", "#64748b", Status.TODO),
            WorkflowStatus(Status.IN_PROGRESS, "In progress", "#2563eb", Status.IN_PROGRESS),
            WorkflowStatus(Status.DONE, "Done", "#059669", Status.DONE),
        )

    const val NAME_MAX: Int = 30
}

// ---- project tree --------------------------------------------------------------------------------

/** Children per parent id (null = top level, including projects whose parent no longer exists). */
internal fun childrenOf(state: AppState): Map<String?, List<Project>> {
    val ids = state.projects.mapTo(HashSet()) { it.id }
    return state.projects.groupBy { p -> p.parentId?.takeIf { it in ids && it != p.id } }
}

/** All descendant project ids of [projectId] (not including itself). Cycle-safe. */
internal fun descendantsOf(
    state: AppState,
    projectId: String,
    children: Map<String?, List<Project>> = childrenOf(state),
): Set<String> {
    val out = LinkedHashSet<String>()
    val stack = ArrayDeque(listOf(projectId))
    while (stack.isNotEmpty()) {
        val id = stack.removeLast()
        for (c in children[id].orEmpty()) if (c.id != projectId && out.add(c.id)) stack.addLast(c.id)
    }
    return out
}

@JsExport
fun projectDescendants(
    state: AppState,
    projectId: String,
): Array<String> = descendantsOf(state, projectId).toTypedArray()

/** Ancestors of a project, nearest first. Cycle-safe. */
internal fun ancestorsOf(
    state: AppState,
    projectId: String,
): List<Project> {
    val out = mutableListOf<Project>()
    val seen = hashSetOf(projectId)
    var current = state.findProject(projectId)?.parentId
    while (current != null && seen.add(current)) {
        val p = state.findProject(current) ?: break
        out += p
        current = p.parentId
    }
    return out
}

/**
 * Matches tasks against a project filter: "" = all, [NO_PROJECT] = no project, otherwise the project and all of
 * its descendants.
 */
internal class ProjectMatcher(
    state: AppState,
    private val filter: String,
) {
    private val scope: Set<String>? =
        if (filter.isEmpty() || filter == NO_PROJECT) null else descendantsOf(state, filter) + filter

    fun matches(task: Task): Boolean =
        when (filter) {
            "" -> true
            NO_PROJECT -> task.projectId == null
            else -> task.projectId != null && task.projectId in scope!!
        }
}

/** "Parent › Child" path of a project. */
@JsExport
fun projectPath(
    state: AppState,
    projectId: String,
): String {
    val p = state.findProject(projectId) ?: return ""
    return (ancestorsOf(state, projectId).reversed() + p).joinToString(" › ") { it.name }
}

@JsExport
class ProjectNode(
    val project: Project,
    val depth: Int,
    val childCount: Int,
    val path: String,
    /** Name of the project whose workflow applies ("" = default workflow). */
    val workflowSource: String,
)

/** Projects in tree (depth-first) order, keeping the configured order among siblings. */
@JsExport
fun projectTree(state: AppState): Array<ProjectNode> {
    val children = childrenOf(state)
    val out = mutableListOf<ProjectNode>()
    val visited = HashSet<String>()

    fun visit(
        p: Project,
        depth: Int,
        prefix: String,
    ) {
        if (!visited.add(p.id)) return
        val path = if (prefix.isEmpty()) p.name else "$prefix › ${p.name}"
        val owner = workflowOwner(state, p.id)
        out += ProjectNode(p, depth, children[p.id].orEmpty().size, path, owner?.name.orEmpty())
        children[p.id].orEmpty().forEach { visit(it, depth + 1, path) }
    }
    children[null].orEmpty().forEach { visit(it, 0, "") }
    // Defensive: projects only reachable through a cycle are listed at the top level.
    state.projects.filter { it.id !in visited }.forEach { visit(it, 0, "") }
    return out.toTypedArray()
}

@JsExport
class ProjectOption(
    val id: String,
    val label: String,
    val depth: Int,
)

/** Options for project selects: indented by depth (non-breaking spaces, since <option> collapses spaces). */
@JsExport
fun projectOptions(state: AppState): Array<ProjectOption> =
    projectTree(state)
        .map { n -> ProjectOption(n.project.id, "   ".repeat(n.depth) + (if (n.depth > 0) "↳ " else "") + n.project.name, n.depth) }
        .toTypedArray()

/** Why [parentId] cannot be the parent of [projectId] ("" for top level is always fine); "" when valid. */
@JsExport
fun validateParent(
    state: AppState,
    projectId: String?,
    parentId: String,
): String {
    if (parentId.isEmpty()) return ""
    val parent = state.findProject(parentId) ?: return "Parent project not found."
    if (projectId == null) return ""
    return when {
        parentId == projectId -> "A project cannot be its own parent."
        parentId in descendantsOf(state, projectId) -> "“${parent.name}” is a sub-project of this project; that would create a cycle."
        else -> ""
    }
}

// ---- workflows -----------------------------------------------------------------------------------

/** The project that defines [projectId]'s workflow (itself or the nearest ancestor with an own workflow), or null for the default. */
internal fun workflowOwner(
    state: AppState,
    projectId: String?,
): Project? {
    val p = state.findProject(projectId) ?: return null
    if (p.workflow != null) return p
    return ancestorsOf(state, p.id).firstOrNull { it.workflow != null }
}

/** Effective workflow of a project (null / unknown project = default). */
@JsExport
fun workflowFor(
    state: AppState,
    projectId: String?,
): Array<WorkflowStatus> = workflowOwner(state, projectId)?.workflow ?: Workflows.DEFAULT

/** First status of [category] in [workflow] (workflows always contain every category, see validation). */
internal fun firstOfCategory(
    workflow: Array<WorkflowStatus>,
    category: String,
): WorkflowStatus = workflow.firstOrNull { it.category == category } ?: workflow.first()

/**
 * Resolves a status id or category name within [workflow]: an existing id wins, a category name maps to the first
 * status of that category, anything else to the first status of [fallbackCategory].
 */
internal fun resolveStatus(
    workflow: Array<WorkflowStatus>,
    wanted: String,
    fallbackCategory: String,
): WorkflowStatus =
    workflow.firstOrNull { it.id == wanted }
        ?: if (wanted in Status.all) firstOfCategory(workflow, wanted) else firstOfCategory(workflow, fallbackCategory)

/** Status id a task in [projectId] gets when asked for [statusOrCategory] (used by the task form on project change). */
@JsExport
fun remapStatus(
    state: AppState,
    projectId: String?,
    statusOrCategory: String,
    fallbackCategory: String,
): String = resolveStatus(workflowFor(state, projectId?.ifEmpty { null }), statusOrCategory, fallbackCategory).id

/** Fast status lookup for rendering (name / colour / category of a task's status). */
@JsExport
class StatusLookup(
    private val state: AppState,
) {
    private val cache = HashMap<String, Array<WorkflowStatus>>()

    private fun workflowOf(projectId: String?): Array<WorkflowStatus> = cache.getOrPut(projectId ?: "") { workflowFor(state, projectId) }

    fun statusOf(task: Task): WorkflowStatus = resolveStatus(workflowOf(task.projectId), task.status, task.category)

    fun workflowOfProject(projectId: String?): Array<WorkflowStatus> = workflowOf(projectId?.ifEmpty { null })
}

/**
 * Brings every task in line with its effective workflow: unknown status ids are mapped by category, the cached
 * `category` is recomputed, and `completedAt` is set when a task enters a done-category status (cleared when it
 * leaves). Returns [state] itself when nothing changed.
 */
internal fun normalizeTasks(
    state: AppState,
    nowIso: String,
): AppState {
    val lookup = StatusLookup(state)
    var changed = false
    val tasks =
        state.tasks
            .map { t ->
                val s = lookup.statusOf(t)
                val completedAt =
                    when {
                        s.category == Status.DONE -> t.completedAt ?: nowIso
                        else -> null
                    }
                if (s.id == t.status && s.category == t.category && completedAt == t.completedAt) {
                    t
                } else {
                    changed = true
                    t.copy(status = s.id, category = s.category, completedAt = completedAt)
                }
            }
    return if (changed) state.copy(tasks = tasks.toTypedArray()) else state
}

/** Validates a workflow: 1–20 statuses, unique ids and names, valid colours, every category present. "" when valid. */
@JsExport
fun validateWorkflow(workflow: Array<WorkflowStatus>): String {
    if (workflow.isEmpty() || workflow.size > 20) return "A workflow needs between 1 and 20 statuses."
    if (workflow.map { it.id }.toSet().size != workflow.size) return "Status ids must be unique."
    if (workflow.map { it.name.trim().lowercase() }.toSet().size != workflow.size) return "Status names must be unique."
    workflow.forEach { s ->
        if (s.id.isBlank()) return "Status ids must not be empty."
        if (s.name.isBlank() || s.name.length > Workflows.NAME_MAX) return "Status names must be 1–${Workflows.NAME_MAX} characters."
        if (!isHexColor(s.color)) return "“${s.name}” needs a hex colour like #2563eb."
        if (s.category !in Status.all) return "“${s.name}” has an unknown category."
    }
    val missing = Status.all.filter { c -> workflow.none { it.category == c } }
    if (missing.isNotEmpty()) {
        return "Every workflow needs at least one status in each category (missing: ${missing.joinToString { Status.label(it) }})."
    }
    return ""
}

/** A new status id derived from [name], unique within [workflow] (e.g. "review", "review-2"). */
internal fun newStatusId(
    workflow: Array<WorkflowStatus>,
    name: String,
): String {
    val base =
        name
            .lowercase()
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
            .ifEmpty { "status" }
            .take(24)
    val ids = workflow.mapTo(HashSet()) { it.id }
    if (base !in ids) return base
    var i = 2
    while ("$base-$i" in ids) i++
    return "$base-$i"
}

/**
 * Number of tasks per status of [projectId]'s workflow (same order as [workflowFor]), counting the project and
 * the sub-projects that share its workflow (i.e. inherit it).
 */
@JsExport
fun workflowUsage(
    state: AppState,
    projectId: String,
): Array<Int> {
    val workflow = workflowFor(state, projectId)
    val owner = workflowOwner(state, projectId)?.id
    val scope = (descendantsOf(state, projectId) + projectId).filter { workflowOwner(state, it)?.id == owner }.toSet()
    val counts =
        state.tasks
            .filter { it.projectId in scope }
            .groupingBy { it.status }
            .eachCount()
    return workflow.map { counts[it.id] ?: 0 }.toTypedArray()
}
