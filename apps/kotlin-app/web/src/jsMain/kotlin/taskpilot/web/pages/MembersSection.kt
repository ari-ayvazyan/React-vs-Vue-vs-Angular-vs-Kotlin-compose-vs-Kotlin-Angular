package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import org.jetbrains.compose.web.dom.H2
import org.jetbrains.compose.web.dom.Input
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Li
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Section
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.dom.Ul
import taskpilot.Demo
import taskpilot.Member
import taskpilot.Status
import taskpilot.validateMemberName
import taskpilot.web.Store
import taskpilot.web.ui.Avatar
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconButton
import taskpilot.web.ui.IconView
import taskpilot.web.ui.Link

private val MEMBER_PALETTE = Demo.MEMBERS.map { it.color } + Demo.PROJECT_COLORS

/** Settings card for managing team members (add, rename, recolour, delete). */
@Composable
fun MembersSection() {
    val members = Store.members
    Section({
        classes("card", "span-2")
        attr("data-testid", "members-section")
    }) {
        Div({ classes("card-head") }) {
            H2 { Text("Team members") }
            Span({ classes("muted") }) { Text("${members.size} member${if (members.size == 1) "" else "s"}") }
        }
        AddMemberForm()
        if (members.isEmpty()) {
            P({ classes("muted") }) { Text("No members yet. Add people to assign tasks to them.") }
        } else {
            Ul({ classes("member-list") }) {
                members.forEach { m -> MemberRow(m) }
            }
        }
    }
}

@Composable
private fun AddMemberForm() {
    var name by remember { mutableStateOf("") }
    var color by remember { mutableStateOf(MEMBER_PALETTE[Store.members.size % MEMBER_PALETTE.size]) }
    var error by remember { mutableStateOf<String?>(null) }
    Form(attrs = {
        classes("inline-form")
        attr("novalidate", "")
        onSubmit { e ->
            e.preventDefault()
            error = validateMemberName(name, Store.members)
            if (error == null) {
                val n = name.trim()
                Store.createMember(n, color)
                Store.toast("Member \"$n\" added", tone = "success")
                name = ""
                color = MEMBER_PALETTE[Store.members.size % MEMBER_PALETTE.size]
            }
        }
    }) {
        Div({ classes("field", "grow") }) {
            Label(forId = "new-member-name") { Text("Name") }
            Input(InputType.Text) {
                id("new-member-name")
                attr("data-testid", "member-name-input")
                attr("autocomplete", "off")
                placeholder("e.g. Jamie Doe")
                value(name)
                if (error != null) {
                    attr("aria-invalid", "true")
                    attr("aria-describedby", "new-member-error")
                }
                onInput {
                    name = it.value
                    error = null
                }
            }
        }
        Div({ classes("field") }) {
            Label(forId = "new-member-color") { Text("Colour") }
            Input(InputType.Color) {
                id("new-member-color")
                classes("color-input")
                value(color)
                onInput { color = it.value }
            }
        }
        Button({
            classes("btn", "btn-primary")
            attr("type", "submit")
            attr("data-testid", "member-add")
        }) {
            IconView(Icon.Plus, 16)
            Text("Add member")
        }
    }
    error?.let {
        P({
            classes("field-error")
            id("new-member-error")
            attr("role", "alert")
        }) { Text(it) }
    }
}

@Composable
private fun MemberRow(member: Member) {
    var editing by remember(member.id) { mutableStateOf(false) }
    var name by remember(member.id, editing) { mutableStateOf(member.name) }
    var error by remember(member.id, editing) { mutableStateOf<String?>(null) }
    val open = Store.tasks.count { it.assigneeId == member.id && it.status != Status.DONE }
    val total = Store.tasks.count { it.assigneeId == member.id }
    Li({
        classes("member-row")
        attr("data-testid", "member-row")
    }) {
        Avatar(member, "md", showTitle = false)
        if (editing) {
            Form(attrs = {
                classes("rename-form")
                onSubmit { e ->
                    e.preventDefault()
                    error = validateMemberName(name, Store.members, editingId = member.id)
                    if (error == null) {
                        val n = name.trim()
                        if (n != member.name) Store.updateMember(member.id) { it.copy(name = n) }
                        editing = false
                    }
                }
            }) {
                Label(forId = "rename-member-${member.id}", attrs = { classes("sr-only") }) { Text("Member name") }
                Input(InputType.Text) {
                    id("rename-member-${member.id}")
                    attr("data-testid", "member-rename-input")
                    value(name)
                    if (error != null) attr("aria-invalid", "true")
                    attr("title", error ?: "")
                    ref { el ->
                        el.focus()
                        el.select()
                        onDispose { }
                    }
                    onInput {
                        name = it.value
                        error = null
                    }
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
            Span({ classes("member-name") }) {
                Link("/tasks?assignee=${member.id}") { Text(member.name) }
            }
            Span({ classes("member-count") }) { Text("$open open · $total total") }
        }
        Label(forId = "member-color-${member.id}", attrs = { classes("swatch-label") }) {
            Span({ classes("sr-only") }) { Text("Colour for ${member.name}") }
            Input(InputType.Color) {
                id("member-color-${member.id}")
                classes("color-swatch")
                value(member.color)
                onChange { e ->
                    val c = e.value
                    if (c != member.color) Store.updateMember(member.id) { it.copy(color = c) }
                }
            }
        }
        if (!editing) {
            IconButton(Icon.Edit, "Rename ${member.name}", testId = "member-rename", extraClass = "subtle") { editing = true }
        }
        IconButton(Icon.Trash, "Delete ${member.name}", testId = "member-delete", extraClass = "subtle") {
            Store.deleteMember(member.id)
        }
        error?.let {
            Span({
                classes("field-error", "member-error")
                attr("role", "alert")
            }) { Text(it) }
        }
    }
}
