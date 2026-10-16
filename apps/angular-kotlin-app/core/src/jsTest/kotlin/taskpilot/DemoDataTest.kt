package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DemoDataTest {
    private val now = parseInstant("2026-10-16T12:00:00.000Z")!!

    @Test
    fun mulberry32MatchesJavaScriptReference() {
        val r = Mulberry32(42)
        assertEquals(0.6011037519201636, r.next())
        assertEquals(0.44829055899754167, r.next())
        assertEquals(0.8524657934904099, r.next())
    }

    @Test
    fun generatorIsDeterministic() {
        val a = serializeState(generateDemoState(300, now, day(TODAY)), false)
        val b = serializeState(generateDemoState(300, now, day(TODAY)), false)
        assertEquals(a, b)
    }

    @Test
    fun generatorProducesSpecShape() {
        val s = generateDemoState(300, now, day(TODAY))
        assertEquals(300, s.tasks.size)
        assertEquals(listOf("Website", "Mobile App", "Marketing", "Infrastructure", "Hiring", "Personal"), s.projects.map { it.name })
        assertEquals("#6366f1", s.projects[0].color)
        assertEquals("Test landing page #1", s.tasks[0].title)
        assertEquals("Demo task 1", s.tasks[0].description)
        assertEquals(Status.TODO, s.tasks[0].status)
        s.tasks.forEach { t ->
            assertTrue(t.tags.size <= 3 && t.tags.toSet().size == t.tags.size)
            assertTrue(t.subtasks.size <= 3)
            assertTrue(t.timeSpentMinutes in 0 until 180)
            assertTrue(t.estimateMinutes in listOf(15, 30, 60, 120, 240))
            assertEquals(t.status == Status.DONE, t.completedAt != null)
            t.completedAt?.let { assertTrue(parseInstant(it)!! <= now) }
            t.dueDate?.let { assertTrue(day(it) - day(TODAY) in -25..34) }
        }
        val doneShare = s.tasks.count { it.status == Status.DONE } / 300.0
        assertTrue(doneShare in 0.35..0.55, "done share $doneShare")
    }

    @Test
    fun generatorCountIsRespected() {
        assertEquals(1000, generateDemoState(1000, now, day(TODAY)).tasks.size)
        assertEquals(0, generateDemoState(0, now, day(TODAY)).tasks.size)
    }
}
