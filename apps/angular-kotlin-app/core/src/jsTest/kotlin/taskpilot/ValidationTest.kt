package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ValidationTest {
    @Test
    fun draftValidationReportsInlineErrors() {
        assertTrue(validateTaskDraft(draft("Ok", tags = "a, b", estimate = "30")).valid)
        assertEquals("Title is required.", validateTaskDraft(draft("   ")).error("title"))
        assertTrue(validateTaskDraft(draft("x".repeat(121))).error("title").isNotEmpty())
        assertTrue(validateTaskDraft(draft("Ok", description = "d".repeat(2001))).error("description").isNotEmpty())
        assertTrue(validateTaskDraft(draft("Ok", tags = "a b c d e f g h i")).error("tags").isNotEmpty())
        assertTrue(validateTaskDraft(draft("Ok", estimate = "0")).error("estimate").isNotEmpty())
        assertTrue(validateTaskDraft(draft("Ok", estimate = "1.5")).error("estimate").isNotEmpty())
        assertTrue(validateTaskDraft(draft("Ok", due = "2026-02-31")).error("dueDate").isNotEmpty())
    }

    @Test
    fun tagsAreNormalized() {
        assertEquals(listOf("bug", "ui"), parseTags(" #Bug, ui  BUG ,").toList())
    }

    @Test
    fun importAcceptsExportedData() {
        val state = generateDemoState(20, parseInstant("2026-10-16T12:00:00.000Z")!!, day(TODAY))
        val result = parseImport(serializeState(state, true))
        assertTrue(result.ok, result.error)
        assertEquals(20, result.taskCount)
        assertEquals(serializeState(state, false), serializeState(result.state!!, false))
    }

    @Test
    fun importRejectsInvalidInputWithClearMessages() {
        assertFalse(parseImport("not json").ok)
        assertTrue(parseImport("not json").error.contains("not valid JSON"))
        assertTrue(parseImport("[]").error.contains("Root must be an object"))
        assertTrue(parseImport("""{"projects":[],"tasks":{}}""").error.contains("root.tasks must be an array"))
        val badPriority =
            """{"projects":[],"tasks":[{"id":"a","title":"T","description":"","status":"todo","priority":"extreme",
            |"projectId":null,"tags":[],"dueDate":null,"estimateMinutes":null,"timeSpentMinutes":0,"subtasks":[],
            |"createdAt":"2026-10-01T00:00:00.000Z","completedAt":null,"order":0}]}
            """.trimMargin()
        val r = parseImport(badPriority)
        assertFalse(r.ok)
        assertTrue(r.error.contains("tasks[0].priority"), r.error)
        val badProject = badPriority.replace("\"extreme\"", "\"low\"").replace("\"projectId\":null", "\"projectId\":\"zzz\"")
        assertTrue(parseImport(badProject).error.contains("does not match any project"))
        val ok = parseImport(badPriority.replace("\"extreme\"", "\"low\""))
        assertTrue(ok.ok, ok.error)
        assertNotNull(ok.state)
        assertEquals(Settings.DEFAULT.pageSize, ok.state!!.settings.pageSize)
    }

    @Test
    fun projectValidation() {
        assertEquals("", validateProject("Web", "#aabbcc"))
        assertTrue(validateProject(" ", "#aabbcc").isNotEmpty())
        assertTrue(validateProject("Web", "red").isNotEmpty())
    }

    @Test
    fun themeResolutionAndToggle() {
        assertEquals(Theme.DARK, Theme.resolve(Theme.SYSTEM, true))
        assertEquals(Theme.LIGHT, Theme.resolve(Theme.SYSTEM, false))
        assertEquals(Theme.DARK, Theme.toggle(Theme.SYSTEM, false))
        assertEquals(Theme.LIGHT, Theme.toggle(Theme.SYSTEM, true))
        assertEquals(Theme.LIGHT, Theme.toggle(Theme.DARK, false))
    }
}
