package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import org.jetbrains.compose.web.attributes.InputType
import org.jetbrains.compose.web.attributes.forId
import org.jetbrains.compose.web.attributes.onSubmit
import org.jetbrains.compose.web.attributes.placeholder
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.Form
import org.jetbrains.compose.web.dom.Input
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Li
import org.jetbrains.compose.web.dom.Ol
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import taskpilot.Project
import taskpilot.Status
import taskpilot.WORKFLOW_NAME_MAX
import taskpilot.WorkflowStatus
import taskpilot.effectiveWorkflow
import taskpilot.newStatusId
import taskpilot.projectsUsingWorkflowOf
import taskpilot.web.Store
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconButton
import taskpilot.web.ui.IconView
import taskpilot.web.ui.Modal
import taskpilot.web.ui.ModalHeader
import taskpilot.web.ui.SelectField
import taskpilot.workflowOwner

private val CATEGORY_OPTIONS = Status.entries.map { it.key to "Category: ${it.label}" }

/** Compact chips of the effective workflow plus where it comes from. */
@Composable
fun WorkflowSummary(project: Project) {
    val workflow = effectiveWorkflow(Store.projects, project.id)
    val owner = workflowOwner(Store.projects, project.id)
    Div({
        classes("workflow-summary")
        attr("data-testid", "workflow-summary")
    }) {
        Span({ classes("muted", "small") }) {
            Text(
                when {
                    owner?.id == project.id -> "Custom workflow:"
                    owner != null -> "Inherits from ${owner.name}:"
                    else -> "Default workflow:"
                },
            )
        }
        workflow.forEach { s ->
            Span({
                classes("wf-chip")
                style { property("--status-color", s.color) }
                attr("title", "${s.name} (${s.category.label})")
            }) { Text(s.name) }
        }
    }
}

/** Editor for a project's workflow: customise/inherit, add, rename, recolour, recategorise, reorder, delete. */
@Composable
fun WorkflowEditor(project: Project) {
    var error by remember(project.id) { mutableStateOf<String?>(null) }
    var deleting by remember(project.id) { mutableStateOf<WorkflowStatus?>(null) }
    val parent = project.parentId?.let { Store.project(it) }
    Div({
        classes("workflow-editor")
        attr("data-testid", "workflow-editor")
    }) {
        val own = project.workflow
        if (own == null) {
            val owner = workflowOwner(Store.projects, project.id)
            P({ classes("small") }) {
                Text(
                    if (owner != null) {
                        "This project inherits the workflow of \"${owner.name}\". Changes there apply here too."
                    } else {
                        "This project uses the default workflow."
                    },
                )
            }
            Button({
                classes("btn", "btn-sm")
                attr("type", "button")
                attr("data-testid", "workflow-customize")
                onClick { Store.customizeWorkflow(project.id) }
            }) {
                IconView(Icon.Edit, 14)
                Text("Customize workflow")
            }
            return@Div
        }
        val usedBy = projectsUsingWorkflowOf(Store.projects, project.id).size
        if (usedBy >
            1
        ) {
            P(
                { classes("muted", "small") },
            ) { Text("Also used by ${usedBy - 1} sub-project${if (usedBy == 2) "" else "s"} that inherit it.") }
        }
        Ol({ classes("wf-list") }) {
            own.forEachIndexed { i, s ->
                // Keyed by status id so reordering keeps each row's (uncontrolled) name input with its status.
                key(s.id) {
                    Li({
                        classes("wf-row")
                        attr("data-testid", "workflow-status")
                        attr("data-status-id", s.id)
                    }) {
                        Label(forId = "wf-color-${project.id}-${s.id}", attrs = { classes("swatch-label") }) {
                            Span({ classes("sr-only") }) { Text("Colour of ${s.name}") }
                            Input(InputType.Color) {
                                id("wf-color-${project.id}-${s.id}")
                                classes("color-swatch")
                                value(s.color)
                                onChange { e ->
                                    val c = e.value
                                    if (c !=
                                        s.color
                                    ) {
                                        error =
                                            Store.editWorkflow(project.id) { wf ->
                                                wf.map {
                                                    if (it.id ==
                                                        s.id
                                                    ) {
                                                        it.copy(color = c)
                                                    } else {
                                                        it
                                                    }
                                                }
                                            }
                                    }
                                }
                            }
                        }
                        Label(forId = "wf-name-${project.id}-${s.id}", attrs = { classes("sr-only") }) { Text("Name of status ${i + 1}") }
                        Input(InputType.Text) {
                            id("wf-name-${project.id}-${s.id}")
                            classes("wf-name")
                            attr("data-testid", "workflow-status-name")
                            attr("maxlength", WORKFLOW_NAME_MAX.toString())
                            defaultValue(s.name)
                            onChange { e ->
                                val n = e.value.trim()
                                if (n != s.name) {
                                    error = Store.editWorkflow(project.id) { wf -> wf.map { if (it.id == s.id) it.copy(name = n) else it } }
                                    if (error != null) (e.target as? org.w3c.dom.HTMLInputElement)?.value = s.name
                                }
                            }
                            onKeyDown { if (it.key == "Enter") (it.target as? org.w3c.dom.HTMLInputElement)?.blur() }
                        }
                        SelectField(s.category.key, CATEGORY_OPTIONS, { v ->
                            Status.fromKey(v)?.let { c ->
                                error = Store.editWorkflow(project.id) { wf -> wf.map { if (it.id == s.id) it.copy(category = c) else it } }
                            }
                        }) {
                            attr("aria-label", "Category of ${s.name}")
                            attr("data-testid", "workflow-status-category")
                        }
                        IconButton(Icon.ChevronUp, "Move ${s.name} up", testId = "workflow-status-up", extraClass = "subtle") {
                            if (i > 0) error = Store.editWorkflow(project.id) { wf -> wf.toMutableList().apply { add(i - 1, removeAt(i)) } }
                        }
                        IconButton(Icon.ChevronDown, "Move ${s.name} down", testId = "workflow-status-down", extraClass = "subtle") {
                            if (i <
                                own.size - 1
                            ) {
                                error =
                                    Store.editWorkflow(project.id) { wf -> wf.toMutableList().apply { add(i + 1, removeAt(i)) } }
                            }
                        }
                        IconButton(Icon.Trash, "Delete status ${s.name}", testId = "workflow-status-delete", extraClass = "subtle") {
                            val others = own.filter { it.id != s.id }
                            error =
                                if (others.none { it.category == s.category }) {
                                    "\"${s.name}\" is the only ${s.category.label} status. Each category needs at least one status."
                                } else {
                                    deleting = s
                                    null
                                }
                        }
                    }
                }
            }
        }
        AddStatusForm(project.id) { error = it }
        error?.let {
            P({
                classes("field-error")
                attr("role", "alert")
                attr("data-testid", "workflow-error")
            }) { Text(it) }
        }
        Button({
            classes("btn", "btn-sm", "btn-ghost")
            attr("type", "button")
            attr("data-testid", "workflow-inherit")
            onClick { Store.inheritWorkflow(project.id) }
        }) {
            IconView(Icon.Reset, 14)
            Text(if (parent != null) "Use the parent's workflow" else "Use the default workflow")
        }
    }
    deleting?.let { s -> DeleteStatusDialog(project, s) { deleting = null } }
}

@Composable
private fun AddStatusForm(projectId: String, onError: (String?) -> Unit) {
    var name by remember(projectId) { mutableStateOf("") }
    var category by remember(projectId) { mutableStateOf(Status.IN_PROGRESS) }
    var color by remember(projectId) { mutableStateOf("#0ea5e9") }
    Form(attrs = {
        classes("wf-add")
        onSubmit { e ->
            e.preventDefault()
            val n = name.trim()
            if (n.isEmpty()) {
                onError("Enter a name for the new status.")
                return@onSubmit
            }
            // Insert after the last status of the same category, keeping categories grouped.
            val err =
                Store.editWorkflow(projectId) { wf ->
                    val idx = wf.indexOfLast { it.category == category }.let { if (it < 0) wf.size else it + 1 }
                    wf.toMutableList().apply { add(idx, WorkflowStatus(newStatusId(n, wf), n, color, category)) }
                }
            onError(err)
            if (err == null) name = ""
        }
    }) {
        Label(forId = "wf-add-name-$projectId", attrs = { classes("sr-only") }) { Text("New status name") }
        Input(InputType.Text) {
            id("wf-add-name-$projectId")
            attr("data-testid", "workflow-add-name")
            attr("maxlength", WORKFLOW_NAME_MAX.toString())
            placeholder("New status, e.g. Review")
            value(name)
            onInput { name = it.value }
        }
        SelectField(category.key, CATEGORY_OPTIONS, { v -> Status.fromKey(v)?.let { category = it } }) {
            attr("aria-label", "Category of the new status")
            attr("data-testid", "workflow-add-category")
        }
        Label(forId = "wf-add-color-$projectId", attrs = { classes("sr-only") }) { Text("Colour of the new status") }
        Input(InputType.Color) {
            id("wf-add-color-$projectId")
            classes("color-swatch")
            value(color)
            onInput { color = it.value }
        }
        Button({
            classes("btn", "btn-sm")
            attr("type", "submit")
            attr("data-testid", "workflow-add-status")
        }) {
            IconView(Icon.Plus, 14)
            Text("Add status")
        }
    }
}

@Composable
private fun DeleteStatusDialog(project: Project, status: WorkflowStatus, close: () -> Unit) {
    val others = project.workflow.orEmpty().filter { it.id != status.id }
    var target by remember(status.id) { mutableStateOf((others.firstOrNull { it.category == status.category } ?: others.first()).id) }
    var error by remember { mutableStateOf<String?>(null) }
    val users = projectsUsingWorkflowOf(Store.projects, project.id)
    val count = Store.tasks.count { it.projectId in users && it.statusId == status.id }
    Modal("delete-status-title", close, testId = "delete-status-modal") {
        ModalHeader("delete-status-title", "Delete status \"${status.name}\"?", close)
        Div({ classes("modal-body") }) {
            P {
                Text(
                    if (count == 0) {
                        "No tasks use this status."
                    } else {
                        "$count task${if (count == 1) "" else "s"} use this status. Move them to:"
                    },
                )
            }
            Div({ classes("field") }) {
                Label(forId = "delete-status-target") { Text("Move tasks to") }
                SelectField(target, others.map { it.id to "${it.name} (${it.category.label})" }, { target = it }) {
                    id("delete-status-target")
                    attr("data-testid", "delete-status-target")
                }
            }
            error?.let { P({ classes("field-error") }) { Text(it) } }
            Div({ classes("form-actions") }) {
                Button({
                    classes("btn", "btn-ghost")
                    attr("type", "button")
                    onClick { close() }
                }) { Text("Cancel") }
                Button({
                    classes("btn", "btn-danger")
                    attr("type", "button")
                    attr("data-testid", "delete-status-confirm")
                    onClick {
                        error = Store.deleteWorkflowStatus(project.id, status.id, target)
                        if (error == null) {
                            Store.toast("Status \"${status.name}\" deleted", actionLabel = "Undo") { Store.undo() }
                            close()
                        }
                    }
                }) { Text("Delete status") }
            }
        }
    }
}
