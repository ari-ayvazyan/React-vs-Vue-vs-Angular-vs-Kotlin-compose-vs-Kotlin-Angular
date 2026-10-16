package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DatesTest {
    @Test
    fun epochDayRoundTrips() {
        assertEquals(0, Dates.epochDay(1970, 1, 1))
        for (d in listOf(-1000, 0, 59, 11_016, 19_723, 20_000, 60_000)) {
            val (y, m, dd) = Dates.civil(d)
            assertEquals(d, Dates.epochDay(y, m, dd))
        }
        assertEquals("2024-02-29", Dates.format(Dates.epochDay(2024, 2, 29)))
    }

    @Test
    fun parseRejectsImpossibleDates() {
        assertNull(Dates.parse("2023-02-29"))
        assertNull(Dates.parse("2024-13-01"))
        assertNull(Dates.parse("24-01-01"))
        assertEquals(Dates.epochDay(2024, 2, 29), Dates.parse("2024-02-29"))
    }

    @Test
    fun isoFormattingAndParsing() {
        val ms = Dates.epochDay(2024, 6, 12) * Dates.DAY_MS + 3_723_004L
        assertEquals("2024-06-12T01:02:03.004Z", Dates.isoFromMillis(ms))
        assertEquals(ms, Dates.millisFromIso("2024-06-12T01:02:03.004Z"))
        assertEquals(ms, Dates.millisFromIso("2024-06-12T03:02:03.004+02:00"))
        assertEquals(0, Dates.weekdayMonFirst(Dates.epochDay(2024, 6, 10))) // Monday
    }

    @Test
    fun monthGridIsMondayFirstWholeWeeks() {
        val grid = monthGrid(2024, 6) // June 2024 starts on a Saturday
        assertEquals(0, grid.days.size % 7)
        assertEquals(0, Dates.weekdayMonFirst(grid.days.first()))
        assertEquals("2024-05-27", Dates.format(grid.days.first()))
        assertEquals("2024-06-30", Dates.format(grid.days.last())) // June 30 2024 is a Sunday
        assertEquals(2025 to 1, shiftMonth(2024, 12, 1))
        assertEquals(2023 to 12, shiftMonth(2024, 1, -1))
    }
}
