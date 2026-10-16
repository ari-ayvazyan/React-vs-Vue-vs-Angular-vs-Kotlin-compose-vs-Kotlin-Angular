package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PomodoroShortcutTest {
    private val min = 60_000.0

    @Test
    fun pomodoroCreditsElapsedTimeOnPauseAndReset() {
        val p = PomodoroTimer()
        assertTrue(p.start("t1", 25, 0.0))
        assertEquals(25 * 60, p.remainingSeconds(0.0))
        assertEquals(3, p.pause(3.5 * min))
        assertTrue(p.start("t1", 25, 10 * min))
        assertFalse(p.start("t2", 25, 10 * min), "another task cannot start while one is active")
        assertEquals(2, p.reset(11 * min)) // 4.5 elapsed in total -> rounds to 5, 3 credited before
        assertFalse(p.active)
    }

    @Test
    fun pomodoroFinishes() {
        val p = PomodoroTimer()
        p.start("t1", 1, 0.0)
        assertEquals(-1, p.tick(30_000.0))
        assertEquals(1, p.tick(61_000.0))
        assertTrue(p.finished)
        assertEquals(0, p.remainingSeconds(70_000.0))
        assertEquals(0, p.reset(80_000.0))
    }

    @Test
    fun shortcutsAndSequences() {
        val s = ShortcutInterpreter()
        assertEquals(ShortcutAction.NEW_TASK, s.handle("n", false, false, false, false, 0.0))
        assertEquals(ShortcutAction.NONE, s.handle("n", false, false, false, true, 0.0))
        assertEquals(ShortcutAction.PENDING, s.handle("g", false, false, false, false, 0.0))
        assertEquals("nav:/board", s.handle("b", false, false, false, false, 500.0))
        s.handle("g", false, false, false, false, 600.0)
        assertEquals("nav:/activity", s.handle("a", false, false, false, false, 700.0))
        s.handle("g", false, false, false, false, 0.0)
        assertEquals(ShortcutAction.NONE, s.handle("d", false, false, false, false, 5000.0))
        assertEquals(ShortcutAction.UNDO, s.handle("z", true, false, false, false, 0.0))
        assertEquals(ShortcutAction.REDO, s.handle("Z", true, true, false, false, 0.0))
        assertEquals(ShortcutAction.HELP, s.handle("?", false, true, false, false, 0.0))
        assertEquals(ShortcutAction.ESCAPE, s.handle("Escape", false, false, false, true, 0.0))
    }
}
