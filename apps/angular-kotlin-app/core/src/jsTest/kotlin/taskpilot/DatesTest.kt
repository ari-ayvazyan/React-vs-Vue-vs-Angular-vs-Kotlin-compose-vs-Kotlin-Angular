package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DatesTest {
    @Test
    fun civilRoundTrip() {
        for (d in -800..40_000 step 37) assertEquals(d, parseDay(formatDay(d)))
        assertEquals(0, day("1970-01-01"))
        assertEquals("2024-02-29", formatDay(day("2024-02-28") + 1))
    }

    @Test
    fun rejectsInvalidDates() {
        assertNull(parseDay("2026-02-30"))
        assertNull(parseDay("2026-13-01"))
        assertNull(parseDay("16.10.2026"))
    }

    @Test
    fun instantFormattingAndParsing() {
        val ms = parseInstant("2026-10-16T12:34:56.789Z")!!
        assertEquals("2026-10-16T12:34:56.789Z", formatInstant(ms))
        assertEquals(ms, parseInstant("2026-10-16T14:34:56.789+02:00"))
    }

    @Test
    fun weekdayIsMondayFirst() {
        assertEquals(4, CivilDate.weekdayMonFirst(day(TODAY))) // Friday
        assertEquals(0, CivilDate.weekdayMonFirst(day("2026-10-12"))) // Monday
    }

    @Test
    fun monthGridStartsOnMondayAndHighlightsToday() {
        val grid = buildMonthGrid(2026, 10, arrayOf(task("a", dueDate = TODAY), task("b", dueDate = TODAY)), TODAY, "")
        assertEquals("2026-09-28", grid.days.first().date)
        assertEquals(0, grid.days.size % 7)
        val today = grid.days.single { it.isToday }
        assertEquals(TODAY, today.date)
        assertEquals(2, today.tasks.size)
        assertEquals(2027, shiftMonth(2026, 12, 1).year)
        assertEquals(12, shiftMonth(2026, 1, -1).month)
    }
}
