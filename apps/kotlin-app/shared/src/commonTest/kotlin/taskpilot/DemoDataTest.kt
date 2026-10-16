package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DemoDataTest {
    @Test
    fun mulberry32MatchesJavaScriptReference() {
        val r = mulberry32(42)
        assertEquals(0.6011037519201636, r())
        assertEquals(0.44829055899754167, r())
        assertEquals(0.8524657934904099, r())
    }

    @Test
    fun generatorIsDeterministic() {
        val a = generateDemoData(300, NOW_MS, TODAY)
        val b = generateDemoData(300, NOW_MS, TODAY)
        assertEquals(a, b)
        assertEquals(300, a.tasks.size)
        assertEquals(6, a.projects.size)
        assertEquals(listOf("Website", "Mobile App", "Marketing", "Infrastructure", "Hiring", "Personal"), a.projects.map { it.name })
    }

    @Test
    fun generatorMatchesReferenceSequence() {
        val tasks = generateDemoData(5, NOW_MS, TODAY).tasks
        assertEquals(
            listOf(
                "Test landing page #1",
                "Refactor invoice export #2",
                "Deploy landing page #3",
                "Deploy CI pipeline #4",
                "Fix onboarding #5",
            ),
            tasks.map { it.title },
        )
        val first = tasks[0]
        assertEquals(Status.TODO, first.status)
        assertEquals(Priority.HIGH, first.priority)
        assertEquals("proj-4", first.projectId)
        assertEquals(listOf("frontend"), first.tags)
        assertEquals(day(3), first.dueDate)
        assertEquals(240, first.estimateMinutes)
        assertEquals(134, first.timeSpentMinutes)
        assertEquals(listOf(true), first.subtasks.map { it.done })
        val done = tasks[3]
        assertEquals(Status.DONE, done.status)
        assertEquals(iso(-56 + 4), done.completedAt)
        assertEquals(listOf("docs", "chore"), tasks[4].tags)
        assertEquals("Demo task 5", tasks[4].description)
    }

    @Test
    fun generatedDataIsValid() {
        val state = generateDemoData(1000, NOW_MS, TODAY)
        state.tasks.forEach { t ->
            assertTrue(t.tags.size <= 3)
            assertTrue((t.status == Status.DONE) == (t.completedAt != null))
            t.completedAt?.let { assertTrue(Dates.millisFromIso(it)!! <= NOW_MS) }
        }
        // Round-trips through export/import validation.
        val imported = importState(exportState(state))
        assertTrue(imported is ImportResult.Ok)
        assertEquals(state, imported.state)
    }
}
