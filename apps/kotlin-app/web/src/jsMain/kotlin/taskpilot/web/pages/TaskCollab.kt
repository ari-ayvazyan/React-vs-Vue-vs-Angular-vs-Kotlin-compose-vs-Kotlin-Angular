package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.browser.window
import org.jetbrains.compose.web.attributes.InputType
import org.jetbrains.compose.web.attributes.forId
import org.jetbrains.compose.web.attributes.placeholder
import org.jetbrains.compose.web.attributes.rows
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.H2
import org.jetbrains.compose.web.dom.H3
import org.jetbrains.compose.web.dom.Input
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Li
import org.jetbrains.compose.web.dom.Ol
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Section
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.dom.TextArea
import org.jetbrains.compose.web.dom.Ul
import org.w3c.dom.HTMLTextAreaElement
import taskpilot.ActivityEntry
import taskpilot.ActivityNames
import taskpilot.ActivityQuery
import taskpilot.ActivityType
import taskpilot.Member
import taskpilot.MentionQuery
import taskpilot.Status
import taskpilot.Task
import taskpilot.applyMention
import taskpilot.blockedTasksOf
import taskpilot.describeActivity
import taskpilot.filterActivity
import taskpilot.matchesSearch
import taskpilot.mentionCandidates
import taskpilot.mentionQueryAt
import taskpilot.parseMentions
import taskpilot.web.Store
import taskpilot.web.ui.Avatar
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconButton
import taskpilot.web.ui.IconView
import taskpilot.web.ui.Link
import taskpilot.web.ui.StatusBadge
import taskpilot.web.ui.formatDateTime

// ---------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------

/** "Blocked by" list with a searchable picker (combobox) plus the reverse "Blocks" list. */
@Composable
fun DependenciesCard(task: Task) {
    val all = Store.tasks
    val byId = remember(all) { all.associateBy { it.id } }
    val blockers = task.blockedBy.mapNotNull { byId[it] }
    val blocks = remember(all, task.id) { blockedTasksOf(task.id, all) }
    var query by remember(task.id) { mutableStateOf("") }
    var open by remember(task.id) { mutableStateOf(false) }
    var active by remember(task.id) { mutableStateOf(0) }
    var error by remember(task.id) { mutableStateOf<String?>(null) }
    val results =
        remember(all, query, task.blockedBy) {
            all
                .asSequence()
                .filter { it.id != task.id && it.id !in task.blockedBy && it.matchesSearch(query) }
                .sortedWith(compareBy<Task>({ it.status == Status.DONE }, { it.title.lowercase() }))
                .take(8)
                .toList()
        }

    fun choose(candidate: Task) {
        error = Store.addBlocker(task.id, candidate.id)
        if (error == null) {
            query = ""
            open = false
            Store.announce("\"${candidate.title}\" now blocks this task")
        }
    }
    val openCount = blockers.count { it.status != Status.DONE }

    Section({
        classes("card")
        attr("data-testid", "dependencies")
    }) {
        Div({ classes("card-head") }) {
            H2 { Text("Dependencies") }
            Span({ classes("muted") }) {
                Text(if (openCount > 0) "Blocked by $openCount open task${if (openCount == 1) "" else "s"}" else "Not blocked")
            }
        }
        H3({ classes("sub-head") }) { Text("Blocked by") }
        if (blockers.isEmpty()) {
            P({ classes("muted", "small") }) { Text("No blockers. This task can be completed at any time.") }
        } else {
            Ul({ classes("dep-list") }) {
                blockers.forEach { b ->
                    Li({
                        classes("dep-item")
                        attr("data-testid", "blocker-item")
                    }) {
                        StatusBadge(b)
                        Link("/tasks/${b.id}", "dep-title") { Text(b.title) }
                        IconButton(Icon.Close, "Remove blocker ${b.title}", testId = "blocker-remove", extraClass = "subtle") {
                            Store.removeBlocker(task.id, b.id)
                        }
                    }
                }
            }
        }
        Div({ classes("combo") }) {
            Label(forId = "blocker-search") { Text("Add a blocking task") }
            Input(InputType.Search) {
                id("blocker-search")
                attr("data-testid", "blocker-search")
                attr("role", "combobox")
                attr("aria-autocomplete", "list")
                attr("aria-expanded", (open && results.isNotEmpty()).toString())
                attr("aria-controls", "blocker-options")
                if (open && results.isNotEmpty()) attr("aria-activedescendant", "blocker-opt-${active.coerceIn(0, results.size - 1)}")
                attr("autocomplete", "off")
                placeholder("Search tasks by title, description or tag…")
                value(query)
                onInput {
                    query = it.value
                    open = true
                    active = 0
                    error = null
                }
                onFocus { open = true }
                onBlur { window.setTimeout({ open = false }, 150) }
                onKeyDown { e ->
                    when (e.key) {
                        "ArrowDown" -> {
                            e.preventDefault()
                            open = true
                            if (results.isNotEmpty()) active = (active + 1) % results.size
                        }
                        "ArrowUp" -> {
                            e.preventDefault()
                            if (results.isNotEmpty()) active = (active - 1 + results.size) % results.size
                        }
                        "Enter" -> {
                            e.preventDefault()
                            results.getOrNull(active)?.let { choose(it) }
                        }
                        "Escape" ->
                            if (open) {
                                e.preventDefault()
                                e.stopPropagation()
                                open = false
                            }
                    }
                }
            }
            if (open && results.isNotEmpty()) {
                Ul({
                    classes("combo-list")
                    id("blocker-options")
                    attr("role", "listbox")
                    attr("aria-label", "Matching tasks")
                }) {
                    results.forEachIndexed { i, r ->
                        Li({
                            classes("combo-option")
                            if (i == active) classes("active")
                            id("blocker-opt-$i")
                            attr("role", "option")
                            attr("aria-selected", (i == active).toString())
                            attr("data-testid", "blocker-option")
                            onMouseDown { e -> e.preventDefault() }
                            onMouseEnter { active = i }
                            onClick { choose(r) }
                        }) {
                            StatusBadge(r)
                            Span({ classes("combo-title") }) { Text(r.title) }
                        }
                    }
                }
            }
        }
        error?.let {
            P({
                classes("field-error")
                attr("role", "alert")
                attr("data-testid", "dependency-error")
            }) { Text(it) }
        }
        if (blocks.isNotEmpty()) {
            H3({ classes("sub-head") }) { Text("Blocks") }
            Ul({ classes("dep-list") }) {
                blocks.forEach { b ->
                    Li({ classes("dep-item") }) {
                        StatusBadge(b)
                        Link("/tasks/${b.id}", "dep-title") { Text(b.title) }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------------------------

@Composable
fun CommentBody(body: String) {
    Div({ classes("comment-body") }) {
        parseMentions(body, Store.members).forEach { seg ->
            val m = seg.member
            if (m == null) {
                Text(seg.text)
            } else {
                Span({
                    classes("mention")
                    attr("data-testid", "mention")
                    attr("title", m.name)
                    style { property("--mention-color", m.color) }
                }) { Text(seg.text) }
            }
        }
    }
}

/** Comment thread (oldest first, newest last) with an @-mention autocomplete composer. */
@Composable
fun CommentsCard(task: Task) {
    Section({
        classes("card")
        attr("data-testid", "comments")
    }) {
        Div({ classes("card-head") }) {
            H2 { Text("Comments") }
            Span({ classes("muted") }) { Text("${task.comments.size}") }
        }
        if (task.comments.isEmpty()) {
            P({ classes("muted", "small") }) { Text("No comments yet.") }
        } else {
            Ol({ classes("comment-list") }) {
                task.comments.forEach { c ->
                    val author = Store.member(c.authorId)
                    Li({
                        classes("comment")
                        attr("data-testid", "comment")
                    }) {
                        Avatar(author, "md")
                        Div({ classes("comment-main") }) {
                            Div({ classes("comment-meta") }) {
                                Span({ classes("comment-author") }) { Text(author?.name ?: "Former member") }
                                Span({ classes("muted", "small") }) { Text(formatDateTime(c.createdAt)) }
                            }
                            CommentBody(c.body)
                        }
                    }
                }
            }
        }
        CommentComposer(task.id)
    }
}

@Composable
private fun CommentComposer(taskId: String) {
    val me = Store.currentUser
    var text by remember(taskId) { mutableStateOf("") }
    var mention by remember(taskId) { mutableStateOf<MentionQuery?>(null) }
    var active by remember(taskId) { mutableStateOf(0) }
    var error by remember(taskId) { mutableStateOf<String?>(null) }
    val holder = remember { arrayOfNulls<HTMLTextAreaElement>(1) }
    val candidates = mention?.let { mentionCandidates(it.query, Store.members) }.orEmpty()

    fun refreshMention() {
        val el = holder[0] ?: return
        mention = mentionQueryAt(el.value, el.selectionStart ?: el.value.length)
        active = 0
    }

    fun pick(m: Member) {
        val q = mention ?: return
        val el = holder[0] ?: return
        val (next, caret) = applyMention(text, q, m, el.selectionStart ?: text.length)
        text = next
        mention = null
        window.setTimeout({
            holder[0]?.let {
                it.focus()
                it.setSelectionRange(caret, caret)
            }
        }, 0)
    }

    fun submit() {
        error = Store.addComment(taskId, text)
        if (error == null) {
            text = ""
            mention = null
        }
    }

    if (me == null) {
        P({ classes("muted", "small", "composer-hint") }) {
            Text("Choose a current user in ")
            Link("/settings") { Text("Settings") }
            Text(" to comment.")
        }
        return
    }
    Div({ classes("composer") }) {
        Avatar(me, "md")
        Div({ classes("composer-main", "combo") }) {
            Div({ classes("combo-anchor") }) {
                Label(forId = "comment-input", attrs = { classes("sr-only") }) { Text("Add a comment as ${me.name}") }
                TextArea(text) {
                    id("comment-input")
                    attr("data-testid", "comment-input")
                    rows(3)
                    placeholder("Comment as ${me.name}… Type @ to mention someone. Ctrl+Enter to send.")
                    attr("role", "combobox")
                    attr("aria-autocomplete", "list")
                    attr("aria-expanded", (candidates.isNotEmpty()).toString())
                    attr("aria-controls", "mention-options")
                    if (candidates.isNotEmpty()) attr("aria-activedescendant", "mention-opt-${active.coerceIn(0, candidates.size - 1)}")
                    if (error != null) {
                        attr("aria-invalid", "true")
                        attr("aria-describedby", "comment-error")
                    }
                    ref { el ->
                        holder[0] = el
                        onDispose { holder[0] = null }
                    }
                    onInput {
                        text = it.value
                        error = null
                        refreshMention()
                    }
                    onClick { refreshMention() }
                    onKeyUp { e ->
                        if (e.key == "ArrowLeft" || e.key == "ArrowRight" || e.key == "Home" ||
                            e.key == "End"
                        ) {
                            refreshMention()
                        }
                    }
                    onBlur { window.setTimeout({ mention = null }, 150) }
                    onKeyDown { e ->
                        if (candidates.isNotEmpty()) {
                            when (e.key) {
                                "ArrowDown" -> {
                                    e.preventDefault()
                                    active = (active + 1) % candidates.size
                                    return@onKeyDown
                                }
                                "ArrowUp" -> {
                                    e.preventDefault()
                                    active = (active - 1 + candidates.size) % candidates.size
                                    return@onKeyDown
                                }
                                "Enter", "Tab" -> {
                                    e.preventDefault()
                                    pick(candidates[active.coerceIn(0, candidates.size - 1)])
                                    return@onKeyDown
                                }
                                "Escape" -> {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    mention = null
                                    return@onKeyDown
                                }
                            }
                        }
                        if (e.key == "Enter" && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault()
                            submit()
                        }
                    }
                }
                if (candidates.isNotEmpty()) {
                    Ul({
                        classes("combo-list", "mention-list")
                        id("mention-options")
                        attr("role", "listbox")
                        attr("aria-label", "Members")
                    }) {
                        candidates.forEachIndexed { i, m ->
                            Li({
                                classes("combo-option")
                                if (i == active) classes("active")
                                id("mention-opt-$i")
                                attr("role", "option")
                                attr("aria-selected", (i == active).toString())
                                attr("data-testid", "mention-option")
                                onMouseDown { e -> e.preventDefault() }
                                onMouseEnter { active = i }
                                onClick { pick(m) }
                            }) {
                                Avatar(m, showTitle = false)
                                Span { Text(m.name) }
                            }
                        }
                    }
                }
            }
            error?.let {
                P({
                    classes("field-error")
                    id("comment-error")
                    attr("role", "alert")
                }) { Text(it) }
            }
            Div({ classes("composer-actions") }) {
                Span({ classes("muted", "small") }) { Text("${text.length}/${taskpilot.COMMENT_MAX}") }
                Button({
                    classes("btn", "btn-primary", "btn-sm")
                    attr("type", "button")
                    attr("data-testid", "comment-submit")
                    onClick { submit() }
                }) {
                    IconView(Icon.Message, 14)
                    Text("Comment")
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------------------------

/**
 * Resolves ids in activity entries against the current state; titles of deleted tasks are
 * recovered from the log's own "deleted" entries.
 */
fun activityNames(log: List<ActivityEntry>): ActivityNames {
    val deleted = log.filter { it.type == ActivityType.DELETED && it.from != null }.associate { it.taskId to it.from!! }
    return object : ActivityNames {
        override fun task(id: String) = Store.task(id)?.title ?: deleted[id]?.let { "$it (deleted)" }

        override fun member(id: String?) = Store.member(id)?.name

        override fun project(id: String?) = Store.project(id)?.name

        override fun status(taskId: String, statusId: String?): String? {
            if (statusId == null) return null
            val wf = Store.workflowFor(Store.task(taskId)?.projectId)
            return wf.firstOrNull { it.id == statusId }?.name
                ?: Store.projects.firstNotNullOfOrNull { p -> p.workflow?.firstOrNull { it.id == statusId }?.name }
        }
    }
}

/** One activity line: actor avatar, actor name, description, optional task link, time. */
@Composable
fun ActivityItem(e: ActivityEntry, showTask: Boolean, names: ActivityNames) {
    val actor = Store.member(e.actorId)
    Li({
        classes("activity-item", "act-${e.type.key}")
        attr("data-testid", "activity-item")
    }) {
        Avatar(actor)
        Div({ classes("activity-main") }) {
            Div({ classes("activity-text") }) {
                Span({ classes("activity-actor") }) { Text(actor?.name ?: if (e.actorId == null) "Someone" else "Former member") }
                Text(" ")
                Text(describeActivity(e, names))
                if (showTask) {
                    Text(" · ")
                    val title = Store.task(e.taskId)?.title
                    if (title != null) {
                        Link("/tasks/${e.taskId}", "activity-task") { Text(title) }
                    } else {
                        Span({ classes("muted") }) { Text(names.task(e.taskId) ?: e.from ?: e.to ?: "deleted task") }
                    }
                }
            }
            Span({ classes("muted", "small") }) { Text(formatDateTime(e.at)) }
        }
    }
}

private const val TIMELINE_STEP = 20

/** Per-task activity timeline (newest first) with "show more". */
@Composable
fun TaskActivityCard(task: Task) {
    val entries = remember(Store.activity, task.id) { filterActivity(Store.activity, ActivityQuery(), task.id) }
    var limit by remember(task.id) { mutableStateOf(TIMELINE_STEP) }
    Section({
        classes("card")
        attr("data-testid", "task-activity")
    }) {
        Div({ classes("card-head") }) {
            H2 { Text("Activity") }
            Link("/activity", "see-all") { Text("All activity →") }
        }
        if (entries.isEmpty()) {
            P({ classes("muted", "small") }) { Text("No recorded changes yet. Edits, comments and status changes will appear here.") }
        } else {
            val names = remember(Store.activity, Store.tasks) { activityNames(Store.activity) }
            Ol({ classes("timeline") }) { entries.take(limit).forEach { ActivityItem(it, showTask = false, names) } }
            if (entries.size > limit) {
                Button({
                    classes("btn", "btn-ghost", "btn-sm")
                    attr("type", "button")
                    onClick { limit += TIMELINE_STEP }
                }) { Text("Show ${minOf(TIMELINE_STEP, entries.size - limit)} more") }
            }
        }
    }
}
