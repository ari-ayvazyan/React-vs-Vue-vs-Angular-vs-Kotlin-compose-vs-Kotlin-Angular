package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import org.jetbrains.compose.web.attributes.InputType
import org.jetbrains.compose.web.attributes.forId
import org.jetbrains.compose.web.attributes.name
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.Fieldset
import org.jetbrains.compose.web.dom.H1
import org.jetbrains.compose.web.dom.H2
import org.jetbrains.compose.web.dom.Input
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Legend
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Section
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.w3c.dom.HTMLInputElement
import org.w3c.files.FileReader
import org.w3c.files.get
import taskpilot.Demo
import taskpilot.ImportResult
import taskpilot.ThemeMode
import taskpilot.exportState
import taskpilot.importState
import taskpilot.web.Platform
import taskpilot.web.Store
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconView
import taskpilot.web.ui.Modal
import taskpilot.web.ui.ModalHeader
import taskpilot.web.ui.SelectField

@Composable
fun SettingsPage() {
    val settings = Store.settings
    Div({ classes("page-header") }) {
        Div {
            H1 { Text("Settings") }
            P({ classes("subtitle") }) { Text("Preferences are stored in this browser.") }
        }
    }
    Div({ classes("settings-grid") }) {
        Section({ classes("card") }) {
            Div({ classes("card-head") }) { H2 { Text("Appearance") } }
            Fieldset({ classes("radio-cards") }) {
                Legend { Text("Theme") }
                listOf(
                    Triple(ThemeMode.LIGHT, "Light", Icon.Sun),
                    Triple(ThemeMode.DARK, "Dark", Icon.Moon),
                    Triple(ThemeMode.SYSTEM, "System", Icon.Monitor),
                ).forEach { (mode, label, icon) ->
                    Label(attrs = {
                        classes("radio-card")
                        if (settings.theme == mode) classes("on")
                    }) {
                        Input(InputType.Radio) {
                            name("theme")
                            value(mode.name.lowercase())
                            checked(settings.theme == mode)
                            attr("data-testid", "theme-${mode.name.lowercase()}")
                            onChange { Store.updateSettings { it.copy(theme = mode) } }
                        }
                        IconView(icon, 18)
                        Span { Text(label) }
                    }
                }
            }
        }
        Section({ classes("card") }) {
            Div({ classes("card-head") }) { H2 { Text("Preferences") } }
            Div({ classes("field") }) {
                Label(forId = "current-user") { Text("Current user") }
                val missing = settings.currentUserId != null && Store.currentUser == null
                SelectField(
                    if (missing) "" else settings.currentUserId.orEmpty(),
                    listOf("" to "Nobody (read-only comments)") + Store.members.map { it.id to it.name },
                    { v -> Store.updateSettings { it.copy(currentUserId = v.ifEmpty { null }) } },
                ) {
                    id("current-user")
                    attr("data-testid", "current-user-select")
                    attr("aria-describedby", "current-user-help")
                }
                P({
                    classes("muted", "small")
                    id("current-user-help")
                }) { Text("Comments are posted as this member, and your changes are recorded under their name in the activity log.") }
            }
            PomodoroSetting(settings.pomodoroMinutes)
            Div({ classes("field") }) {
                Label(forId = "page-size") { Text("Tasks per page") }
                SelectField(
                    settings.pageSize.toString(),
                    (listOf(10, 25, 50, 100) + settings.pageSize).distinct().sorted().map { it.toString() to "$it per page" },
                    { v -> v.toIntOrNull()?.let { n -> Store.updateSettings { it.copy(pageSize = n) } } },
                ) {
                    id("page-size")
                    attr("data-testid", "page-size")
                }
            }
        }
        MembersSection()
        DataSection()
    }
}

@Composable
private fun PomodoroSetting(current: Int) {
    var text by remember(current) { mutableStateOf(current.toString()) }
    var error by remember { mutableStateOf<String?>(null) }
    Div({
        classes("field")
        if (error != null) classes("has-error")
    }) {
        Label(forId = "pomodoro-minutes") { Text("Pomodoro length (minutes)") }
        Input(InputType.Number) {
            id("pomodoro-minutes")
            attr("min", "1")
            attr("max", "180")
            attr("data-testid", "pomodoro-minutes")
            value(text)
            if (error != null) {
                attr("aria-invalid", "true")
                attr("aria-describedby", "pomodoro-error")
            }
            onInput { e ->
                text = e.value?.toString() ?: ""
                val n = text.toIntOrNull()
                if (n == null || n !in 1..180 || text.contains('.')) {
                    error = "Enter a whole number between 1 and 180."
                } else {
                    error = null
                    if (n != current) Store.updateSettings { it.copy(pomodoroMinutes = n) }
                }
            }
        }
        error?.let {
            Div({
                classes("field-error")
                id("pomodoro-error")
                attr("role", "alert")
            }) { Text(it) }
        }
    }
}

@Composable
private fun DataSection() {
    var importError by remember { mutableStateOf<String?>(null) }
    var confirmReset by remember { mutableStateOf(false) }
    Section({ classes("card", "span-2") }) {
        Div({ classes("card-head") }) { H2 { Text("Data") } }
        P({ classes("muted") }) {
            Text("${Store.tasks.size} tasks, ${Store.projects.size} projects and ${Store.members.size} members stored locally under ")
            org.jetbrains.compose.web.dom
                .Code { Text(taskpilot.STORAGE_KEY_V2) }
            Text(".")
        }
        Div({ classes("data-actions") }) {
            Button({
                classes("btn")
                attr("type", "button")
                attr("data-testid", "export-button")
                onClick {
                    val state = taskpilot.AppState(Store.tasks, Store.projects, Store.settings, Store.members)
                    val stamp = Store.clock().nowIso.take(10)
                    Platform.download("taskpilot-$stamp.json", exportState(state))
                    Store.toast("Exported ${Store.tasks.size} tasks", tone = "success")
                }
            }) {
                IconView(Icon.Download, 16)
                Text("Export JSON")
            }
            Label(forId = "import-file", attrs = { classes("btn", "file-btn") }) {
                IconView(Icon.Upload, 16)
                Text("Import JSON…")
            }
            Input(InputType.File) {
                id("import-file")
                classes("sr-only")
                attr("accept", "application/json,.json")
                attr("data-testid", "import-input")
                onChange { e ->
                    val input = e.target as HTMLInputElement
                    val file = input.files?.get(0) ?: return@onChange
                    val reader = FileReader()
                    reader.onload = {
                        val text = reader.result as? String ?: ""
                        when (val r = importState(text, Store.settings)) {
                            is ImportResult.Ok -> {
                                importError = null
                                Store.replaceAll(r.state)
                                Store.toast("Imported ${r.state.tasks.size} tasks and ${r.state.projects.size} projects", tone = "success")
                            }
                            is ImportResult.Error -> importError = r.message
                        }
                        input.value = ""
                        Unit
                    }
                    reader.onerror = {
                        importError = "Could not read the file."
                        Unit
                    }
                    reader.readAsText(file)
                }
            }
            Button({
                classes("btn", "btn-danger")
                attr("type", "button")
                attr("data-testid", "reset-demo")
                onClick { confirmReset = true }
            }) {
                IconView(Icon.Reset, 16)
                Text("Reset demo data")
            }
        }
        importError?.let {
            Div({
                classes("alert", "alert-error")
                attr("role", "alert")
                attr("data-testid", "import-error")
            }) {
                IconView(Icon.Alert, 16)
                Div {
                    org.jetbrains.compose.web.dom
                        .B { Text("Import failed. ") }
                    Text(it)
                }
            }
        }
    }
    if (confirmReset) {
        val close = { confirmReset = false }
        Modal("reset-title", close) {
            ModalHeader("reset-title", "Reset demo data?", close)
            Div({ classes("modal-body") }) {
                P {
                    Text(
                        "All current tasks and projects will be replaced by ${Demo.DEFAULT_COUNT} generated demo tasks. Consider exporting first.",
                    )
                }
                Div({ classes("form-actions") }) {
                    Button({
                        classes("btn", "btn-ghost")
                        attr("type", "button")
                        attr("data-autofocus", "")
                        onClick { close() }
                    }) { Text("Cancel") }
                    Button({
                        classes("btn", "btn-danger")
                        attr("type", "button")
                        attr("data-testid", "reset-confirm")
                        onClick {
                            Store.resetDemo()
                            close()
                            Store.toast("Demo data restored", tone = "success")
                        }
                    }) { Text("Reset data") }
                }
            }
        }
    }
}
