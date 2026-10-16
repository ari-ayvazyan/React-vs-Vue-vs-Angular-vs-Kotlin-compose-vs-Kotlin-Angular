@file:OptIn(ExperimentalJsExport::class)

package taskpilot

/** localStorage key used for persistence (schema 2: sub-projects and custom workflows). */
@JsExport
const val STORAGE_KEY: String = "taskpilot:v2"

/** Key of the schema-1 data written by earlier versions; migrated to [STORAGE_KEY] on load. */
@JsExport
const val LEGACY_STORAGE_KEY: String = "taskpilot:v1"

/** Current export / storage schema version. Exports without a "schema" field are version 1. */
@JsExport
const val SCHEMA_VERSION: Int = 2

/** Thrown internally while walking untrusted JSON; carries a user-facing message with a JSON path. */
internal class SchemaError(
    message: String,
) : Exception(message)

@JsExport
class ImportResult(
    val ok: Boolean,
    val error: String,
    val state: AppState?,
    /** Schema version of the input (1 = migrated from the old format). */
    val sourceSchema: Int = SCHEMA_VERSION,
) {
    val taskCount: Int get() = state?.tasks?.size ?: 0
    val projectCount: Int get() = state?.projects?.size ?: 0
}

private fun jsonObject(): dynamic = js("({})")

internal fun taskToJson(t: Task): dynamic {
    val o = jsonObject()
    o["id"] = t.id
    o["title"] = t.title
    o["description"] = t.description
    o["status"] = t.status
    o["priority"] = t.priority
    o["projectId"] = t.projectId
    o["tags"] = t.tags.copyOf()
    o["dueDate"] = t.dueDate
    o["estimateMinutes"] = t.estimateMinutes
    o["timeSpentMinutes"] = t.timeSpentMinutes
    o["subtasks"] =
        t.subtasks
            .map { s ->
                val so = jsonObject()
                so["id"] = s.id
                so["title"] = s.title
                so["done"] = s.done
                so
            }.toTypedArray()
    o["createdAt"] = t.createdAt
    o["completedAt"] = t.completedAt
    o["order"] = t.order
    o["assigneeId"] = t.assigneeId
    o["recurrence"] = t.recurrence
    o["blockedBy"] = t.blockedBy.copyOf()
    o["comments"] =
        t.comments
            .map { c ->
                val co = jsonObject()
                co["id"] = c.id
                co["authorId"] = c.authorId
                co["body"] = c.body
                co["createdAt"] = c.createdAt
                co
            }.toTypedArray()
    return o
}

internal fun stateToJson(state: AppState): dynamic {
    val o = jsonObject()
    o["schema"] = SCHEMA_VERSION
    o["tasks"] = state.tasks.map { taskToJson(it) }.toTypedArray()
    o["projects"] =
        state.projects
            .map { p ->
                val po = jsonObject()
                po["id"] = p.id
                po["name"] = p.name
                po["color"] = p.color
                po["createdAt"] = p.createdAt
                po["parentId"] = p.parentId
                po["workflow"] =
                    p.workflow
                        ?.map { w ->
                            val wo = jsonObject()
                            wo["id"] = w.id
                            wo["name"] = w.name
                            wo["color"] = w.color
                            wo["category"] = w.category
                            wo
                        }?.toTypedArray()
                po
            }.toTypedArray()
    o["members"] =
        state.members
            .map { m ->
                val mo = jsonObject()
                mo["id"] = m.id
                mo["name"] = m.name
                mo["color"] = m.color
                mo
            }.toTypedArray()
    val s = jsonObject()
    s["theme"] = state.settings.theme
    s["pomodoroMinutes"] = state.settings.pomodoroMinutes
    s["pageSize"] = state.settings.pageSize
    s["currentUserId"] = state.settings.currentUserId
    o["settings"] = s
    o["views"] =
        state.views
            .map { v ->
                val vo = jsonObject()
                vo["id"] = v.id
                vo["name"] = v.name
                vo["query"] = v.query
                vo["createdAt"] = v.createdAt
                vo
            }.toTypedArray()
    o["notifications"] =
        state.notifications
            .map { n ->
                val no = jsonObject()
                no["id"] = n.id
                no["userId"] = n.userId
                no["type"] = n.type
                no["taskId"] = n.taskId
                no["text"] = n.text
                no["at"] = n.at
                no["read"] = n.read
                no["key"] = n.key
                no
            }.toTypedArray()
    o["activity"] =
        state.activity
            .map { a ->
                val ao = jsonObject()
                ao["id"] = a.id
                ao["taskId"] = a.taskId
                ao["actorId"] = a.actorId
                ao["type"] = a.type
                ao["field"] = a.field
                ao["from"] = a.from
                ao["to"] = a.to
                ao["at"] = a.at
                ao["taskTitle"] = a.taskTitle
                ao
            }.toTypedArray()
    return o
}

/** Serializes the state as JSON (pretty-printed when [pretty]). */
@JsExport
fun serializeState(
    state: AppState,
    pretty: Boolean,
): String = if (pretty) JSON.stringify(stateToJson(state), null, 2) else JSON.stringify(stateToJson(state))

// ---- Schema validation of untrusted JSON -------------------------------------------------------

private fun typeOf(v: dynamic): String = js("(v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)") as String

private fun field(
    obj: dynamic,
    key: String,
): dynamic = if (js("Object.prototype.hasOwnProperty.call(obj, key)") as Boolean) obj[key] else undefined

private fun requireObject(
    v: dynamic,
    path: String,
) {
    if (typeOf(v) != "object") throw SchemaError("$path must be an object (got ${typeOf(v)}).")
}

private fun str(
    obj: dynamic,
    key: String,
    path: String,
): String {
    val v = field(obj, key)
    if (typeOf(v) != "string") throw SchemaError("$path.$key must be a string (got ${typeOf(v)}).")
    return v as String
}

private fun nullableStr(
    obj: dynamic,
    key: String,
    path: String,
): String? {
    val v = field(obj, key)
    val t = typeOf(v)
    if (t == "null" || t == "undefined") return null
    if (t != "string") throw SchemaError("$path.$key must be a string or null (got $t).")
    return v as String
}

private fun int(
    obj: dynamic,
    key: String,
    path: String,
    min: Int,
): Int {
    val v = field(obj, key)
    if (typeOf(v) != "number" || !(js("Number.isInteger(v)") as Boolean)) {
        throw SchemaError("$path.$key must be an integer (got ${typeOf(v)}).")
    }
    val n = (v as Number).toDouble()
    if (n < min || n > Int.MAX_VALUE) throw SchemaError("$path.$key must be ≥ $min.")
    return n.toInt()
}

private fun nullablePositiveInt(
    obj: dynamic,
    key: String,
    path: String,
): Int? {
    val t = typeOf(field(obj, key))
    if (t == "null" || t == "undefined") return null
    return int(obj, key, path, 1)
}

private fun array(
    obj: dynamic,
    key: String,
    path: String,
): Array<dynamic> {
    val v = field(obj, key)
    if (typeOf(v) != "array") throw SchemaError("$path.$key must be an array (got ${typeOf(v)}).")
    @Suppress("UNCHECKED_CAST_TO_EXTERNAL_INTERFACE", "UnsafeCastFromDynamic")
    return v.unsafeCast<Array<dynamic>>()
}

private fun oneOf(
    value: String,
    allowed: Array<String>,
    path: String,
): String {
    if (value !in allowed) throw SchemaError("$path must be one of ${allowed.joinToString(", ")} (got \"$value\").")
    return value
}

private fun parseProject(
    v: dynamic,
    path: String,
    schema: Int,
): Project {
    requireObject(v, path)
    val id = str(v, "id", path)
    if (id.isEmpty()) throw SchemaError("$path.id must not be empty.")
    val name = str(v, "name", path)
    if (name.trim().isEmpty()) throw SchemaError("$path.name must not be empty.")
    val color = str(v, "color", path)
    if (!isHexColor(color)) throw SchemaError("$path.color must be a hex colour like #6366f1.")
    val createdAt = str(v, "createdAt", path)
    if (parseInstant(createdAt) == null) throw SchemaError("$path.createdAt must be an ISO timestamp.")
    if (schema < 2) return Project(id, name, color, createdAt)
    val parentId = nullableStr(v, "parentId", path)?.ifEmpty { null }
    val workflow =
        if (typeOf(field(v, "workflow")) in setOf("undefined", "null")) {
            null
        } else {
            array(v, "workflow", path)
                .mapIndexed { i, w ->
                    val wp = "$path.workflow[$i]"
                    requireObject(w, wp)
                    WorkflowStatus(
                        str(w, "id", wp),
                        str(w, "name", wp).trim(),
                        str(w, "color", wp),
                        oneOf(str(w, "category", wp), Status.all, "$wp.category"),
                    )
                }.toTypedArray()
                .also { wf -> validateWorkflow(wf).takeIf { it.isNotEmpty() }?.let { throw SchemaError("$path.workflow: $it") } }
        }
    return Project(id, name, color, createdAt, parentId, workflow)
}

private fun parseMember(
    v: dynamic,
    path: String,
): Member {
    requireObject(v, path)
    val id = str(v, "id", path)
    if (id.isEmpty()) throw SchemaError("$path.id must not be empty.")
    val name = str(v, "name", path)
    if (name.trim().isEmpty() || name.length > Limits.MEMBER_NAME_MAX) {
        throw SchemaError("$path.name must be 1–${Limits.MEMBER_NAME_MAX} characters.")
    }
    val color = str(v, "color", path)
    if (!isHexColor(color)) throw SchemaError("$path.color must be a hex colour like #0ea5e9.")
    return Member(id, name, color)
}

private fun parseTask(
    v: dynamic,
    path: String,
    projectIds: Set<String>,
    memberIds: Set<String>,
    schema: Int,
): Task {
    requireObject(v, path)
    val id = str(v, "id", path)
    if (id.isEmpty()) throw SchemaError("$path.id must not be empty.")
    val title = str(v, "title", path)
    if (title.trim().isEmpty() || title.length > Limits.TITLE_MAX) {
        throw SchemaError("$path.title must be 1–${Limits.TITLE_MAX} characters.")
    }
    val description = nullableStr(v, "description", path).orEmpty()
    if (description.length > Limits.DESCRIPTION_MAX) {
        throw SchemaError("$path.description must be at most ${Limits.DESCRIPTION_MAX} characters.")
    }
    // Schema 1: status is one of the categories. Schema 2: a status id, checked against the workflow later.
    val status = if (schema < 2) oneOf(str(v, "status", path), Status.all, "$path.status") else str(v, "status", path)
    val priority = oneOf(str(v, "priority", path), Priority.all, "$path.priority")
    val projectId = nullableStr(v, "projectId", path)
    if (projectId != null && projectId !in projectIds) {
        throw SchemaError("$path.projectId \"$projectId\" does not match any project.")
    }
    val rawTags = array(v, "tags", path)
    val tags =
        rawTags
            .mapIndexed { i, tag ->
                if (typeOf(tag) != "string") throw SchemaError("$path.tags[$i] must be a string.")
                (tag as String).trim().lowercase()
            }.filter { it.isNotEmpty() }
            .distinct()
    if (tags.size > Limits.TAGS_MAX) throw SchemaError("$path.tags must contain at most ${Limits.TAGS_MAX} tags.")
    val dueDate = nullableStr(v, "dueDate", path)
    if (dueDate != null && parseDay(dueDate) == null) throw SchemaError("$path.dueDate must be a date in YYYY-MM-DD format.")
    val estimate = nullablePositiveInt(v, "estimateMinutes", path)
    val spent = int(v, "timeSpentMinutes", path, 0)
    val subtasks =
        array(v, "subtasks", path)
            .mapIndexed { i, s ->
                val sp = "$path.subtasks[$i]"
                requireObject(s, sp)
                val done = field(s, "done")
                if (typeOf(done) != "boolean") throw SchemaError("$sp.done must be a boolean.")
                Subtask(str(s, "id", sp), str(s, "title", sp), done as Boolean)
            }.toTypedArray()
    val createdAt = str(v, "createdAt", path)
    if (parseInstant(createdAt) == null) throw SchemaError("$path.createdAt must be an ISO timestamp.")
    var completedAt = nullableStr(v, "completedAt", path)
    if (completedAt != null && parseInstant(completedAt) == null) throw SchemaError("$path.completedAt must be an ISO timestamp or null.")
    val order = int(v, "order", path, 0)
    // Fields added after v1 (team members / recurrence) are optional so older data keeps loading.
    val assigneeId = nullableStr(v, "assigneeId", path)
    if (assigneeId != null && assigneeId !in memberIds) {
        throw SchemaError("$path.assigneeId \"$assigneeId\" does not match any member.")
    }
    val recurrence = nullableStr(v, "recurrence", path)?.let { oneOf(it, Recurrence.all, "$path.recurrence") } ?: Recurrence.NONE
    val blockedBy =
        optionalArray(v, "blockedBy", path)
            .mapIndexed { i, b ->
                if (typeOf(b) != "string") throw SchemaError("$path.blockedBy[$i] must be a task id string.")
                b as String
            }.distinct()
    if (id in blockedBy) throw SchemaError("$path.blockedBy must not contain the task itself.")
    val comments =
        optionalArray(v, "comments", path)
            .mapIndexed { i, c ->
                val cp = "$path.comments[$i]"
                requireObject(c, cp)
                val createdAt = str(c, "createdAt", cp)
                if (parseInstant(createdAt) == null) throw SchemaError("$cp.createdAt must be an ISO timestamp.")
                val body = str(c, "body", cp)
                if (body.length > Limits.COMMENT_MAX) throw SchemaError("$cp.body must be at most ${Limits.COMMENT_MAX} characters.")
                Comment(str(c, "id", cp), str(c, "authorId", cp), body, createdAt)
            }.toTypedArray()
    return Task(
        id,
        title,
        description,
        status,
        priority,
        projectId,
        tags.toTypedArray(),
        dueDate,
        estimate,
        spent,
        subtasks,
        createdAt,
        completedAt,
        order,
        assigneeId,
        recurrence,
        blockedBy.toTypedArray(),
        comments,
    )
}

private fun optionalArray(
    obj: dynamic,
    key: String,
    path: String,
): Array<dynamic> {
    val t = typeOf(field(obj, key))
    return if (t == "undefined" || t == "null") emptyArray() else array(obj, key, path)
}

private fun parseActivity(
    v: dynamic,
    path: String,
): ActivityEntry {
    requireObject(v, path)
    val type = oneOf(str(v, "type", path), ActivityType.all, "$path.type")
    val at = str(v, "at", path)
    if (parseInstant(at) == null) throw SchemaError("$path.at must be an ISO timestamp.")
    return ActivityEntry(
        str(v, "id", path),
        str(v, "taskId", path),
        str(v, "actorId", path),
        type,
        nullableStr(v, "field", path),
        nullableStr(v, "from", path),
        nullableStr(v, "to", path),
        at,
        nullableStr(v, "taskTitle", path).orEmpty(),
    )
}

private fun parseSettings(
    v: dynamic,
    path: String,
): Settings {
    if (typeOf(v) == "undefined") return Settings.DEFAULT
    requireObject(v, path)
    val theme = oneOf(str(v, "theme", path), Theme.all, "$path.theme")
    val pomodoro = int(v, "pomodoroMinutes", path, Limits.POMODORO_MIN)
    if (pomodoro > Limits.POMODORO_MAX) throw SchemaError("$path.pomodoroMinutes must be at most ${Limits.POMODORO_MAX}.")
    val pageSize = int(v, "pageSize", path, 1)
    if (pageSize > 500) throw SchemaError("$path.pageSize must be at most 500.")
    val currentUser = nullableStr(v, "currentUserId", path) ?: Settings.DEFAULT_USER_ID
    return Settings(theme, pomodoro, pageSize, currentUser)
}

/** Schema version of a parsed document (missing = 1). */
private fun schemaOf(root: dynamic): Int {
    val v = field(root, "schema")
    return when (typeOf(v)) {
        "undefined", "null" -> 1
        "number" -> (v as Number).toInt().takeIf { it == 1 || it == SCHEMA_VERSION } ?: throw SchemaError("Unsupported schema version $v.")
        else -> throw SchemaError("root.schema must be a number.")
    }
}

/**
 * Validates and converts parsed JSON into an [AppState]; throws [SchemaError] with a precise message.
 * Schema 1 documents (no sub-projects, statuses = categories) are migrated: every project gets no parent and
 * the default workflow, whose status ids equal the old status values.
 */
internal fun stateFromJson(root: dynamic): AppState {
    requireObject(root, "Root")
    val schema = schemaOf(root)
    val projects = array(root, "projects", "root").mapIndexed { i, p -> parseProject(p, "projects[$i]", schema) }
    val projectIds = projects.map { it.id }
    val dupProject =
        projectIds
            .groupingBy { it }
            .eachCount()
            .entries
            .firstOrNull { it.value > 1 }
    if (dupProject != null) throw SchemaError("Duplicate project id \"${dupProject.key}\".")
    val idSet = projectIds.toSet()
    projects.forEachIndexed { i, p ->
        if (p.parentId != null &&
            p.parentId !in idSet
        ) {
            throw SchemaError("projects[$i].parentId \"${p.parentId}\" does not match any project.")
        }
    }
    val tree = AppState(emptyArray(), projects.toTypedArray(), Settings.DEFAULT, emptyArray())
    projects.firstOrNull { p -> p.parentId != null && (p.parentId == p.id || p.id in ancestorsOf(tree, p.parentId).map { it.id }) }?.let {
        throw SchemaError("Project hierarchy cycle involving project \"${it.id}\".")
    }
    val members =
        if (typeOf(field(root, "members")) == "undefined") {
            emptyList()
        } else {
            array(root, "members", "root").mapIndexed { i, m -> parseMember(m, "members[$i]") }
        }
    val dupMember =
        members
            .groupingBy { it.id }
            .eachCount()
            .entries
            .firstOrNull { it.value > 1 }
    if (dupMember != null) throw SchemaError("Duplicate member id \"${dupMember.key}\".")
    val memberIds = members.map { it.id }.toSet()
    val lookup = StatusLookup(tree)
    val tasks =
        array(root, "tasks", "root").mapIndexed { i, t ->
            val task = parseTask(t, "tasks[$i]", idSet, memberIds, schema)
            val workflow = lookup.workflowOfProject(task.projectId)
            val status =
                workflow.firstOrNull { it.id == task.status }
                    ?: throw SchemaError("tasks[$i].status \"${task.status}\" is not a status of the task's project workflow.")
            // Invariant: completedAt is set iff the status is in the done category.
            val completedAt = if (status.category == Status.DONE) task.completedAt ?: task.createdAt else null
            task.copy(category = status.category, completedAt = completedAt)
        }
    val dupTask =
        tasks
            .groupingBy { it.id }
            .eachCount()
            .entries
            .firstOrNull { it.value > 1 }
    if (dupTask != null) throw SchemaError("Duplicate task id \"${dupTask.key}\".")
    val taskIds = tasks.mapTo(HashSet()) { it.id }
    tasks.forEachIndexed { i, t ->
        t.blockedBy.firstOrNull { it !in taskIds }?.let { throw SchemaError("tasks[$i].blockedBy references unknown task \"$it\".") }
    }
    val settings = parseSettings(field(root, "settings"), "settings")
    val activity = optionalArray(root, "activity", "root").mapIndexed { i, a -> parseActivity(a, "activity[$i]") }
    val views =
        optionalArray(root, "views", "root").mapIndexed { i, v ->
            val vp = "views[$i]"
            requireObject(v, vp)
            val name = str(v, "name", vp)
            if (name.isBlank() || name.length > 40) throw SchemaError("$vp.name must be 1–40 characters.")
            // Re-serialise through TaskQuery so only valid, canonical filters are kept.
            val query = TaskQuery.parse(str(v, "query", vp)).withPage(1).toQueryString()
            SavedView(str(v, "id", vp), name, query, nullableStr(v, "createdAt", vp) ?: "1970-01-01T00:00:00.000Z")
        }
    val state =
        AppState(
            tasks.toTypedArray(),
            projects.toTypedArray(),
            settings,
            members.toTypedArray(),
            activity.toTypedArray(),
            views.toTypedArray(),
            notifications(root).toTypedArray(),
        )
    state.tasks.firstOrNull { t -> dependsOnAny(state, t) }?.let { throw SchemaError("Dependency cycle involving task \"${it.id}\".") }
    return state
}

/** Parses + schema-validates import text. Never throws. */
@JsExport
fun parseImport(text: String): ImportResult {
    if (text.isBlank()) return ImportResult(false, "The file is empty.", null)
    val parsed: dynamic =
        try {
            JSON.parse<Any?>(text)
        } catch (e: Throwable) {
            return ImportResult(false, "The file is not valid JSON: ${e.message}", null)
        }
    return try {
        ImportResult(true, "", stateFromJson(parsed), schemaOf(parsed))
    } catch (e: SchemaError) {
        ImportResult(false, "Invalid TaskPilot data: ${e.message}", null)
    }
}

/** True if [task] is (transitively) blocked by itself. */
private fun dependsOnAny(
    state: AppState,
    task: Task,
): Boolean = task.blockedBy.any { dependsOn(state, it, task.id) }

private fun notifications(root: dynamic): List<AppNotification> =
    optionalArray(root, "notifications", "root").mapIndexed { i, n ->
        val p = "notifications[$i]"
        requireObject(n, p)
        val type = oneOf(str(n, "type", p), NotificationType.all, "$p.type")
        val read = field(n, "read")
        if (typeOf(read) != "boolean") throw SchemaError("$p.read must be a boolean.")
        val id = str(n, "id", p)
        AppNotification(
            id,
            str(n, "userId", p),
            type,
            str(n, "taskId", p),
            str(n, "text", p),
            str(n, "at", p),
            read as Boolean,
            nullableStr(n, "key", p) ?: "$type:$id",
        )
    }
