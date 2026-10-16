@file:OptIn(ExperimentalJsExport::class)

package taskpilot

@JsExport
class ShortcutHelp(
    val keys: Array<String>,
    val description: String,
)

/** Action ids returned by [ShortcutInterpreter.handle]. */
@JsExport
object ShortcutAction {
    const val NONE: String = ""
    const val NEW_TASK: String = "new-task"
    const val FOCUS_SEARCH: String = "focus-search"
    const val HELP: String = "help"
    const val UNDO: String = "undo"
    const val REDO: String = "redo"
    const val ESCAPE: String = "escape"
    const val PENDING: String = "pending"
    const val NAV_PREFIX: String = "nav:"
}

/**
 * Interprets keydown events into app actions, including the two-key `g x` navigation sequences.
 * Single-key shortcuts are ignored while the user is typing in a form field.
 */
@JsExport
class ShortcutInterpreter {
    private var pendingG: Double = -1.0

    fun handle(
        key: String,
        ctrlOrMeta: Boolean,
        shift: Boolean,
        alt: Boolean,
        typing: Boolean,
        nowMs: Double,
    ): String {
        if (key == "Escape") {
            pendingG = -1.0
            return ShortcutAction.ESCAPE
        }
        if (typing || alt) {
            pendingG = -1.0
            return ShortcutAction.NONE
        }
        if (ctrlOrMeta) {
            pendingG = -1.0
            val k = key.lowercase()
            return when {
                k == "z" && shift -> ShortcutAction.REDO
                k == "z" -> ShortcutAction.UNDO
                k == "y" -> ShortcutAction.REDO
                else -> ShortcutAction.NONE
            }
        }
        if (pendingG >= 0 && nowMs - pendingG <= SEQUENCE_TIMEOUT_MS) {
            pendingG = -1.0
            return NAV_TARGETS[key.lowercase()]?.let { ShortcutAction.NAV_PREFIX + it } ?: ShortcutAction.NONE
        }
        pendingG = -1.0
        return when (key) {
            "g", "G" -> {
                if (shift) return ShortcutAction.NONE
                pendingG = nowMs
                ShortcutAction.PENDING
            }
            "n", "N" -> if (shift) ShortcutAction.NONE else ShortcutAction.NEW_TASK
            "/" -> ShortcutAction.FOCUS_SEARCH
            "?" -> ShortcutAction.HELP
            else -> ShortcutAction.NONE
        }
    }

    companion object {
        const val SEQUENCE_TIMEOUT_MS: Double = 1500.0

        private val NAV_TARGETS =
            mapOf(
                "d" to "/dashboard",
                "t" to "/tasks",
                "b" to "/board",
                "c" to "/calendar",
                "p" to "/projects",
                "s" to "/settings",
                "a" to "/activity",
                "l" to "/timeline",
                "r" to "/reports",
            )

        /** Rows for the shortcut help dialog. */
        fun helpRows(): Array<ShortcutHelp> =
            arrayOf(
                ShortcutHelp(arrayOf("n"), "New task"),
                ShortcutHelp(arrayOf("/"), "Focus search"),
                ShortcutHelp(arrayOf("g", "d"), "Go to dashboard"),
                ShortcutHelp(arrayOf("g", "t"), "Go to tasks"),
                ShortcutHelp(arrayOf("g", "b"), "Go to board"),
                ShortcutHelp(arrayOf("g", "c"), "Go to calendar"),
                ShortcutHelp(arrayOf("g", "p"), "Go to projects"),
                ShortcutHelp(arrayOf("g", "s"), "Go to settings"),
                ShortcutHelp(arrayOf("g", "a"), "Go to activity"),
                ShortcutHelp(arrayOf("g", "l"), "Go to timeline"),
                ShortcutHelp(arrayOf("g", "r"), "Go to reports"),
                ShortcutHelp(arrayOf("Ctrl/⌘", "Z"), "Undo"),
                ShortcutHelp(arrayOf("Ctrl/⌘", "Shift", "Z"), "Redo"),
                ShortcutHelp(arrayOf("Shift", "← →"), "Board: move card between columns"),
                ShortcutHelp(arrayOf("Shift", "↑ ↓"), "Board: reorder card"),
                ShortcutHelp(arrayOf("?"), "Show this help"),
                ShortcutHelp(arrayOf("Esc"), "Close dialog"),
            )
    }
}
