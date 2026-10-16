package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import org.jetbrains.compose.web.attributes.InputType
import org.jetbrains.compose.web.attributes.forId
import org.jetbrains.compose.web.attributes.name
import org.jetbrains.compose.web.attributes.onSubmit
import org.jetbrains.compose.web.attributes.placeholder
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.Fieldset
import org.jetbrains.compose.web.dom.Form
import org.jetbrains.compose.web.dom.H1
import org.jetbrains.compose.web.dom.H2
import org.jetbrains.compose.web.dom.Input
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Legend
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Section
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import taskpilot.Demo
import taskpilot.Project
import taskpilot.ProjectNode
import taskpilot.ProjectProgress
import taskpilot.SubProjectAction
import taskpilot.descendantIds
import taskpilot.projectProgressWithDescendants
import taskpilot.projectTree
import taskpilot.web.Store
import taskpilot.web.ui.EmptyState
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconButton
import taskpilot.web.ui.IconView
import taskpilot.web.ui.Link
import taskpilot.web.ui.Modal
import taskpilot.web.ui.ModalHeader
import taskpilot.web.ui.SelectField
import taskpilot.web.ui.projectOptions

private const val NAME_MAX = 60

private fun nameError(name: String, editingId: String? = null): String? {
    val n = name.trim()
    return when {
        n.isEmpty() -> "Project name is required."
        n.length > NAME_MAX -> "Name must be at most $NAME_MAX characters."
        Store.projects.any { it.id != editingId && it.name.equals(n, ignoreCase = true) } -> "A project with this name already exists."
        else -> null
    }
}

/** `/projects`: project tree with progress (including sub-projects), parents and workflows. */
@Composable
fun ProjectsPage() {
    val projects = Store.projects
    val tasks = Store.tasks
    val tree = remember(projects) { projectTree(projects) }
    val progress = remember(tasks, projects) { projectProgressWithDescendants(tasks, projects).associateBy { it.project.id } }
    var deleting by remember { mutableStateOf<Project?>(null) }
    var newParent by remember { mutableStateOf<String?>(null) }
    val unassigned = tasks.count { it.projectId == null }

    Div({ classes("page-header") }) {
        Div {
            H1 { Text("Projects") }
            P({ classes("subtitle") }) { Text("${projects.size} projects · $unassigned tasks without a project") }
        }
    }
    NewProjectForm(newParent) { newParent = it }
    if (tree.isEmpty()) {
        EmptyState("No projects", "Create a project to group related tasks.")
    }
    Div({
        classes("project-tree")
        attr("role", "list")
        attr("data-testid", "project-tree")
    }) {
        tree.forEach { node ->
            val p = progress[node.project.id] ?: ProjectProgress(node.project, 0, 0)
            val own = tasks.count { it.projectId == node.project.id }
            ProjectCard(node, p, own, onAddChild = { newParent = node.project.id }) { deleting = node.project }
        }
    }
    deleting?.let { p ->
        DeleteProjectDialog(p) { deleting = null }
    }
}

@Composable
private fun NewProjectForm(parentId: String?, onParentChange: (String?) -> Unit) {
    var name by remember { mutableStateOf("") }
    var color by remember { mutableStateOf(Demo.PROJECT_COLORS[Store.projects.size % Demo.PROJECT_COLORS.size]) }
    var error by remember { mutableStateOf<String?>(null) }
    Section({
        classes("card")
        id("new-project")
    }) {
        Div({ classes("card-head") }) { H2 { Text(if (parentId == null) "New project" else "New sub-project") } }
        Form(attrs = {
            classes("inline-form")
            attr("novalidate", "")
            onSubmit { e ->
                e.preventDefault()
                error = nameError(name)
                if (error == null) {
                    val p = Store.createProject(name, color, parentId)
                    Store.toast("Project \"${p.name}\" created", tone = "success")
                    name = ""
                    color = Demo.PROJECT_COLORS[Store.projects.size % Demo.PROJECT_COLORS.size]
                }
            }
        }) {
            Div({ classes("field", "grow") }) {
                Label(forId = "new-project-name") { Text("Name") }
                Input(InputType.Text) {
                    id("new-project-name")
                    attr("data-testid", "project-name-input")
                    placeholder("e.g. Q3 Launch")
                    value(name)
                    if (error != null) {
                        attr("aria-invalid", "true")
                        attr("aria-describedby", "new-project-error")
                    }
                    onInput {
                        name = it.value
                        error = null
                    }
                }
            }
            Div({ classes("field") }) {
                Label(forId = "new-project-parent") { Text("Parent") }
                SelectField(
                    parentId ?: "",
                    listOf("" to "None (top level)") + projectOptions(),
                    { v -> onParentChange(v.ifEmpty { null }) },
                ) {
                    id("new-project-parent")
                    attr("data-testid", "project-parent-select")
                }
            }
            Div({ classes("field") }) {
                Label(forId = "new-project-color") { Text("Colour") }
                Input(InputType.Color) {
                    id("new-project-color")
                    classes("color-input")
                    value(color)
                    onInput { color = it.value }
                }
            }
            Button({
                classes("btn", "btn-primary")
                attr("type", "submit")
                attr("data-testid", "project-create")
            }) {
                IconView(Icon.Plus, 16)
                Text("Add project")
            }
        }
        error?.let {
            P({
                classes("field-error")
                id("new-project-error")
                attr("role", "alert")
            }) { Text(it) }
        }
    }
}

@Composable
private fun ProjectCard(node: ProjectNode, p: ProjectProgress, ownTasks: Int, onAddChild: () -> Unit, onDelete: () -> Unit) {
    val project = node.project
    var editing by remember(project.id) { mutableStateOf(false) }
    var showWorkflow by remember(project.id) { mutableStateOf(false) }
    var name by remember(project.id, editing) { mutableStateOf(project.name) }
    var error by remember(project.id, editing) { mutableStateOf<String?>(null) }
    val childCount = Store.projects.count { it.parentId == project.id }
    Section({
        classes("card", "project-card")
        attr("role", "listitem")
        attr("data-testid", "project-card")
        attr("data-project-id", project.id)
        attr("aria-level", (node.depth + 1).toString())
        style {
            property("--project-color", project.color)
            property("--depth", node.depth.toString())
        }
    }) {
        Div({ classes("project-head") }) {
            if (node.depth > 0) Span({ classes("tree-elbow") }) { Text("↳") }
            Label(forId = "color-${project.id}", attrs = { classes("swatch-label") }) {
                Span({ classes("sr-only") }) { Text("Colour for ${project.name}") }
                Input(InputType.Color) {
                    id("color-${project.id}")
                    classes("color-swatch")
                    value(project.color)
                    onChange { e ->
                        val c = e.value
                        if (c != project.color) Store.updateProject(project.id) { it.copy(color = c) }
                    }
                }
            }
            if (editing) {
                Form(attrs = {
                    classes("rename-form")
                    onSubmit { e ->
                        e.preventDefault()
                        error = nameError(name, project.id)
                        if (error == null) {
                            val n = name.trim()
                            if (n != project.name) Store.updateProject(project.id) { it.copy(name = n) }
                            editing = false
                        }
                    }
                }) {
                    Label(forId = "rename-${project.id}", attrs = { classes("sr-only") }) { Text("Project name") }
                    Input(InputType.Text) {
                        id("rename-${project.id}")
                        value(name)
                        ref { el ->
                            el.focus()
                            el.select()
                            onDispose { }
                        }
                        onInput { name = it.value }
                        onKeyDown { if (it.key == "Escape") editing = false }
                    }
                    Button({
                        classes("btn", "btn-sm", "btn-primary")
                        attr("type", "submit")
                    }) { Text("Save") }
                    Button({
                        classes("btn", "btn-sm", "btn-ghost")
                        attr("type", "button")
                        onClick { editing = false }
                    }) { Text("Cancel") }
                }
            } else {
                H2({ classes("project-name") }) {
                    Link("/tasks?project=${project.id}") { Text(project.name) }
                }
                Div({ classes("project-actions") }) {
                    IconButton(Icon.Plus, "Add sub-project to ${project.name}", testId = "project-add-child", extraClass = "subtle") {
                        onAddChild()
                        kotlinx.browser.document
                            .getElementById("new-project-name")
                            ?.let { (it as org.w3c.dom.HTMLElement).focus() }
                    }
                    IconButton(Icon.Edit, "Rename ${project.name}", extraClass = "subtle") { editing = true }
                    IconButton(Icon.Trash, "Delete ${project.name}", testId = "project-delete", extraClass = "subtle") { onDelete() }
                }
            }
        }
        error?.let { P({ classes("field-error") }) { Text(it) } }
        Div({ classes("project-meta-row") }) {
            Div({ classes("field", "parent-field") }) {
                Label(forId = "parent-${project.id}") { Text("Parent") }
                val options = projectOptions().filter { (id, _) -> id !in descendantIds(Store.projects, project.id) }
                SelectField(project.parentId ?: "", listOf("" to "None (top level)") + options, { v ->
                    Store.setProjectParent(project.id, v.ifEmpty { null })?.let { Store.toast(it, tone = "error") }
                }) {
                    id("parent-${project.id}")
                    attr("data-testid", "project-parent")
                }
            }
            Div({ classes("project-stats") }) {
                Span({ attr("data-testid", "project-count") }) { Text("${p.total} task${if (p.total == 1) "" else "s"}") }
                Span({ classes("muted") }) {
                    Text(
                        "${p.done} done · ${p.total - p.done} open" +
                            if (childCount >
                                0
                            ) {
                                " · ${p.total - ownTasks} in $childCount sub-project${if (childCount == 1) "" else "s"}"
                            } else {
                                ""
                            },
                    )
                }
            }
        }
        Div({
            classes("progress")
            attr("role", "progressbar")
            attr("aria-label", "${project.name} progress, including sub-projects")
            attr("aria-valuenow", p.percent.toString())
            attr("aria-valuemin", "0")
            attr("aria-valuemax", "100")
        }) {
            Div({
                classes("progress-fill")
                style {
                    property("width", "${p.percent}%")
                    property("background", project.color)
                }
            })
        }
        Div({ classes("project-foot") }) {
            Span({
                classes("project-percent")
                attr("data-testid", "project-percent")
            }) { Text("${p.percent}% complete") }
            Div({ classes("project-foot-actions") }) {
                Button({
                    classes("btn", "btn-sm", "btn-ghost")
                    attr("type", "button")
                    attr("aria-expanded", showWorkflow.toString())
                    attr("data-testid", "workflow-toggle")
                    onClick { showWorkflow = !showWorkflow }
                }) {
                    IconView(if (showWorkflow) Icon.ChevronDown else Icon.ChevronRight, 14)
                    Text("Workflow")
                }
                Link("/board?project=${project.id}", "see-all") { Text("Open board →") }
            }
        }
        WorkflowSummary(project)
        if (showWorkflow) WorkflowEditor(project)
    }
}

@Composable
private fun DeleteProjectDialog(project: Project, close: () -> Unit) {
    val projects = Store.projects
    val subtree = descendantIds(projects, project.id)
    val childCount = projects.count { it.parentId == project.id }
    val ownTasks = Store.tasks.count { it.projectId == project.id }
    val subtreeTasks = Store.tasks.count { it.projectId in subtree }
    var subAction by remember { mutableStateOf(SubProjectAction.MOVE_UP) }
    val affectedTasks = if (subAction == SubProjectAction.DELETE) subtreeTasks else ownTasks
    val parentName = project.parentId?.let { Store.project(it)?.name }
    Modal("delete-project-title", close, testId = "delete-project-modal") {
        ModalHeader("delete-project-title", "Delete \"${project.name}\"?", close)
        Div({ classes("modal-body") }) {
            if (childCount > 0) {
                Fieldset({ classes("choice-group") }) {
                    Legend {
                        Text(
                            "It has ${subtree.size - 1} sub-project${if (subtree.size == 2) "" else "s"}. What should happen to them?",
                        )
                    }
                    Label(attrs = { classes("choice") }) {
                        Input(InputType.Radio) {
                            name("sub-action")
                            checked(subAction == SubProjectAction.MOVE_UP)
                            attr("data-testid", "delete-subprojects-move-up")
                            onChange { subAction = SubProjectAction.MOVE_UP }
                        }
                        Text("Move them up one level (to ${parentName?.let { "\"$it\"" } ?: "the top level"})")
                    }
                    Label(attrs = { classes("choice") }) {
                        Input(InputType.Radio) {
                            name("sub-action")
                            checked(subAction == SubProjectAction.DELETE)
                            attr("data-testid", "delete-subprojects-delete")
                            onChange { subAction = SubProjectAction.DELETE }
                        }
                        Text("Delete them too")
                    }
                }
            }
            P {
                Text(
                    if (affectedTasks == 0) {
                        "No tasks are affected."
                    } else {
                        "$affectedTasks task${if (affectedTasks == 1) "" else "s"} will lose their project. What should happen to them?"
                    },
                )
            }
            Div({ classes("form-actions", "stack-sm") }) {
                Button({
                    classes("btn", "btn-ghost")
                    attr("type", "button")
                    onClick { close() }
                }) { Text("Cancel") }
                Button({
                    classes("btn")
                    attr("type", "button")
                    attr("data-testid", "delete-project-keep")
                    attr("data-autofocus", "")
                    onClick {
                        Store.deleteProject(project.id, deleteTasks = false, subProjects = subAction)
                        close()
                    }
                }) { Text(if (affectedTasks == 0) "Delete project" else "Move tasks to \"No project\"") }
                if (affectedTasks > 0) {
                    Button({
                        classes("btn", "btn-danger")
                        attr("type", "button")
                        attr("data-testid", "delete-project-tasks")
                        onClick {
                            Store.deleteProject(project.id, deleteTasks = true, subProjects = subAction)
                            close()
                        }
                    }) { Text("Delete tasks too") }
                }
            }
        }
    }
}
