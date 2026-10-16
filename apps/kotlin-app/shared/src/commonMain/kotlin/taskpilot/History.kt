package taskpilot

/**
 * Immutable undo/redo history. [present] is the current value; [past] holds older values
 * (most recent last), [future] holds undone values (most recent last).
 */
data class History<T>(
    val present: T,
    val past: List<T> = emptyList(),
    val future: List<T> = emptyList(),
    val limit: Int = 50,
) {
    val canUndo: Boolean get() = past.isNotEmpty()
    val canRedo: Boolean get() = future.isNotEmpty()

    /** Records [next] as the new present; clears the redo stack. No-op when unchanged. */
    fun push(next: T): History<T> {
        if (next == present) return this
        return copy(present = next, past = (past + present).takeLast(limit), future = emptyList())
    }

    fun undo(): History<T> {
        if (past.isEmpty()) return this
        return copy(present = past.last(), past = past.dropLast(1), future = future + present)
    }

    fun redo(): History<T> {
        if (future.isEmpty()) return this
        return copy(present = future.last(), past = (past + present).takeLast(limit), future = future.dropLast(1))
    }

    /** Replaces the present without recording history (e.g. a full data reset). */
    fun reset(value: T): History<T> = History(value, limit = limit)
}
