package taskpilot

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

val AppJson =
    Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = true
    }

private val PrettyJson =
    Json {
        prettyPrint = true
        encodeDefaults = true
        explicitNulls = true
    }

fun exportState(state: AppState): String = PrettyJson.encodeToString(AppState.serializer(), state)

sealed interface ImportResult {
    data class Ok(val state: AppState) : ImportResult

    data class Error(val message: String) : ImportResult
}

private class SchemaError(message: String) : Exception(message)

private const val SETTINGS_POMODORO_MAX = 180
private const val SETTINGS_PAGE_MAX = 200

/**
 * Parses and validates an exported state file. Returns a human readable error naming the first
 * offending field (e.g. `tasks[3].status`) when the document does not match the schema.
 */
fun importState(text: String, fallbackSettings: Settings = Settings()): ImportResult {
    val root =
        try {
            Json.parseToJsonElement(text)
        } catch (e: Exception) {
            return ImportResult.Error("The file is not valid JSON.")
        }
    return try {
        ImportResult.Ok(validateRoot(root, fallbackSettings))
    } catch (e: SchemaError) {
        ImportResult.Error("Invalid file: ${e.message}")
    }
}

private fun fail(path: String, msg: String): Nothing = throw SchemaError("$path $msg")

private fun JsonElement.obj(path: String): JsonObject = this as? JsonObject ?: fail(path, "must be an object.")

private fun JsonElement.arr(path: String): JsonArray = this as? JsonArray ?: fail(path, "must be an array.")

private fun JsonObject.str(key: String, path: String): String {
    val v = this[key] ?: fail("$path.$key", "is missing.")
    return (v as? JsonPrimitive)?.takeIf { it.isString }?.content ?: fail("$path.$key", "must be a string.")
}

private fun JsonObject.optStr(key: String, path: String): String? {
    val v = this[key]
    if (v == null || v is JsonNull) return null
    return (v as? JsonPrimitive)?.takeIf { it.isString }?.content ?: fail("$path.$key", "must be a string or null.")
}

private fun JsonObject.int(key: String, path: String, default: Int? = null): Int {
    val v = this[key]
    if (v == null || v is JsonNull) return default ?: fail("$path.$key", "is missing.")
    return v.asInt() ?: fail("$path.$key", "must be an integer.")
}

private fun JsonObject.optInt(key: String, path: String): Int? {
    val v = this[key]
    if (v == null || v is JsonNull) return null
    return v.asInt() ?: fail("$path.$key", "must be an integer or null.")
}

private fun JsonElement.asInt(): Int? {
    val p = this as? JsonPrimitive ?: return null
    if (p.isString) return null
    val d = p.doubleOrNull ?: return null
    if (d != kotlin.math.floor(d) || d > Int.MAX_VALUE || d < Int.MIN_VALUE) return null
    return d.toInt()
}

private val HEX = Regex("^#[0-9a-fA-F]{6}$")

private fun validateRoot(root: JsonElement, fallbackSettings: Settings): AppState {
    val o = root.obj("root")
    val version = o.int("schemaVersion", "root", 1)
    if (version > SCHEMA_VERSION) fail("schemaVersion", "$version is newer than this app supports ($SCHEMA_VERSION).")
    if (version < 1) fail("schemaVersion", "must be 1 or $SCHEMA_VERSION.")
    val projectsJson = (o["projects"] ?: fail("projects", "is missing.")).arr("projects")
    val projects =
        projectsJson.mapIndexed { i, el ->
            val p = "projects[$i]"
            val po = el.obj(p)
            val name = po.str("name", p).trim()
            if (name.isEmpty()) fail("$p.name", "must not be empty.")
            val color = po.str("color", p)
            if (!HEX.matches(color)) fail("$p.color", "must be a hex colour like #6366f1.")
            val createdAt = po.str("createdAt", p)
            if (Dates.millisFromIso(createdAt) == null) fail("$p.createdAt", "must be an ISO timestamp.")
            val workflow =
                po["workflow"]?.takeIf { it !is JsonNull }?.arr("$p.workflow")?.mapIndexed { j, s ->
                    val sp = "$p.workflow[$j]"
                    val so = s.obj(sp)
                    val categoryKey = so.str("category", sp)
                    val category =
                        Status.fromKey(categoryKey)
                            ?: fail("$sp.category", "must be one of todo, in_progress, done (got \"$categoryKey\").")
                    val sColor = so.str("color", sp)
                    if (!HEX.matches(sColor)) fail("$sp.color", "must be a hex colour like #64748b.")
                    WorkflowStatus(
                        so.str("id", sp).ifEmpty { fail("$sp.id", "must not be empty.") },
                        so.str("name", sp).trim(),
                        sColor,
                        category,
                    )
                }
            workflow?.let { wf -> validateWorkflow(wf)?.let { fail("$p.workflow", it.replaceFirstChar { c -> c.lowercase() }) } }
            Project(
                id = po.str("id", p).ifEmpty { fail("$p.id", "must not be empty.") },
                name = name,
                color = color,
                createdAt = createdAt,
                parentId = po.optStr("parentId", p),
                workflow = workflow,
            )
        }
    val projectIds = projects.map { it.id }
    if (projectIds.toSet().size != projectIds.size) fail("projects", "contain duplicate ids.")
    projects.forEachIndexed { i, pr ->
        val parent = pr.parentId ?: return@forEachIndexed
        if (parent !in projectIds) fail("projects[$i].parentId", "references unknown project \"$parent\".")
        if (parent == pr.id || ancestors(projects, parent).any { it.id == pr.id }) {
            fail("projects[$i].parentId", "creates a cycle in the project hierarchy.")
        }
    }

    val tasksJson = (o["tasks"] ?: fail("tasks", "is missing.")).arr("tasks")
    val members =
        o["members"]
            ?.takeIf { it !is JsonNull }
            ?.arr("members")
            ?.mapIndexed { i, el ->
                val p = "members[$i]"
                val mo = el.obj(p)
                val name = mo.str("name", p).trim()
                if (name.isEmpty()) fail("$p.name", "must not be empty.")
                if (name.length > Limits.MEMBER_NAME_MAX) fail("$p.name", "must be at most ${Limits.MEMBER_NAME_MAX} characters.")
                val color = mo.str("color", p)
                if (!HEX.matches(color)) fail("$p.color", "must be a hex colour like #0ea5e9.")
                Member(id = mo.str("id", p).ifEmpty { fail("$p.id", "must not be empty.") }, name = name, color = color)
            }.orEmpty()
    val memberIds = members.map { it.id }.toSet()
    if (memberIds.size != members.size) fail("members", "contain duplicate ids.")

    val parsedTasks = tasksJson.mapIndexed { i, el -> validateTask(el, "tasks[$i]", projectIds.toSet(), memberIds) }
    // Dependencies on tasks that are not in the file (or on the task itself) are dropped.
    val taskIds = parsedTasks.map { it.id }.toSet()
    // Status ids that do not exist in the task's workflow (or disagree with its category) are mapped by category.
    val tasks =
        normalizeTasks(parsedTasks.map { t -> t.copy(blockedBy = t.blockedBy.filter { it in taskIds && it != t.id }.distinct()) }, projects)
    if (tasks.map { it.id }.toSet().size != tasks.size) fail("tasks", "contain duplicate ids.")

    val settings =
        o["settings"]?.takeIf { it !is JsonNull }?.let { el ->
            val so = el.obj("settings")
            val theme =
                when (val t = so.optStr("theme", "settings") ?: "system") {
                    "light" -> ThemeMode.LIGHT
                    "dark" -> ThemeMode.DARK
                    "system" -> ThemeMode.SYSTEM
                    else -> fail("settings.theme", "must be light, dark or system (got \"$t\").")
                }
            val pomodoro = so.int("pomodoroMinutes", "settings", fallbackSettings.pomodoroMinutes)
            if (pomodoro !in 1..SETTINGS_POMODORO_MAX) fail("settings.pomodoroMinutes", "must be between 1 and $SETTINGS_POMODORO_MAX.")
            val pageSize = so.int("pageSize", "settings", fallbackSettings.pageSize)
            if (pageSize !in 1..SETTINGS_PAGE_MAX) fail("settings.pageSize", "must be between 1 and $SETTINGS_PAGE_MAX.")
            val currentUser =
                if (so.containsKey("currentUserId")) so.optStr("currentUserId", "settings") else fallbackSettings.currentUserId
            Settings(theme, pomodoro, pageSize, currentUser)
        } ?: fallbackSettings
    val activity =
        o["activity"]
            ?.takeIf { it !is JsonNull }
            ?.arr("activity")
            ?.mapIndexed { i, el -> validateActivity(el, "activity[$i]") }
            .orEmpty()
    val views =
        o["views"]
            ?.takeIf { it !is JsonNull }
            ?.arr("views")
            ?.mapIndexed { i, el ->
                val p = "views[$i]"
                val vo = el.obj(p)
                val name = vo.str("name", p).trim()
                if (name.isEmpty() || name.length > VIEW_NAME_MAX) fail("$p.name", "must be 1-$VIEW_NAME_MAX characters.")
                val params =
                    (vo["params"] ?: fail("$p.params", "is missing.")).obj("$p.params").mapValues { (k, v) ->
                        (v as? JsonPrimitive)?.takeIf { it.isString }?.content ?: fail("$p.params.$k", "must be a string.")
                    }
                SavedView(vo.str("id", p), name, params, vo.optStr("createdAt", p) ?: "1970-01-01T00:00:00.000Z")
            }.orEmpty()
    // Notifications are local reminders; an imported file starts without them.
    return AppState(tasks, projects, settings, members, activity.takeLast(ACTIVITY_LIMIT), views)
}

private fun validateActivity(el: JsonElement, p: String): ActivityEntry {
    val o = el.obj(p)
    val typeKey = o.str("type", p)
    val type = ActivityType.fromKey(typeKey) ?: fail("$p.type", "is not a known activity type (got \"$typeKey\").")
    val at = o.str("at", p)
    if (Dates.millisFromIso(at) == null) fail("$p.at", "must be an ISO timestamp.")
    return ActivityEntry(
        id = o.str("id", p),
        taskId = o.str("taskId", p),
        actorId = o.optStr("actorId", p),
        type = type,
        field = o.optStr("field", p),
        from = o.optStr("from", p),
        to = o.optStr("to", p),
        at = at,
    )
}

private fun validateTask(el: JsonElement, p: String, projectIds: Set<String>, memberIds: Set<String>): Task {
    val o = el.obj(p)
    val id = o.str("id", p).ifEmpty { fail("$p.id", "must not be empty.") }
    val title = o.str("title", p)
    if (title.isBlank()) fail("$p.title", "must not be empty.")
    if (title.length > Limits.TITLE_MAX) fail("$p.title", "must be at most ${Limits.TITLE_MAX} characters.")
    val description = o.optStr("description", p).orEmpty()
    if (description.length > Limits.DESCRIPTION_MAX) fail("$p.description", "must be at most ${Limits.DESCRIPTION_MAX} characters.")
    val statusKey = o.str("status", p)
    val status = Status.fromKey(statusKey) ?: fail("$p.status", "must be one of todo, in_progress, done (got \"$statusKey\").")
    val priorityKey = o.str("priority", p)
    val priority = Priority.fromKey(priorityKey) ?: fail("$p.priority", "must be one of low, medium, high, urgent (got \"$priorityKey\").")
    val projectId = o.optStr("projectId", p)
    if (projectId != null && projectId !in projectIds) fail("$p.projectId", "references unknown project \"$projectId\".")
    val tagsEl = o["tags"]
    val tags =
        if (tagsEl == null || tagsEl is JsonNull) {
            emptyList()
        } else {
            tagsEl
                .arr("$p.tags")
                .mapIndexed { j, t ->
                    (t as? JsonPrimitive)
                        ?.takeIf { it.isString }
                        ?.content
                        ?.trim()
                        ?.lowercase()
                        ?: fail("$p.tags[$j]", "must be a string.")
                }.filter { it.isNotEmpty() }
                .distinct()
        }
    if (tags.size > Limits.TAGS_MAX) fail("$p.tags", "must contain at most ${Limits.TAGS_MAX} tags.")
    val due = o.optStr("dueDate", p)
    if (due != null && Dates.parse(due) == null) fail("$p.dueDate", "must be a date in YYYY-MM-DD format.")
    val estimate = o.optInt("estimateMinutes", p)
    if (estimate != null && estimate <= 0) fail("$p.estimateMinutes", "must be a positive integer.")
    val spent = o.int("timeSpentMinutes", p, 0)
    if (spent < 0) fail("$p.timeSpentMinutes", "must not be negative.")
    val subtasksEl = o["subtasks"]
    val subtasks =
        if (subtasksEl == null || subtasksEl is JsonNull) {
            emptyList()
        } else {
            subtasksEl.arr("$p.subtasks").mapIndexed { j, s ->
                val sp = "$p.subtasks[$j]"
                val so = s.obj(sp)
                val done = (so["done"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: fail("$sp.done", "must be a boolean.")
                Subtask(so.str("id", sp), so.str("title", sp), done)
            }
        }
    val createdAt = o.str("createdAt", p)
    if (Dates.millisFromIso(createdAt) == null) fail("$p.createdAt", "must be an ISO timestamp.")
    val completedAt = o.optStr("completedAt", p)
    if (completedAt != null && Dates.millisFromIso(completedAt) == null) fail("$p.completedAt", "must be an ISO timestamp or null.")
    val order = o.int("order", p, 0)
    val assigneeId = o.optStr("assigneeId", p)
    if (assigneeId != null && assigneeId !in memberIds) fail("$p.assigneeId", "references unknown member \"$assigneeId\".")
    val blockedByEl = o["blockedBy"]
    val blockedBy =
        if (blockedByEl == null || blockedByEl is JsonNull) {
            emptyList()
        } else {
            blockedByEl.arr("$p.blockedBy").mapIndexed { j, b ->
                (b as? JsonPrimitive)?.takeIf { it.isString }?.content ?: fail("$p.blockedBy[$j]", "must be a task id string.")
            }
        }
    val commentsEl = o["comments"]
    val comments =
        if (commentsEl == null || commentsEl is JsonNull) {
            emptyList()
        } else {
            commentsEl.arr("$p.comments").mapIndexed { j, c ->
                val cp = "$p.comments[$j]"
                val co = c.obj(cp)
                val body = co.str("body", cp)
                if (body.isBlank()) fail("$cp.body", "must not be empty.")
                if (body.length > COMMENT_MAX) fail("$cp.body", "must be at most $COMMENT_MAX characters.")
                val createdAt = co.str("createdAt", cp)
                if (Dates.millisFromIso(createdAt) == null) fail("$cp.createdAt", "must be an ISO timestamp.")
                Comment(co.str("id", cp), co.optStr("authorId", cp), body, createdAt)
            }
        }
    val recurrenceKey = o.optStr("recurrence", p) ?: Recurrence.NONE.key
    val recurrence =
        Recurrence.fromKey(recurrenceKey)
            ?: fail("$p.recurrence", "must be one of none, daily, weekly, monthly (got \"$recurrenceKey\").")
    return Task(
        id = id,
        title = title,
        description = description,
        status = status,
        statusId = o.optStr("statusId", p)?.takeIf { it.isNotBlank() } ?: status.key,
        priority = priority,
        projectId = projectId,
        tags = tags,
        dueDate = due,
        estimateMinutes = estimate,
        timeSpentMinutes = spent,
        subtasks = subtasks,
        createdAt = createdAt,
        completedAt = if (status == Status.DONE) completedAt else null,
        order = order,
        assigneeId = assigneeId,
        recurrence = recurrence,
        blockedBy = blockedBy,
        comments = comments,
    )
}

const val STORAGE_KEY_V1 = "taskpilot:v1"
const val STORAGE_KEY_V2 = "taskpilot:v2"

/** Brings a decoded state of any schema version up to [SCHEMA_VERSION] (v1 → v2: status ids from categories). */
fun migrateState(
    state: AppState,
): AppState = state.copy(tasks = normalizeTasks(state.tasks, state.projects), schemaVersion = SCHEMA_VERSION)

/** Decodes persisted JSON (v1 or v2) leniently and migrates it; null when it is unreadable. */
fun decodeStoredState(text: String): AppState? {
    val decoded =
        try {
            AppJson.decodeFromString(AppState.serializer(), text)
        } catch (e: Exception) {
            (importState(text) as? ImportResult.Ok)?.state
        }
    return decoded?.let { migrateState(it) }
}
