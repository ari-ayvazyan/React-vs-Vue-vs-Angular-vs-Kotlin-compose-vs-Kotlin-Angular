package taskpilot.web.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import org.jetbrains.compose.web.attributes.InputType
import org.jetbrains.compose.web.attributes.forId
import org.jetbrains.compose.web.attributes.onSubmit
import org.jetbrains.compose.web.attributes.placeholder
import org.jetbrains.compose.web.attributes.rows
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.Form
import org.jetbrains.compose.web.dom.Input
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.dom.TextArea
import taskpilot.DraftResult
import taskpilot.Limits
import taskpilot.Priority
import taskpilot.Recurrence
import taskpilot.Status
import taskpilot.Task
import taskpilot.TaskDraft
import taskpilot.ValidatedDraft
import taskpilot.parseTags
import taskpilot.validateDraft
import taskpilot.web.Router
import taskpilot.web.Store
import taskpilot.web.TaskFields

class TaskFormResult(val draft: ValidatedDraft, val fields: TaskFields)

private var formSeq = 0

/** Create/edit form used by both the modal and the task detail page. */
@Composable
fun TaskForm(
    initial: Task?,
    submitLabel: String,
    onSave: (TaskFormResult) -> Unit,
    onCancel: (() -> Unit)? = null,
) {
    val prefix = remember { "tf${++formSeq}" }
    // Keyed on the editable fields so external changes (undo, board moves) refresh the form,
    // while unrelated updates such as pomodoro time logging do not discard in-progress edits.
    val initialDraft = initial?.let { TaskDraft.from(it) } ?: TaskDraft()
    var draft by remember(initial?.id, initialDraft) { mutableStateOf(initialDraft) }
    var submitted by remember(initial?.id, initialDraft) { mutableStateOf(false) }

    // Completing a task with open blockers is rejected inline (the store enforces it everywhere else).
    fun statusError(): String? {
        if (initial == null || initial.id.isEmpty() || draft.status != Status.DONE || initial.status == Status.DONE) return null
        val blockers = Store.openBlockersOf(initial.id)
        if (blockers.isEmpty()) return null
        return "Can't mark as done while blocked by " + blockers.joinToString(", ") { "\"${it.title}\"" } + "."
    }
    val errors =
        if (submitted) {
            (validateDraft(draft) as? DraftResult.Invalid)?.errors.orEmpty() + listOfNotNull(statusError()?.let { "status" to it })
        } else {
            emptyMap()
        }

    Form(attrs = {
        classes("task-form")
        attr("novalidate", "")
        onSubmit { e ->
            e.preventDefault()
            submitted = true
            val blocked = statusError()
            when (val r = validateDraft(draft)) {
                is DraftResult.Ok if blocked != null ->
                    (kotlinx.browser.document.getElementById("$prefix-status") as? org.w3c.dom.HTMLElement)?.focus()
                is DraftResult.Ok ->
                    onSave(
                        TaskFormResult(
                            r.value,
                            TaskFields(draft.status, draft.statusId, draft.priority, draft.projectId, draft.assigneeId, draft.recurrence),
                        ),
                    )
                is DraftResult.Invalid -> {
                    val first = r.errors.keys.first()
                    (kotlinx.browser.document.getElementById("$prefix-$first") as? org.w3c.dom.HTMLElement)?.focus()
                }
            }
        }
    }) {
        FieldBox("$prefix-title", "Title", errors["title"], counter = "${draft.title.trim().length}/${Limits.TITLE_MAX}") {
            Input(InputType.Text) {
                id("$prefix-title")
                attr("data-testid", "task-title-input")
                attr("data-autofocus", "")
                attr("autocomplete", "off")
                placeholder("What needs to be done?")
                value(draft.title)
                ariaError("$prefix-title", errors["title"])
                onInput { draft = draft.copy(title = it.value) }
            }
        }
        FieldBox(
            "$prefix-description",
            "Description",
            errors["description"],
            counter = "${draft.description.length}/${Limits.DESCRIPTION_MAX}",
        ) {
            TextArea(draft.description) {
                id("$prefix-description")
                rows(4)
                placeholder("Add more detail (optional)")
                ariaError("$prefix-description", errors["description"])
                onInput { draft = draft.copy(description = it.value) }
            }
        }
        Div({ classes("form-grid") }) {
            FieldBox("$prefix-status", "Status", errors["status"]) {
                // Statuses of the selected project's workflow (inherited or custom).
                val workflow = Store.workflowFor(draft.projectId)
                val current = workflow.firstOrNull { it.id == draft.statusId } ?: workflow.first { it.category == draft.status }
                SelectField(current.id, workflow.map { it.id to it.name }, { v ->
                    workflow.firstOrNull { it.id == v }?.let { draft = draft.copy(status = it.category, statusId = it.id) }
                }) {
                    id("$prefix-status")
                    attr("data-testid", "task-status-select")
                }
            }
            FieldBox("$prefix-priority", "Priority", null) {
                SelectField(draft.priority.key, Priority.entries.map { it.key to it.label }, { v ->
                    Priority.fromKey(v)?.let { draft = draft.copy(priority = it) }
                }) { id("$prefix-priority") }
            }
            FieldBox("$prefix-project", "Project", null) {
                SelectField(
                    draft.projectId ?: "",
                    listOf("" to "No project") + projectOptions(),
                    { v ->
                        // Keep the status if the new workflow has it, otherwise the first one of the same category.
                        val pid = v.ifEmpty { null }
                        val wf = Store.workflowFor(pid)
                        val ws = wf.firstOrNull { it.id == draft.statusId } ?: wf.first { it.category == draft.status }
                        draft = draft.copy(projectId = pid, statusId = ws.id, status = ws.category)
                    },
                ) { id("$prefix-project") }
            }
            FieldBox("$prefix-assignee", "Assignee", null) {
                SelectField(
                    draft.assigneeId ?: "",
                    listOf("" to "Unassigned") + Store.members.map { it.id to it.name },
                    { v -> draft = draft.copy(assigneeId = v.ifEmpty { null }) },
                ) {
                    id("$prefix-assignee")
                    attr("data-testid", "task-assignee-select")
                }
            }
            FieldBox("$prefix-recurrence", "Repeat", null) {
                SelectField(draft.recurrence.key, Recurrence.entries.map { it.key to it.label }, { v ->
                    Recurrence.fromKey(v)?.let { draft = draft.copy(recurrence = it) }
                }) {
                    id("$prefix-recurrence")
                    attr("data-testid", "task-recurrence-select")
                }
            }
            FieldBox("$prefix-dueDate", "Due date", errors["dueDate"]) {
                Input(InputType.Date) {
                    id("$prefix-dueDate")
                    value(draft.dueDate)
                    ariaError("$prefix-dueDate", errors["dueDate"])
                    onInput { draft = draft.copy(dueDate = it.value) }
                }
            }
            FieldBox("$prefix-estimate", "Estimate (minutes)", errors["estimate"]) {
                Input(InputType.Text) {
                    id("$prefix-estimate")
                    attr("inputmode", "numeric")
                    placeholder("e.g. 45")
                    value(draft.estimateText)
                    ariaError("$prefix-estimate", errors["estimate"])
                    onInput { draft = draft.copy(estimateText = it.value) }
                }
            }
            FieldBox("$prefix-tags", "Tags", errors["tags"], counter = "${parseTags(draft.tagsText).size}/${Limits.TAGS_MAX}") {
                Input(InputType.Text) {
                    id("$prefix-tags")
                    placeholder("comma separated, e.g. bug, frontend")
                    attr("autocomplete", "off")
                    value(draft.tagsText)
                    ariaError("$prefix-tags", errors["tags"])
                    onInput { draft = draft.copy(tagsText = it.value) }
                }
            }
        }
        Div({ classes("form-actions") }) {
            if (onCancel != null) {
                Button({
                    classes("btn", "btn-ghost")
                    attr("type", "button")
                    onClick { onCancel() }
                }) { Text("Cancel") }
            }
            Button({
                classes("btn", "btn-primary")
                attr("type", "submit")
                attr("data-testid", "task-save-button")
            }) { Text(submitLabel) }
        }
    }
}

private fun org.jetbrains.compose.web.attributes.AttrsScope<*>.ariaError(id: String, error: String?) {
    if (error != null) {
        attr("aria-invalid", "true")
        attr("aria-describedby", "$id-error")
    } else {
        attr("aria-invalid", "false")
    }
}

@Composable
fun FieldBox(id: String, label: String, error: String?, counter: String? = null, content: @Composable () -> Unit) {
    Div({
        classes("field")
        if (error != null) classes("has-error")
    }) {
        Div({ classes("field-label-row") }) {
            Label(forId = id) { Text(label) }
            if (counter != null) Span({ classes("counter") }) { Text(counter) }
        }
        content()
        if (error != null) {
            Div({
                classes("field-error")
                id("$id-error")
                attr("role", "alert")
            }) { Text(error) }
        }
    }
}

/** Global create/edit modal (opened with `n`, the top-bar button, or edit actions). */
@Composable
fun TaskModal() {
    val request = Store.taskModal ?: return
    val existing = request.taskId?.let { Store.task(it) }
    val close = { Store.taskModal = null }
    Modal(titleId = "task-modal-title", onClose = close, testId = "task-modal", wide = true) {
        ModalHeader("task-modal-title", if (existing != null) "Edit task" else "New task", close)
        Div({ classes("modal-body") }) {
            TaskForm(
                initial = existing ?: request.defaults,
                submitLabel = if (existing != null) "Save changes" else "Create task",
                onCancel = close,
                onSave = { r ->
                    if (existing != null) {
                        Store.saveTask(existing.id, r.draft, r.fields)
                        Store.toast("Task updated", tone = "success")
                    } else {
                        val t = Store.createTask(r.draft, r.fields)
                        Store.toast("Task created", actionLabel = "Open", tone = "success") { Router.navigate("/tasks/${t.id}") }
                    }
                    close()
                },
            )
        }
    }
}
