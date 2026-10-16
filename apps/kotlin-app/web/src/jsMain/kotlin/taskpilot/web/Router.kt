package taskpilot.web

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.browser.window
import org.w3c.dom.url.URLSearchParams

sealed interface Route {
    data object Dashboard : Route

    data object Tasks : Route

    data class TaskDetail(val id: String) : Route

    data object Board : Route

    data object Calendar : Route

    data object Projects : Route

    data object Activity : Route

    data object Timeline : Route

    data object Reports : Route

    data object Settings : Route

    data class NotFound(val path: String) : Route
}

/** Tiny History-API router; the current location lives in Compose state. */
object Router {
    var path by mutableStateOf(window.location.pathname)
        private set
    var search by mutableStateOf(window.location.search)
        private set

    /** Hook run before every location change is applied (used for the `?seed=` benchmark hook). */
    var interceptor: (() -> Unit)? = null

    fun init() {
        window.addEventListener("popstate", { sync() })
        if (path == "/" || path.isEmpty()) {
            window.history.replaceState(null, "", "/dashboard" + window.location.search)
        }
        sync()
    }

    private fun sync() {
        interceptor?.invoke()
        path = window.location.pathname
        search = window.location.search
        window.document.title = titleFor(route) + " · TaskPilot"
    }

    val route: Route get() = parse(path)

    fun parse(path: String): Route {
        val clean = path.trimEnd('/').ifEmpty { "/" }
        val segments = clean.split('/').filter { it.isNotEmpty() }
        return when {
            clean == "/" || clean == "/dashboard" -> Route.Dashboard
            clean == "/tasks" -> Route.Tasks
            segments.size == 2 && segments[0] == "tasks" -> Route.TaskDetail(decodeURIComponent(segments[1]))
            clean == "/board" -> Route.Board
            clean == "/calendar" -> Route.Calendar
            clean == "/projects" -> Route.Projects
            clean == "/settings" -> Route.Settings
            clean == "/activity" -> Route.Activity
            clean == "/timeline" -> Route.Timeline
            clean == "/reports" -> Route.Reports
            else -> Route.NotFound(path)
        }
    }

    fun navigate(url: String, replace: Boolean = false) {
        val current = window.location.pathname + window.location.search
        if (url == current) return
        if (replace) window.history.replaceState(null, "", url) else window.history.pushState(null, "", url)
        sync()
        if (!replace) window.scrollTo(0.0, 0.0)
    }

    fun params(): Map<String, String> = parseQuery(search)

    fun parseQuery(search: String): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        search.removePrefix("?").split('&').filter { it.isNotEmpty() }.forEach { part ->
            val eq = part.indexOf('=')
            val k = if (eq < 0) part else part.substring(0, eq)
            val v = if (eq < 0) "" else part.substring(eq + 1)
            out[decode(k)] = decode(v)
        }
        return out
    }

    fun buildUrl(path: String, params: List<Pair<String, String>>): String {
        if (params.isEmpty()) return path
        val p = URLSearchParams()
        params.forEach { (k, v) -> p.append(k, v) }
        return "$path?$p"
    }

    private fun decode(v: String): String =
        try {
            decodeURIComponent(v.replace('+', ' '))
        } catch (e: Throwable) {
            v
        }

    private fun titleFor(route: Route): String =
        when (route) {
            Route.Dashboard -> "Dashboard"
            Route.Tasks -> "Tasks"
            is Route.TaskDetail -> "Task"
            Route.Board -> "Board"
            Route.Calendar -> "Calendar"
            Route.Projects -> "Projects"
            Route.Settings -> "Settings"
            Route.Activity -> "Activity"
            Route.Timeline -> "Timeline"
            Route.Reports -> "Reports"
            is Route.NotFound -> "Not found"
        }
}

external fun decodeURIComponent(value: String): String

external fun encodeURIComponent(value: String): String
