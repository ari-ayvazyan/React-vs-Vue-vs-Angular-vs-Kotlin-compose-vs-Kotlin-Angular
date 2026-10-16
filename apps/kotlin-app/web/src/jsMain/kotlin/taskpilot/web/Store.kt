package taskpilot.web

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.browser.document
import kotlinx.browser.window
import taskpilot.ActivityEntry
import taskpilot.AppJson
import taskpilot.AppState
import taskpilot.BlockedCompletion
import taskpilot.Comment
import taskpilot.Demo
import taskpilot.History
import taskpilot.ImportResult
import taskpilot.Member
import taskpilot.Notification
import taskpilot.Project
import taskpilot.Recurrence
import taskpilot.STORAGE_KEY_V1
import taskpilot.STORAGE_KEY_V2
import taskpilot.SavedView
import taskpilot.Settings
import taskpilot.Status
import taskpilot.SubProjectAction
import taskpilot.Task
import taskpilot.TaskQuery
import taskpilot.ThemeMode
import taskpilot.ValidatedDraft
import taskpilot.WorkflowStatus
import taskpilot.appendActivity
import taskpilot.appendNotifications
import taskpilot.blockedMessage
import taskpilot.canSetParent
import taskpilot.decodeStoredState
import taskpilot.deleteProjectTree
import taskpilot.dependencyError
import taskpilot.diffActivity
import taskpilot.dueNotifications
import taskpilot.effectiveWorkflow
import taskpilot.enforceBlockers
import taskpilot.generateDemoData
import taskpilot.importState
import taskpilot.markAllRead
import taskpilot.markRead
import taskpilot.newId
import taskpilot.nextOrder
import taskpilot.normalizeTasks
import taskpilot.notificationsForChange
import taskpilot.openBlockers
import taskpilot.removeMember
import taskpilot.spawnRecurrences
import taskpilot.validateComment
import taskpilot.validateWorkflow
import taskpilot.viewParams
import taskpilot.withStatus
import taskpilot.withWorkflowStatus
import taskpilot.deleteWorkflowStatus as removeWorkflowStatus

/**
 * The undoable part of the state. The activity log lives here too, so undoing a change also
 * removes the entries it produced and redo brings them back.
 */
data class Data(
    val tasks: List<Task>,
    val projects: List<Project>,
    val members: List<Member> = emptyList(),
    val activity: List<ActivityEntry> = emptyList(),
    val views: List<SavedView> = emptyList(),
)

data class Toast(
    val id: Int,
    val message: String,
    val actionLabel: String? = null,
    val action: (() -> Unit)? = null,
    val tone: String = "info",
)

/** Non-text fields chosen in the task form (the text fields arrive validated in [ValidatedDraft]). */
data class TaskFields(
    /** Category of the chosen status (fallback when [statusId] does not exist in the target workflow). */
    val status: Status,
    val statusId: String,
    val priority: taskpilot.Priority,
    val projectId: String?,
    val assigneeId: String?,
    val recurrence: Recurrence,
)

/** What the task modal is currently editing; [taskId] null means "create". */
data class TaskModalRequest(val taskId: String? = null, val defaults: Task? = null)

/** Current storage key (schema v2); data under the v1 key is migrated on first load. */
const val STORAGE_KEY = STORAGE_KEY_V2

object Store {
    var history by mutableStateOf(History(Data(emptyList(), emptyList())))
        private set
    var settings by mutableStateOf(Settings())
        private set

    val tasks: List<Task> get() = history.present.tasks
    val projects: List<Project> get() = history.present.projects
    val members: List<Member> get() = history.present.members
    val activity: List<ActivityEntry> get() = history.present.activity
    val views: List<SavedView> get() = history.present.views

    /** The member who authors comments and is recorded as actor in the activity log. */
    val currentUser: Member? get() = member(settings.currentUserId)

    /** Bumped every minute so "today" stays current. */
    var clockTick by mutableStateOf(0)
        private set

    val toasts = mutableStateListOf<Toast>()
    private var toastSeq = 0

    var taskModal by mutableStateOf<TaskModalRequest?>(null)
    var shortcutsOpen by mutableStateOf(false)
    var drawerOpen by mutableStateOf(false)
    var sidebarCollapsed by mutableStateOf(false)

    /** Polite screen-reader announcements (board moves etc). */
    var announcement by mutableStateOf("")

    private var saveHandle: Int? = null

    fun load() {
        val current = Platform.readStorage(STORAGE_KEY)?.let { decodeStoredState(it) }
        // One-time migration from the v1 key; the old entry is left in place as a backup.
        val migrated = if (current == null) Platform.readStorage(STORAGE_KEY_V1)?.let { decodeStoredState(it) } else null
        val loaded = current ?: migrated
        val state = loaded ?: demo(Demo.DEFAULT_COUNT, Settings())
        history = History(Data(state.tasks, state.projects, state.members, state.activity, state.views))
        settings = state.settings
        notifications = state.notifications
        sidebarCollapsed = Platform.readStorage("taskpilot:sidebar") == "collapsed"
        checkDueNotifications()
        if (loaded == null || migrated != null) persistNow()
        window.setInterval({
            clockTick++
            checkDueNotifications()
        }, 60_000)
        window.addEventListener("pagehide", { flush() })
    }

    private fun demo(count: Int, settings: Settings): AppState {
        val clock = Platform.clock()
        return generateDemoData(count, clock.nowMs, clock.today, settings)
    }

    fun clock() = Platform.clock().also { clockTick }

    // ---- persistence -------------------------------------------------------------------------

    private fun schedulePersist() {
        saveHandle?.let { window.clearTimeout(it) }
        saveHandle = window.setTimeout({ persistNow() }, 120)
    }

    private fun flush() {
        if (saveHandle != null) persistNow()
    }

    private fun persistNow() {
        saveHandle = null
        val state = AppState(tasks, projects, settings, members, activity, views, notifications)
        if (!Platform.writeStorage(STORAGE_KEY, AppJson.encodeToString(AppState.serializer(), state))) {
            toast("Could not save to local storage (quota exceeded?).", tone = "error")
        }
    }

    // ---- undoable mutations -------------------------------------------------------------------

    /** Ids of tasks generated (not user-created) by the transform currently running in [mutate]. */
    private var generatedTaskIds: Set<String> = emptySet()

    fun mutate(transform: (Data) -> Data) {
        val current = history.present
        generatedTaskIds = emptySet()
        val transformed = transform(current)
        // Keep every task's status id valid for its (possibly new) project workflow.
        val changed = transformed.copy(tasks = normalizeTasks(transformed.tasks, transformed.projects))
        if (changed == current) return
        // Every task change is logged against the current user, in the same history step.
        val entries =
            if (changed.tasks === current.tasks) {
                emptyList()
            } else {
                diffActivity(current.tasks, changed.tasks, currentUser?.id, Platform.clock().nowIso) { newId("act") }
            }
        val next = changed.copy(activity = appendActivity(changed.activity, entries))
        if (changed.tasks !== current.tasks) {
            val added =
                notificationsForChange(
                    current.tasks,
                    changed.tasks,
                    changed.members,
                    currentUser?.name ?: "Someone",
                    Platform.clock().nowIso,
                    { newId("ntf") },
                    generatedTaskIds,
                )
            if (added.isNotEmpty()) notifications = appendNotifications(notifications, added)
        }
        history = history.push(next)
        schedulePersist()
    }

    fun undo() {
        if (!history.canUndo) {
            toast("Nothing to undo")
            return
        }
        history = history.undo()
        schedulePersist()
        toast("Undone", actionLabel = "Redo") { redo() }
    }

    fun redo() {
        if (!history.canRedo) {
            toast("Nothing to redo")
            return
        }
        history = history.redo()
        schedulePersist()
        toast("Redone")
    }

    /**
     * Every task mutation goes through here, so completing a recurring task (from the list, board,
     * form or bulk action) spawns its next occurrence in the same undoable history step.
     */
    private fun updateTasks(transform: (List<Task>) -> List<Task>) {
        var spawned: List<Task> = emptyList()
        var rejected: List<BlockedCompletion> = emptyList()
        mutate { d ->
            val clock = Platform.clock()
            val (next, blocked) = enforceBlockers(d.tasks, transform(d.tasks))
            rejected = blocked
            val withCopies = spawnRecurrences(d.tasks, next, clock.nowIso, clock.today) { newId("task") }
            spawned = withCopies.drop(next.size)
            generatedTaskIds = spawned.map { it.id }.toSet()
            d.copy(tasks = withCopies)
        }
        if (rejected.isNotEmpty()) toast(blockedMessage(rejected), tone = "error")
        when {
            spawned.size == 1 -> {
                val copy = spawned.single()
                val due = copy.dueDate?.let { " (due $it)" }.orEmpty()
                toast("Next occurrence of \"${copy.title}\" created$due", actionLabel = "Open", tone = "success") {
                    Router.navigate("/tasks/${copy.id}")
                }
            }
            spawned.size > 1 -> toast("${spawned.size} recurring tasks rescheduled", tone = "success")
        }
    }

    fun member(id: String?): Member? = id?.let { mid -> members.firstOrNull { it.id == mid } }

    fun updateTask(id: String, transform: (Task) -> Task) = updateTasks { list -> list.map { if (it.id == id) transform(it) else it } }

    fun task(id: String): Task? = tasks.firstOrNull { it.id == id }

    fun project(id: String?): Project? = id?.let { pid -> projects.firstOrNull { it.id == pid } }

    /** The workflow status for [fields] in the workflow of the chosen project. */
    private fun chosenStatus(fields: TaskFields): WorkflowStatus {
        val wf = effectiveWorkflow(projects, fields.projectId)
        return wf.firstOrNull { it.id == fields.statusId } ?: wf.first { it.category == fields.status }
    }

    fun workflowFor(projectId: String?): List<WorkflowStatus> = effectiveWorkflow(projects, projectId)

    fun createTask(draft: ValidatedDraft, fields: TaskFields): Task {
        val ws = chosenStatus(fields)
        val status = ws.category
        val nowIso = Platform.clock().nowIso
        val task =
            Task(
                id = newId("task"),
                title = draft.title,
                description = draft.description,
                status = status,
                statusId = ws.id,
                priority = fields.priority,
                projectId = fields.projectId,
                assigneeId = fields.assigneeId,
                recurrence = fields.recurrence,
                tags = draft.tags,
                dueDate = draft.dueDate,
                estimateMinutes = draft.estimateMinutes,
                createdAt = nowIso,
                completedAt = if (status == Status.DONE) nowIso else null,
                order = nextOrder(tasks, status),
            )
        updateTasks { it + task }
        return task
    }

    fun saveTask(id: String, draft: ValidatedDraft, fields: TaskFields) {
        val ws = chosenStatus(fields)
        val status = ws.category
        val nowIso = Platform.clock().nowIso
        updateTasks { list ->
            list.map { t ->
                if (t.id != id) return@map t
                val moved = t.status != status
                t.withWorkflowStatus(ws, nowIso).copy(
                    title = draft.title,
                    description = draft.description,
                    priority = fields.priority,
                    projectId = fields.projectId,
                    assigneeId = fields.assigneeId,
                    recurrence = fields.recurrence,
                    tags = draft.tags,
                    dueDate = draft.dueDate,
                    estimateMinutes = draft.estimateMinutes,
                    order = if (moved) nextOrder(list, status) else t.order,
                )
            }
        }
    }

    /** Moves [ids] to [status]; returns how many actually changed (blocked completions are rejected). */
    fun setStatus(ids: Collection<String>, status: Status): Int {
        val set = ids.toSet()
        val nowIso = Platform.clock().nowIso
        val before = tasks.filter { it.id in set && it.status != status }.map { it.id }.toSet()
        updateTasks { list ->
            var next = nextOrder(list, status)
            list.map { t -> if (t.id in set && t.status != status) t.withStatus(status, nowIso).copy(order = next++) else t }
        }
        return tasks.count { it.id in before && it.status == status }
    }

    fun toggleDone(id: String) {
        val t = task(id) ?: return
        setStatus(listOf(id), if (t.status == Status.DONE) Status.TODO else Status.DONE)
    }

    fun moveToProject(ids: Collection<String>, projectId: String?) {
        val set = ids.toSet()
        updateTasks { list -> list.map { if (it.id in set) it.copy(projectId = projectId) else it } }
    }

    fun deleteTasks(ids: Collection<String>) {
        val set = ids.toSet()
        if (set.isEmpty()) return
        val count = tasks.count { it.id in set }
        updateTasks { list -> list.filterNot { it.id in set } }
        if (Pomodoro.taskId in set) Pomodoro.discard()
        toast(if (count == 1) "Task deleted" else "$count tasks deleted", actionLabel = "Undo") { undo() }
    }

    fun setTasks(transform: (List<Task>) -> List<Task>) = updateTasks(transform)

    // ---- projects -----------------------------------------------------------------------------

    fun createProject(name: String, color: String, parentId: String? = null): Project {
        val p =
            Project(
                newId("proj"),
                name.trim(),
                color,
                Platform.clock().nowIso,
                parentId =
                    parentId?.takeIf { pid ->
                        project(pid) !=
                            null
                    },
            )
        mutate { it.copy(projects = it.projects + p) }
        return p
    }

    /** Re-parents a project; returns an error when it would create a cycle. */
    fun setProjectParent(id: String, parentId: String?): String? {
        if (!canSetParent(projects, id, parentId)) return "A project cannot be moved under itself or one of its sub-projects."
        updateProject(id) { it.copy(parentId = parentId) }
        return null
    }

    // ---- workflows ----------------------------------------------------------------------------

    /** Gives [projectId] its own copy of the workflow it currently inherits. */
    fun customizeWorkflow(projectId: String) = updateProject(projectId) { it.copy(workflow = effectiveWorkflow(projects, projectId)) }

    /** Drops [projectId]'s own workflow (inherit again); tasks are mapped to the inherited statuses by category. */
    fun inheritWorkflow(projectId: String) = updateProject(projectId) { it.copy(workflow = null) }

    /** Applies [transform] to the workflow owned by [projectId]; returns a validation error instead when invalid. */
    fun editWorkflow(projectId: String, transform: (List<WorkflowStatus>) -> List<WorkflowStatus>): String? {
        val current = project(projectId)?.workflow ?: return "This project inherits its workflow; customize it first."
        val next = transform(current)
        validateWorkflow(next)?.let { return it }
        updateProject(projectId) { it.copy(workflow = next) }
        return null
    }

    /** Deletes a status and moves its tasks to [targetId]; returns an error when not allowed. */
    fun deleteWorkflowStatus(projectId: String, statusId: String, targetId: String): String? {
        val nowIso = Platform.clock().nowIso
        var error: String? = null
        // One undoable step for the workflow and the moved tasks. This is a structural migration, so
        // blocker enforcement and recurrence spawning (user completions) deliberately do not apply.
        mutate { d ->
            val r = removeWorkflowStatus(d.projects, d.tasks, projectId, statusId, targetId, nowIso)
            if (r == null) {
                error = "Each category needs at least one status, so this status cannot be deleted."
                d
            } else {
                d.copy(projects = r.first, tasks = r.second)
            }
        }
        return error
    }

    fun updateProject(id: String, transform: (Project) -> Project) =
        mutate { d -> d.copy(projects = d.projects.map { if (it.id == id) transform(it) else it }) }

    fun deleteProject(id: String, deleteTasks: Boolean, subProjects: SubProjectAction = SubProjectAction.MOVE_UP) {
        val name = project(id)?.name ?: return
        mutate { d ->
            val (p, t) = deleteProjectTree(d.projects, d.tasks, id, subProjects, deleteTasks)
            d.copy(projects = p, tasks = t)
        }
        toast("Project \"$name\" deleted", actionLabel = "Undo") { undo() }
    }

    // ---- dependencies & comments ------------------------------------------------------------

    fun openBlockersOf(id: String): List<Task> = task(id)?.let { openBlockers(it, tasks) }.orEmpty()

    /** Adds [blockerId] as a blocker of [taskId]; returns an error message (e.g. a cycle) instead when not allowed. */
    fun addBlocker(taskId: String, blockerId: String): String? {
        dependencyError(tasks, taskId, blockerId)?.let { return it }
        updateTask(taskId) { it.copy(blockedBy = it.blockedBy + blockerId) }
        return null
    }

    fun removeBlocker(taskId: String, blockerId: String) = updateTask(taskId) { it.copy(blockedBy = it.blockedBy - blockerId) }

    /** Adds a comment by the current user; returns a validation error instead when not allowed. */
    fun addComment(taskId: String, body: String): String? {
        validateComment(body)?.let { return it }
        val author = currentUser ?: return "Choose a current user in Settings before commenting."
        val comment = Comment(newId("comment"), author.id, body.trim(), Platform.clock().nowIso)
        updateTask(taskId) { it.copy(comments = it.comments + comment) }
        return null
    }

    // ---- saved views --------------------------------------------------------------------------

    fun view(id: String?): SavedView? = id?.let { vid -> views.firstOrNull { it.id == vid } }

    fun createView(name: String, query: TaskQuery): SavedView {
        val v = SavedView(newId("view"), name.trim(), viewParams(query), Platform.clock().nowIso)
        mutate { it.copy(views = it.views + v) }
        return v
    }

    fun renameView(id: String, name: String) =
        mutate { d ->
            d.copy(
                views =
                    d.views.map {
                        if (it.id ==
                            id
                        ) {
                            it.copy(name = name.trim())
                        } else {
                            it
                        }
                    },
            )
        }

    fun deleteView(id: String) {
        val name = view(id)?.name ?: return
        mutate { d -> d.copy(views = d.views.filterNot { it.id == id }) }
        toast("View \"$name\" deleted", actionLabel = "Undo") { undo() }
    }

    // ---- members ------------------------------------------------------------------------------

    fun createMember(name: String, color: String) {
        val m = Member(newId("member"), name.trim(), color)
        mutate { it.copy(members = it.members + m) }
    }

    fun updateMember(id: String, transform: (Member) -> Member) =
        mutate { d -> d.copy(members = d.members.map { if (it.id == id) transform(it) else it }) }

    fun deleteMember(id: String) {
        val name = member(id)?.name ?: return
        val count = tasks.count { it.assigneeId == id }
        mutate { d ->
            val (t, m) = removeMember(d.tasks, d.members, id)
            d.copy(tasks = t, members = m)
        }
        val suffix = if (count > 0) " ($count task${if (count == 1) "" else "s"} unassigned)" else ""
        toast("Member \"$name\" removed$suffix", actionLabel = "Undo") { undo() }
    }

    // ---- settings & data ----------------------------------------------------------------------

    fun updateSettings(transform: (Settings) -> Settings) {
        val previousUser = settings.currentUserId
        settings = transform(settings)
        Theme.apply(settings.theme)
        if (settings.currentUserId != previousUser) checkDueNotifications()
        schedulePersist()
    }

    // ---- notifications ------------------------------------------------------------------------

    /** Not part of undo history: notifications are side effects, persisted with the rest of the state. */
    var notifications by mutableStateOf(listOf<Notification>())
        private set
    var notificationsOpen by mutableStateOf(false)

    /** Adds today's due/overdue reminders for the current user (at most one per task per day). */
    fun checkDueNotifications() {
        val user = currentUser ?: return
        val clock = Platform.clock()
        val added = dueNotifications(tasks, notifications, user.id, clock.today, clock.nowIso) { newId("ntf") }
        if (added.isNotEmpty()) {
            notifications = appendNotifications(notifications, added)
            schedulePersist()
        }
    }

    fun markNotificationRead(id: String) {
        notifications = markRead(notifications, id)
        schedulePersist()
    }

    fun markAllNotificationsRead() {
        val user = currentUser ?: return
        notifications = markAllRead(notifications, user.id)
        schedulePersist()
    }

    fun cycleTheme() {
        val next =
            when (settings.theme) {
                ThemeMode.SYSTEM -> if (Platform.prefersDark()) ThemeMode.LIGHT else ThemeMode.DARK
                ThemeMode.LIGHT -> ThemeMode.DARK
                ThemeMode.DARK -> ThemeMode.LIGHT
            }
        updateSettings { it.copy(theme = next) }
    }

    /** Replaces all data (seed hook, reset, import). Clears undo history. */
    fun replaceAll(state: AppState) {
        Pomodoro.discard()
        history = history.reset(Data(state.tasks, state.projects, state.members, state.activity, state.views))
        settings = state.settings
        notifications = state.notifications
        Theme.apply(settings.theme)
        checkDueNotifications()
        persistNow()
    }

    fun resetDemo(count: Int = Demo.DEFAULT_COUNT) = replaceAll(demo(count, settings))

    fun toggleSidebar() {
        sidebarCollapsed = !sidebarCollapsed
        Platform.writeStorage("taskpilot:sidebar", if (sidebarCollapsed) "collapsed" else "expanded")
    }

    // ---- toasts -------------------------------------------------------------------------------

    fun toast(message: String, actionLabel: String? = null, tone: String = "info", action: (() -> Unit)? = null) {
        val t = Toast(++toastSeq, message, actionLabel, action, tone)
        toasts.add(t)
        while (toasts.size > 4) toasts.removeAt(0)
        window.setTimeout({ dismissToast(t.id) }, 5000)
    }

    fun dismissToast(id: Int) {
        toasts.removeAll { it.id == id }
    }

    fun announce(message: String) {
        // Clear first so repeating the same message is announced again.
        announcement = ""
        window.setTimeout({ announcement = message }, 30)
    }

    fun openNewTask(defaults: Task? = null) {
        taskModal = TaskModalRequest(null, defaults)
    }

    fun openEditTask(id: String) {
        taskModal = TaskModalRequest(id)
    }

    fun focusGlobalSearch() {
        (document.querySelector("[data-testid=global-search]") as? org.w3c.dom.HTMLElement)?.focus()
    }
}
