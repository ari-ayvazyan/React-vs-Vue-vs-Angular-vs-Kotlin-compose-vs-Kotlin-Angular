package taskpilot.web.pages

import androidx.compose.runtime.Composable
import org.jetbrains.compose.web.dom.Code
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.H1
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Text
import taskpilot.web.ui.Link

@Composable
fun NotFoundPage(path: String) {
    Div({
        classes("not-found")
        attr("data-testid", "not-found")
    }) {
        Div({ classes("nf-code") }) { Text("404") }
        H1 { Text("Page not found") }
        P({ classes("muted") }) {
            Text("There is nothing at ")
            Code { Text(path) }
            Text(".")
        }
        Link("/dashboard", "btn btn-primary") { Text("Go to dashboard") }
    }
}
