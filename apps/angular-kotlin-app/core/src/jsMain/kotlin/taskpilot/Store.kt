@file:OptIn(ExperimentalJsExport::class)

package taskpilot

import kotlin.random.Random

/**
 * Snapshot of undoable data: tasks, projects, members, saved views and the activity log (so undoing a change also
 * removes its log entries). Settings are intentionally not part of undo history.
 */
internal class Snapshot(
    val tasks: Array<Task>,
    val projects: Array<Project>,
    val members: Array<Member>,
    val activity: Array<ActivityEntry>,
    val views: Array<SavedView>,
    val label: String,
) {
    companion object {
        fun of(
            state: AppState,
            label: String,
        ): Snapshot = Snapshot(state.tasks, state.projects, state.members, state.activity, state.views, label)
    }

    fun restoreInto(state: AppState): AppState =
        state.copy(tasks = tasks, projects = projects, members = members, activity = activity, views = views)
}

/**
 * Bounded undo/redo history. [push] records the state *before* a mutation.
 */
internal class History(
    private val depth: Int,
) {
    private val past = ArrayDeque<Snapshot>()
    private val future = ArrayDeque<Snapshot>()

    val canUndo: Boolean get() = past.isNotEmpty()
    val canRedo: Boolean get() = future.isNotEmpty()
    val undoLabel: String get() = past.lastOrNull()?.label.orEmpty()
    val redoLabel: String get() = future.lastOrNull()?.label.orEmpty()
    val size: Int get() = past.size

    fun push(snapshot: Snapshot) {
        past.addLast(snapshot)
        while (past.size > depth) past.removeFirst()
        future.clear()
    }

    /** Returns the snapshot to restore, recording [current] for redo. */
    fun undo(current: (String) -> Snapshot): Snapshot? {
        val prev = past.removeLastOrNull() ?: return null
        future.addLast(current(prev.label))
        return prev
    }

    fun redo(current: (String) -> Snapshot): Snapshot? {
        val next = future.removeLastOrNull() ?: return null
        past.addLast(current(next.label))
        return next
    }

    fun clear() {
        past.clear()
        future.clear()
    }
}

/**
 * The application store. Holds immutable [AppState], applies all mutations, keeps undo/redo history
 * (depth 50) and persists through the injected key/value callbacks (localStorage in the browser,
 * no-ops during SSR). UI layers subscribe for change notifications.
 */
@JsExport
class TaskStore(
    private val load: (key: String) -> String?,
    private val save: (key: String, value: String) -> Unit,
    private val remove: (key: String) -> Unit,
) {
    var state: AppState = AppState.EMPTY
        private set

    /** Incremented on every change; handy for change detection. */
    var version: Int = 0
        private set

    /** False until [initialize] ran (always false during SSR). */
    var ready: Boolean = false
        private set

    private val history = History(HISTORY_DEPTH)
    private val listeners = mutableListOf<() -> Unit>()
    private var idCounter = 0

    /** Ids of next occurrences created by the most recent mutation (recurring tasks that were completed). */
    var lastSpawned: Array<String> = emptyArray()
        private set

    /** User-facing error of the most recent action (e.g. completing a blocked task), "" when none. */
    var lastError: String = ""
        private set

    /** True when the last [initialize] migrated schema-1 data from [LEGACY_STORAGE_KEY]. */
    var migratedFromLegacy: Boolean = false
        private set

    val canUndo: Boolean get() = history.canUndo
    val canRedo: Boolean get() = history.canRedo
    val undoLabel: String get() = history.undoLabel
    val redoLabel: String get() = history.redoLabel

    fun subscribe(listener: () -> Unit): () -> Unit {
        listeners += listener
        return { listeners.remove(listener) }
    }

    /**
     * Loads persisted data. `?seed=N` in [queryString] replaces all data with `generateDemoData(N)`;
     * empty or corrupt storage seeds 300 demo tasks. Returns N when the seed hook was applied, else -1.
     */
    fun initialize(queryString: String): Int {
        val seed = readSeedParam(queryString)

        fun read(key: String): String? =
            try {
                load(key)
            } catch (_: Throwable) {
                null
            }
        // Schema 2 data, or else schema-1 data from the old key, which is migrated (and the old key removed).
        val current = read(STORAGE_KEY)?.let { parseImport(it) }?.takeIf { it.ok }?.state
        val legacy = if (current == null) read(LEGACY_STORAGE_KEY)?.let { parseImport(it) }?.takeIf { it.ok }?.state else null
        migratedFromLegacy = legacy != null
        val parsed = current ?: legacy
        val settings = parsed?.settings ?: Settings.DEFAULT
        state =
            when {
                seed != null -> generateDemoData(seed).copy(settings = settings)
                parsed != null -> parsed
                else -> generateDemoData(DemoConstants.DEFAULT_COUNT).copy(settings = settings)
            }
        history.clear()
        ready = true
        val due = dueNotifications(state, state.settings.currentUserId, Clock.today(), DateFmt.nowIso()) { newId("n") }
        state = withNotifications(normalizeTasks(state, DateFmt.nowIso()), due)
        commit(persist = seed != null || parsed == null || legacy != null || due.isNotEmpty())
        if (legacy != null) {
            try {
                remove(LEGACY_STORAGE_KEY)
            } catch (_: Throwable) {
                // keep the old copy if it cannot be removed; the new key takes precedence anyway
            }
        }
        return seed ?: -1
    }

    // ---- tasks ---------------------------------------------------------------------------------

    /** Creates a task from a draft. Returns the new id, or "" when the draft is invalid. */
    fun createTask(draft: TaskDraft): String {
        if (!validateTaskDraft(draft).valid) return ""
        val id = newId("t")
        val now = DateFmt.nowIso()
        mutate("Create task") { s ->
            val task =
                Task(
                    id = id,
                    title = draft.title.trim(),
                    description = draft.description,
                    status = draft.status,
                    priority = draft.priority,
                    projectId = draft.projectId.ifEmpty { null }?.takeIf { s.findProject(it) != null },
                    tags = parseTags(draft.tagsText),
                    dueDate = draft.dueDate.ifEmpty { null },
                    estimateMinutes = parseEstimate(draft.estimateText),
                    timeSpentMinutes = 0,
                    subtasks = emptyArray(),
                    createdAt = now,
                    completedAt = if (draft.status == Status.DONE) now else null,
                    order = nextOrder(s.tasks, draft.status),
                    assigneeId = draft.assigneeId.ifEmpty { null }?.takeIf { s.findMember(it) != null },
                    recurrence = draft.recurrence,
                )
            s.copy(tasks = s.tasks + task)
        }
        return id
    }

    /** Updates a task from a draft. Returns false when invalid or not found. */
    fun updateTask(
        id: String,
        draft: TaskDraft,
    ): Boolean {
        if (!validateTaskDraft(draft).valid || state.findTask(id) == null) return false
        mutate("Edit task") { s ->
            s.mapTask(id) { t ->
                t.copy(
                    status = draft.status,
                    title = draft.title.trim(),
                    description = draft.description,
                    priority = draft.priority,
                    projectId = draft.projectId.ifEmpty { null }?.takeIf { s.findProject(it) != null },
                    tags = parseTags(draft.tagsText),
                    dueDate = draft.dueDate.ifEmpty { null },
                    estimateMinutes = parseEstimate(draft.estimateText),
                    order = if (t.status != draft.status) nextOrder(s.tasks, draft.status) else t.order,
                    assigneeId = draft.assigneeId.ifEmpty { null }?.takeIf { s.findMember(it) != null },
                    recurrence = draft.recurrence,
                )
            }
        }
        return true
    }

    fun deleteTask(id: String): Int = deleteTasks(arrayOf(id))

    /** Deletes tasks; returns how many were removed. */
    fun deleteTasks(ids: Array<String>): Int {
        val set = ids.toSet()
        val count = state.tasks.count { it.id in set }
        if (count == 0) return 0
        mutate(if (count == 1) "Delete task" else "Delete $count tasks") { s ->
            s.copy(tasks = s.tasks.filter { it.id !in set }.toTypedArray())
        }
        return count
    }

    /** Toggles between the first done-category status and the first to-do-category status of the task's workflow. */
    fun toggleDone(id: String) {
        val t = state.findTask(id) ?: return
        setStatus(id, if (t.isDone) Status.TODO else Status.DONE)
    }

    /**
     * Sets a task's status. [status] is a status id of the task's workflow or a category name (which maps to the
     * first status of that category).
     */
    fun setStatus(
        id: String,
        status: String,
    ) {
        val t = state.findTask(id) ?: return
        val target = resolveStatus(workflowFor(state, t.projectId), status, t.category)
        if (target.id == t.status) return
        mutate(if (target.category == Status.DONE && !t.isDone) "Complete task" else "Change status") { s ->
            val order = nextOrder(s.tasks, target.id)
            s.mapTask(id) { it.copy(status = target.id, category = target.category, order = order) }
        }
    }

    /** Moves tasks to the first done-category status of their workflow; returns how many changed. */
    fun markDone(ids: Array<String>): Int {
        val set = ids.toSet()
        val targets = state.tasks.filter { it.id in set && !it.isDone }
        if (targets.isEmpty()) return 0
        mutate("Complete ${targets.size} tasks") { s ->
            val lookup = StatusLookup(s)
            val orders = HashMap<String, Int>()
            s.copy(
                tasks =
                    s.tasks
                        .map { t ->
                            if (t.id in set && !t.isDone) {
                                val done = firstOfCategory(lookup.workflowOfProject(t.projectId), Status.DONE)
                                val order = orders.getOrPut(done.id) { nextOrder(s.tasks, done.id) }
                                orders[done.id] = order + 1
                                t.copy(status = done.id, category = Status.DONE, order = order)
                            } else {
                                t
                            }
                        }.toTypedArray(),
            )
        }
        return targets.size
    }

    /** Moves tasks to a project ("" or [NO_PROJECT] = no project); returns how many changed. */
    fun moveToProject(
        ids: Array<String>,
        projectId: String,
    ): Int {
        val target = projectId.takeIf { it.isNotEmpty() && it != NO_PROJECT }
        if (target != null && state.findProject(target) == null) return 0
        val set = ids.toSet()
        val count = state.tasks.count { it.id in set && it.projectId != target }
        if (count == 0) return 0
        mutate("Move $count tasks") { s ->
            s.copy(tasks = s.tasks.map { if (it.id in set) it.copy(projectId = target) else it }.toTypedArray())
        }
        return count
    }

    /**
     * Board drag & drop on the "All projects" board: move [id] into category column [status] (or, for a status id of
     * the task's own workflow, into the board of its project), before [beforeId] (null/"" = end of column).
     */
    fun moveTask(
        id: String,
        status: String,
        beforeId: String?,
    ) {
        val task = state.findTask(id) ?: return
        val board = if (status in Status.all) "" else task.projectId.orEmpty()
        moveTaskToColumn(id, status, beforeId, board)
    }

    /**
     * Board drag & drop: move [id] into column [columnId] of the board filtered by [boardProject] ("" = all
     * projects, columns are categories; a project id = that project's workflow statuses).
     */
    fun moveTaskToColumn(
        id: String,
        columnId: String,
        beforeId: String?,
        boardProject: String,
    ) {
        if (state.findTask(id) == null) return
        val board = boardProject.takeIf { state.findProject(it) != null }.orEmpty()
        if (boardColumnDefs(state, board).none { it.id == columnId }) return
        val before = beforeId?.ifEmpty { null }
        mutate("Move card") { s -> s.copy(tasks = moveTaskToColumnIn(s, id, columnId, before, board)) }
    }

    /**
     * Keyboard board moves: [columnDelta] moves between columns (keeping the visual row where possible),
     * [rowDelta] reorders within the visible (filtered by [query]) column. Returns true when something moved.
     */
    fun moveTaskBy(
        id: String,
        columnDelta: Int,
        rowDelta: Int,
        query: TaskQuery,
        today: String,
    ): Boolean {
        if (state.findTask(id) == null) return false
        val board = query.projectId.takeIf { state.findProject(it) != null }.orEmpty()
        val columns = boardColumns(state, query, today)
        val colIdx = columns.indexOfFirst { c -> c.tasks.any { it.id == id } }
        if (colIdx < 0) return false
        val visible = columns[colIdx].tasks
        val idx = visible.indexOfFirst { it.id == id }
        if (columnDelta != 0) {
            val targetIdx = colIdx + columnDelta
            if (targetIdx !in columns.indices) return false
            val target = columns[targetIdx]
            moveTaskToColumn(id, target.id, target.tasks.getOrNull(idx.coerceAtLeast(0))?.id, board)
            return true
        }
        if (rowDelta == 0) return false
        val newIdx = idx + rowDelta
        if (newIdx !in visible.indices) return false
        val beforeId = if (rowDelta < 0) visible[newIdx].id else visible.getOrNull(newIdx + 1)?.id
        moveTaskToColumn(id, columns[colIdx].id, beforeId, board)
        return true
    }

    /** Sets (or clears, with "") the due date, e.g. by dragging a timeline bar. Returns false when invalid. */
    fun setDueDate(
        id: String,
        dueDate: String,
    ): Boolean {
        val task = state.findTask(id) ?: return false
        val due = dueDate.ifEmpty { null }
        if (due != null && parseDay(due) == null) return false
        if (task.dueDate == due) return true
        mutate("Change due date") { s -> s.mapTask(id) { it.copy(dueDate = due) } }
        return true
    }

    // ---- saved views ---------------------------------------------------------------------------

    /** Saves the list query (filters, search, sort; not the page) under [name]. Returns the id or "" when invalid. */
    fun saveView(
        name: String,
        query: TaskQuery,
    ): String {
        if (validateViewName(state.views, name, null).isNotEmpty()) return ""
        val view = SavedView(newId("v"), name.trim(), query.withPage(1).toQueryString(), DateFmt.nowIso())
        mutate("Save view") { s -> s.copy(views = s.views + view) }
        return view.id
    }

    fun renameView(
        id: String,
        name: String,
    ): Boolean {
        if (state.views.none { it.id == id } || validateViewName(state.views, name, id).isNotEmpty()) return false
        mutate("Rename view") { s -> s.copy(views = s.views.map { if (it.id == id) it.renamed(name.trim()) else it }.toTypedArray()) }
        return true
    }

    fun deleteView(id: String) {
        if (state.views.none { it.id == id }) return
        mutate("Delete view") { s -> s.copy(views = s.views.filter { it.id != id }.toTypedArray()) }
    }

    fun addTimeSpent(
        id: String,
        minutes: Int,
    ) {
        if (minutes <= 0 || state.findTask(id) == null) return
        mutate("Track time") { s -> s.mapTask(id) { it.copy(timeSpentMinutes = it.timeSpentMinutes + minutes) } }
    }

    // ---- subtasks ------------------------------------------------------------------------------

    fun addSubtask(
        taskId: String,
        title: String,
    ): Boolean {
        val trimmed = title.trim()
        if (trimmed.isEmpty() || trimmed.length > Limits.SUBTASK_TITLE_MAX || state.findTask(taskId) == null) return false
        val sub = Subtask(newId("s"), trimmed, false)
        mutate("Add subtask") { s -> s.mapTask(taskId) { it.copy(subtasks = it.subtasks + sub) } }
        return true
    }

    fun toggleSubtask(
        taskId: String,
        subtaskId: String,
    ) {
        mutate("Toggle subtask") { s ->
            s.mapTask(taskId) { t ->
                t.copy(subtasks = t.subtasks.map { if (it.id == subtaskId) Subtask(it.id, it.title, !it.done) else it }.toTypedArray())
            }
        }
    }

    fun renameSubtask(
        taskId: String,
        subtaskId: String,
        title: String,
    ): Boolean {
        val trimmed = title.trim()
        if (trimmed.isEmpty() || trimmed.length > Limits.SUBTASK_TITLE_MAX) return false
        mutate("Rename subtask") { s ->
            s.mapTask(taskId) { t ->
                t.copy(subtasks = t.subtasks.map { if (it.id == subtaskId) Subtask(it.id, trimmed, it.done) else it }.toTypedArray())
            }
        }
        return true
    }

    fun removeSubtask(
        taskId: String,
        subtaskId: String,
    ) {
        mutate("Delete subtask") { s ->
            s.mapTask(taskId) { t -> t.copy(subtasks = t.subtasks.filter { it.id != subtaskId }.toTypedArray()) }
        }
    }

    /** Assigns tasks to a member ("" or [UNASSIGNED] = nobody); returns how many changed. */
    fun assignTasks(
        ids: Array<String>,
        memberId: String,
    ): Int {
        val target = memberId.takeIf { it.isNotEmpty() && it != UNASSIGNED }
        if (target != null && state.findMember(target) == null) return 0
        val set = ids.toSet()
        val count = state.tasks.count { it.id in set && it.assigneeId != target }
        if (count == 0) return 0
        mutate(if (count == 1) "Assign task" else "Assign $count tasks") { s ->
            s.copy(tasks = s.tasks.map { if (it.id in set) it.copy(assigneeId = target) else it }.toTypedArray())
        }
        return count
    }

    // ---- dependencies & comments ------------------------------------------------------------------

    /** Adds [blockerId] to [taskId]'s blockers. Returns an error message (e.g. a cycle) or "" on success. */
    fun addBlocker(
        taskId: String,
        blockerId: String,
    ): String {
        val error = validateBlocker(state, taskId, blockerId)
        if (error.isNotEmpty()) return error
        mutate("Add blocker") { s -> s.mapTask(taskId) { it.copy(blockedBy = it.blockedBy + blockerId) } }
        return ""
    }

    fun removeBlocker(
        taskId: String,
        blockerId: String,
    ) {
        val task = state.findTask(taskId) ?: return
        if (blockerId !in task.blockedBy) return
        mutate(
            "Remove blocker",
        ) { s -> s.mapTask(taskId) { t -> t.copy(blockedBy = t.blockedBy.filter { it != blockerId }.toTypedArray()) } }
    }

    /** Adds a comment by the current user. Returns an error message or "" on success. */
    fun addComment(
        taskId: String,
        body: String,
    ): String {
        val error = validateComment(body)
        if (error.isNotEmpty()) return error
        if (state.findTask(taskId) == null) return "Task not found."
        val author = state.settings.currentUserId
        if (state.findMember(author) == null) return "Choose the current user in Settings before commenting."
        val comment = Comment(newId("c"), author, body.trim(), DateFmt.nowIso())
        mutate("Add comment") { s -> s.mapTask(taskId) { it.copy(comments = it.comments + comment) } }
        return ""
    }

    /** Sets the member acting as the current user (not undoable, like other settings). */
    fun setCurrentUser(memberId: String) {
        if (memberId == state.settings.currentUserId || (memberId.isNotEmpty() && state.findMember(memberId) == null)) return
        state = state.copy(settings = state.settings.copy(currentUserId = memberId))
        state = withNotifications(state, dueNotifications(state, memberId, Clock.today(), DateFmt.nowIso()) { newId("n") })
        commit()
    }

    // ---- notifications (not undoable) ----------------------------------------------------------

    /**
     * Adds today's due / overdue reminders for the current user (at most one per task per day). Called on start-up
     * and when the date changes. Returns how many were added.
     */
    fun refreshDueNotifications(): Int {
        val added = dueNotifications(state, state.settings.currentUserId, Clock.today(), DateFmt.nowIso()) { newId("n") }
        if (added.isEmpty()) return 0
        state = withNotifications(state, added)
        commit()
        return added.size
    }

    fun markNotificationRead(id: String) {
        if (state.notifications.none { it.id == id && !it.read }) return
        state = state.copy(notifications = state.notifications.map { if (it.id == id) it.markedRead() else it }.toTypedArray())
        commit()
    }

    /** Marks all notifications of the current user as read. */
    fun markAllNotificationsRead() {
        val user = state.settings.currentUserId
        if (state.notifications.none { it.userId == user && !it.read }) return
        state = state.copy(notifications = state.notifications.map { if (it.userId == user) it.markedRead() else it }.toTypedArray())
        commit()
    }

    // ---- members -------------------------------------------------------------------------------

    /** Returns the new member id, or "" when invalid. */
    fun createMember(
        name: String,
        color: String,
    ): String {
        if (validateMember(name, color).isNotEmpty()) return ""
        val id = newId("m")
        mutate("Add member") { s -> s.copy(members = s.members + Member(id, name.trim(), color)) }
        return id
    }

    fun updateMember(
        id: String,
        name: String,
        color: String,
    ): Boolean {
        if (validateMember(name, color).isNotEmpty() || state.findMember(id) == null) return false
        mutate("Edit member") { s ->
            s.copy(members = s.members.map { if (it.id == id) it.copy(name = name.trim(), color = color) else it }.toTypedArray())
        }
        return true
    }

    /** Deletes a member and unassigns their tasks; returns how many tasks were unassigned. */
    fun deleteMember(id: String): Int {
        if (state.findMember(id) == null) return 0
        val count = state.tasks.count { it.assigneeId == id }
        mutate("Delete member") { s ->
            s.copy(
                members = s.members.filter { it.id != id }.toTypedArray(),
                tasks = s.tasks.map { if (it.assigneeId == id) it.copy(assigneeId = null) else it }.toTypedArray(),
            )
        }
        return count
    }

    // ---- projects ------------------------------------------------------------------------------

    /** Creates a project, optionally as a sub-project of [parentId] (""). Returns the new id, or "" when invalid. */
    fun createProject(
        name: String,
        color: String,
        parentId: String = "",
    ): String {
        if (validateProject(name, color).isNotEmpty() || validateParent(state, null, parentId).isNotEmpty()) return ""
        val id = newId("p")
        val project = Project(id, name.trim(), color, DateFmt.nowIso(), parentId.ifEmpty { null })
        mutate("Create project") { s -> s.copy(projects = s.projects + project) }
        return id
    }

    /**
     * Moves a project under [parentId] ("" = top level). Rejects cycles. A project that inherits its workflow keeps
     * the statuses it had: if the new parent's workflow differs, the current one is copied into the project.
     * Returns an error message or "".
     */
    fun setProjectParent(
        id: String,
        parentId: String,
    ): String {
        val p = state.findProject(id) ?: return "Project not found."
        val error = validateParent(state, id, parentId)
        if (error.isNotEmpty() || (p.parentId ?: "") == parentId) return error
        val current = workflowFor(state, id)
        mutate("Move project") { s ->
            val moved =
                s.copy(
                    projects =
                        s.projects
                            .map {
                                if (it.id ==
                                    id
                                ) {
                                    it.copy(parentId = parentId.ifEmpty { null })
                                } else {
                                    it
                                }
                            }.toTypedArray(),
                )
            if (p.workflow == null && !sameWorkflow(workflowFor(moved, id), current)) {
                moved.copy(projects = moved.projects.map { if (it.id == id) it.copy(workflow = current) else it }.toTypedArray())
            } else {
                moved
            }
        }
        return ""
    }

    fun updateProject(
        id: String,
        name: String,
        color: String,
    ): Boolean {
        if (validateProject(name, color).isNotEmpty() || state.findProject(id) == null) return false
        mutate("Edit project") { s ->
            s.copy(projects = s.projects.map { if (it.id == id) it.copy(name = name.trim(), color = color) else it }.toTypedArray())
        }
        return true
    }

    /**
     * Deletes a project. Its tasks are deleted or moved to "no project" ([deleteTasks]). Sub-projects are either
     * deleted too, with their tasks treated the same way ([deleteSubprojects]), or moved up one level; moved
     * sub-projects that inherited a custom workflow from the deleted project keep it as their own.
     */
    fun deleteProject(
        id: String,
        deleteTasks: Boolean,
        deleteSubprojects: Boolean = false,
    ) {
        val project = state.findProject(id) ?: return
        mutate("Delete project") { s ->
            val removed = if (deleteSubprojects) descendantsOf(s, id) + id else setOf(id)
            val tasks =
                if (deleteTasks) {
                    s.tasks.filter { it.projectId !in removed }
                } else {
                    s.tasks.map { if (it.projectId in removed) it.copy(projectId = null) else it }
                }
            val inherited = workflowFor(s, id)
            val projects =
                s.projects
                    .filter { it.id !in removed }
                    .map { p ->
                        if (p.parentId != id) {
                            p
                        } else {
                            val keep = if (p.workflow == null && project.workflow != null) inherited else p.workflow
                            p.copy(parentId = project.parentId, workflow = keep)
                        }
                    }
            s.copy(tasks = tasks.toTypedArray(), projects = projects.toTypedArray())
        }
    }

    // ---- workflows -----------------------------------------------------------------------------

    /** Gives [projectId] its own copy of the workflow it currently inherits (no-op when it already has one). */
    fun customizeWorkflow(projectId: String) {
        val p = state.findProject(projectId) ?: return
        if (p.workflow != null) return
        val copy = workflowFor(state, projectId)
        mutate("Customize workflow") { s -> s.withWorkflow(projectId, copy) }
    }

    /** Drops [projectId]'s own workflow so it inherits again; tasks with removed statuses move by category. */
    fun resetWorkflow(projectId: String) {
        val p = state.findProject(projectId) ?: return
        if (p.workflow == null) return
        mutate("Reset workflow") { s -> s.withWorkflow(projectId, null) }
    }

    /** Adds a status (materialising an inherited workflow first). Returns an error message or "". */
    fun addStatus(
        projectId: String,
        name: String,
        color: String,
        category: String,
    ): String {
        if (state.findProject(projectId) == null) return "Project not found."
        val current = workflowFor(state, projectId)
        val status = WorkflowStatus(newStatusId(current, name), name.trim(), color, category)
        return applyWorkflow(projectId, current + status, "Add status")
    }

    /** Renames / recolours / recategorises a status. Returns an error message or "". */
    fun updateStatus(
        projectId: String,
        statusId: String,
        name: String,
        color: String,
        category: String,
    ): String {
        if (state.findProject(projectId) == null) return "Project not found."
        val current = workflowFor(state, projectId)
        if (current.none { it.id == statusId }) return "Status not found."
        val next = current.map { if (it.id == statusId) WorkflowStatus(it.id, name.trim(), color, category) else it }.toTypedArray()
        return applyWorkflow(projectId, next, "Edit status")
    }

    /** Moves a status up (-1) or down (+1) in the column order. */
    fun moveStatus(
        projectId: String,
        statusId: String,
        delta: Int,
    ) {
        if (state.findProject(projectId) == null) return
        val list = workflowFor(state, projectId).toMutableList()
        val i = list.indexOfFirst { it.id == statusId }
        val j = i + delta
        if (i < 0 || j !in list.indices) return
        list.add(j, list.removeAt(i))
        applyWorkflow(projectId, list.toTypedArray(), "Reorder statuses")
    }

    /**
     * Deletes a status; tasks using it (in this project and in sub-projects inheriting this workflow) move to
     * [targetStatusId]. Returns an error message or "".
     */
    fun deleteStatus(
        projectId: String,
        statusId: String,
        targetStatusId: String,
    ): String {
        if (state.findProject(projectId) == null) return "Project not found."
        val current = workflowFor(state, projectId)
        if (current.none { it.id == statusId }) return "Status not found."
        val target = current.firstOrNull { it.id == targetStatusId && it.id != statusId } ?: return "Choose another status for its tasks."
        val next = current.filter { it.id != statusId }.toTypedArray()
        val error = validateWorkflow(next)
        if (error.isNotEmpty()) return error
        mutate("Delete status") { s ->
            val withWf = s.withWorkflow(projectId, next)
            // Tasks of every project that now uses this workflow (the project and inheriting sub-projects).
            val affected = (descendantsOf(withWf, projectId) + projectId).filter { workflowOwner(withWf, it)?.id == projectId }.toSet()
            withWf.copy(
                tasks =
                    withWf.tasks
                        .map { t ->
                            if (t.projectId in affected &&
                                t.status == statusId
                            ) {
                                t.copy(status = target.id, category = target.category)
                            } else {
                                t
                            }
                        }.toTypedArray(),
            )
        }
        return ""
    }

    private fun applyWorkflow(
        projectId: String,
        workflow: Array<WorkflowStatus>,
        label: String,
    ): String {
        val error = validateWorkflow(workflow)
        if (error.isNotEmpty()) return error
        mutate(label) { s -> s.withWorkflow(projectId, workflow) }
        return ""
    }

    // ---- settings (not undoable) ---------------------------------------------------------------

    fun setTheme(theme: String) {
        if (theme !in Theme.all || theme == state.settings.theme) return
        state = state.copy(settings = state.settings.copy(theme = theme))
        commit()
    }

    fun setPomodoroMinutes(minutes: Int) {
        val m = minutes.coerceIn(Limits.POMODORO_MIN, Limits.POMODORO_MAX)
        if (m == state.settings.pomodoroMinutes) return
        state = state.copy(settings = state.settings.copy(pomodoroMinutes = m))
        commit()
    }

    fun setPageSize(size: Int) {
        val s = size.coerceIn(1, 500)
        if (s == state.settings.pageSize) return
        state = state.copy(settings = state.settings.copy(pageSize = s))
        commit()
    }

    // ---- history -------------------------------------------------------------------------------

    fun undo(): String {
        val snap = history.undo { label -> Snapshot.of(state, label) } ?: return ""
        state = snap.restoreInto(state)
        commit()
        return snap.label
    }

    fun redo(): String {
        val snap = history.redo { label -> Snapshot.of(state, label) } ?: return ""
        state = snap.restoreInto(state)
        commit()
        return snap.label
    }

    // ---- data management -----------------------------------------------------------------------

    /** Replaces all data with `generateDemoData(count)` (keeps settings, clears history). */
    fun loadDemoData(count: Int) {
        state = generateDemoData(count.coerceIn(0, 100_000)).copy(settings = state.settings)
        state =
            withNotifications(state, dueNotifications(state, state.settings.currentUserId, Clock.today(), DateFmt.nowIso()) { newId("n") })
        history.clear()
        commit()
    }

    fun resetDemoData() = loadDemoData(DemoConstants.DEFAULT_COUNT)

    /** Validates and imports JSON. On success the import is undoable. */
    fun importJson(text: String): ImportResult {
        val result = parseImport(text)
        val imported = result.state ?: return result
        mutate("Import data", spawnRecurring = false, log = false) { imported }
        return result
    }

    fun exportJson(): String = serializeState(state, true)

    // ---- internals -----------------------------------------------------------------------------

    /**
     * Applies an undoable mutation. Recurring tasks that transition to done inside the mutation get their next
     * occurrence appended in the same step, so a single undo reverts both.
     */
    private fun mutate(
        label: String,
        spawnRecurring: Boolean = true,
        log: Boolean = true,
        block: (AppState) -> AppState,
    ) {
        val before = state
        var changed = block(before)
        if (changed === before) return
        // 0. Statuses follow each task's effective workflow (category, completedAt) – see normalizeTasks.
        changed = normalizeTasks(changed, DateFmt.nowIso())
        // 1. Dependency gate: tasks with open blockers cannot become done.
        val gate = enforceBlockers(before, changed)
        if (gate.error.isNotEmpty() && gate.state == null) {
            commit(persist = false, error = gate.error)
            return
        }
        changed = gate.state ?: changed
        // 2. Keep dependencies consistent when tasks are deleted.
        changed = dropDanglingBlockers(before, changed)
        // 3. Recurring tasks completed in this step get their next occurrence in the same history entry.
        val spawned = if (spawnRecurring) nextOccurrencesFor(before, changed) else emptyList()
        if (spawned.isNotEmpty()) changed = normalizeTasks(changed.copy(tasks = changed.tasks + spawned), DateFmt.nowIso())
        // 4. Notifications (not part of the snapshot: once delivered they stay, like in any inbox).
        changed = withNotifications(changed, changeNotifications(before, changed, DateFmt.nowIso()) { newId("n") })
        changed =
            withNotifications(
                changed,
                dueNotifications(changed, changed.settings.currentUserId, Clock.today(), DateFmt.nowIso()) { newId("n") },
            )
        // 5. Activity log (part of the snapshot, so undo removes these entries again).
        if (log) {
            val entries = diffActivity(before, changed, state.settings.currentUserId, DateFmt.nowIso()) { newId("a") }
            if (entries.isNotEmpty()) {
                val all = changed.activity + entries
                changed =
                    changed.copy(activity = if (all.size > ACTIVITY_LIMIT) all.copyOfRange(all.size - ACTIVITY_LIMIT, all.size) else all)
            }
        }
        history.push(Snapshot.of(before, label))
        state = changed
        commit(spawned = spawned.map { it.id }.toTypedArray(), error = gate.error)
    }

    private class Gate(
        val state: AppState?,
        val error: String,
    )

    /**
     * Tasks that would become done while they still have open blockers are kept in their previous state.
     * If that rejects every completion in the mutation, the whole mutation is rejected ([Gate.state] = null),
     * which keeps single-task actions such as board drops fully unchanged.
     */
    private fun enforceBlockers(
        before: AppState,
        after: AppState,
    ): Gate {
        val old = before.tasks.associateBy { it.id }
        val completing = after.tasks.filter { t -> t.isDone && old[t.id]?.let { !it.isDone } == true }
        if (completing.isEmpty()) return Gate(after, "")
        val blocked = completing.filter { isBlocked(after, it) }
        if (blocked.isEmpty()) return Gate(after, "")
        val message =
            blocked.joinToString(" ") { t ->
                "“${t.title}” is blocked by ${titleList(openBlockers(after, t).toList())}."
            } + " Complete the blockers first."
        if (blocked.size == completing.size) return Gate(null, message)
        val ids = blocked.mapTo(HashSet()) { it.id }
        return Gate(after.copy(tasks = after.tasks.map { if (it.id in ids) old.getValue(it.id) else it }.toTypedArray()), message)
    }

    private fun dropDanglingBlockers(
        before: AppState,
        after: AppState,
    ): AppState {
        val ids = after.tasks.mapTo(HashSet()) { it.id }
        if (before.tasks.all { it.id in ids }) return after
        if (after.tasks.none { t -> t.blockedBy.any { it !in ids } }) return after
        return after.copy(
            tasks =
                after.tasks
                    .map { t ->
                        if (t.blockedBy.all { it in ids }) t else t.copy(blockedBy = t.blockedBy.filter { it in ids }.toTypedArray())
                    }.toTypedArray(),
        )
    }

    private fun nextOccurrencesFor(
        before: AppState,
        after: AppState,
    ): List<Task> {
        val previous = before.tasks.associateBy { it.id }
        val completed =
            after.tasks.filter { t ->
                val old = previous[t.id]
                t.isRecurring && t.isDone && old != null && !old.isDone
            }
        if (completed.isEmpty()) return emptyList()
        val today = Clock.today()
        val now = DateFmt.nowIso()
        var order = nextOrder(after.tasks, Status.TODO)
        return completed.mapNotNull { t ->
            val id = newId("t")
            nextOccurrence(t, id, { i -> "$id-s${i + 1}" }, today, now, order++)
        }
    }

    private fun commit(
        persist: Boolean = true,
        spawned: Array<String> = emptyArray(),
        error: String = "",
    ) {
        version++
        lastSpawned = spawned
        lastError = error
        if (persist && ready) {
            try {
                save(STORAGE_KEY, serializeState(state, false))
            } catch (_: Throwable) {
                // Storage full or unavailable: keep working in memory.
            }
        }
        listeners.toList().forEach { it() }
    }

    private fun newId(prefix: String): String {
        idCounter++
        val rand = Random.nextInt(0, 1 shl 30).toString(36)
        return "$prefix-${Clock.nowMs().toLong().toString(36)}-$idCounter$rand"
    }

    companion object {
        const val HISTORY_DEPTH: Int = 50
    }
}

internal fun nextOrder(
    tasks: Array<Task>,
    status: String,
): Int = (tasks.filter { it.status == status }.maxOfOrNull { it.order } ?: -1) + 1

internal fun AppState.mapTask(
    id: String,
    transform: (Task) -> Task,
): AppState = copy(tasks = tasks.map { if (it.id == id) transform(it) else it }.toTypedArray())

internal fun AppState.withWorkflow(
    projectId: String,
    workflow: Array<WorkflowStatus>?,
): AppState = copy(projects = projects.map { if (it.id == projectId) it.copy(workflow = workflow) else it }.toTypedArray())

internal fun sameWorkflow(
    a: Array<WorkflowStatus>,
    b: Array<WorkflowStatus>,
): Boolean =
    a.size == b.size &&
        a.indices.all { a[it].id == b[it].id && a[it].name == b[it].name && a[it].color == b[it].color && a[it].category == b[it].category }
