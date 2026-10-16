package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HistoryTest {
    @Test
    fun undoRedo() {
        var h = History(0)
        h = h.push(1).push(2).push(3)
        assertEquals(3, h.present)
        h = h.undo().undo()
        assertEquals(1, h.present)
        assertTrue(h.canRedo)
        h = h.redo()
        assertEquals(2, h.present)
        h = h.push(10)
        assertFalse(h.canRedo)
        assertEquals(2, h.undo().present)
    }

    @Test
    fun depthIsLimitedTo50() {
        var h = History(0)
        for (i in 1..80) h = h.push(i)
        assertEquals(50, h.past.size)
        repeat(100) { h = h.undo() }
        assertEquals(30, h.present)
        assertFalse(h.canUndo)
    }

    @Test
    fun pushingSameValueIsNoop() {
        val h = History(5).push(5)
        assertFalse(h.canUndo)
        assertEquals(History(1), History(1).undo().redo())
    }
}
