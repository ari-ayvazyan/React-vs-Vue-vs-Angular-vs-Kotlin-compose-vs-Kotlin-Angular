package taskpilot.web

import kotlinx.browser.window
import org.jetbrains.compose.web.renderComposable
import taskpilot.generateDemoData

fun main() {
    Store.load()
    Theme.init(Store.settings.theme)
    Router.interceptor = { applySeedParam() }
    Router.init()
    window.document.getElementById("root")?.innerHTML = ""
    renderComposable(rootElementId = "root") { App() }
    window.document.documentElement?.removeAttribute("data-booting")
}

/** Benchmark hook: `?seed=N` replaces all data with generateDemoData(N), then drops the param. */
private fun applySeedParam() {
    val search = window.location.search
    if (!search.contains("seed=")) return
    val params = Router.parseQuery(search)
    val n = params["seed"]?.toIntOrNull() ?: return
    if (n < 0) return
    val clock = Platform.clock()
    Store.replaceAll(generateDemoData(n.coerceAtMost(100_000), clock.nowMs, clock.today, Store.settings))
    val rest = params.filterKeys { it != "seed" }.toList()
    window.history.replaceState(null, "", Router.buildUrl(window.location.pathname, rest))
}
