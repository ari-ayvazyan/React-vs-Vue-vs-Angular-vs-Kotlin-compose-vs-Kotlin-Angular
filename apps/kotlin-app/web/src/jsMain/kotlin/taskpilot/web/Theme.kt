package taskpilot.web

import kotlinx.browser.document
import kotlinx.browser.window
import taskpilot.ThemeMode

/** Resolves light/dark/system to a `data-theme` attribute on <html>; index.html applies it pre-boot too. */
object Theme {
    private var mode: ThemeMode = ThemeMode.SYSTEM

    fun init(initial: ThemeMode) {
        apply(initial)
        window.matchMedia("(prefers-color-scheme: dark)").addListener { if (mode == ThemeMode.SYSTEM) apply(mode) }
    }

    fun apply(theme: ThemeMode) {
        mode = theme
        val dark = theme == ThemeMode.DARK || (theme == ThemeMode.SYSTEM && Platform.prefersDark())
        val root = document.documentElement ?: return
        root.setAttribute("data-theme", if (dark) "dark" else "light")
        root.setAttribute("data-theme-mode", theme.name.lowercase())
        (root.asDynamic().style).colorScheme = if (dark) "dark" else "light"
    }

    fun isDark(): Boolean = document.documentElement?.getAttribute("data-theme") == "dark"
}
