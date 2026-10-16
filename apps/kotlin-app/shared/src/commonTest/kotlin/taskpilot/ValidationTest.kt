package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ValidationTest {
    @Test
    fun requiresTitleAndLimitsLength() {
        val empty = validateDraft(TaskDraft(title = "   "))
        assertIs<DraftResult.Invalid>(empty)
        assertTrue("title" in empty.errors)
        val long = validateDraft(TaskDraft(title = "x".repeat(121)))
        assertIs<DraftResult.Invalid>(long)
        assertIs<DraftResult.Ok>(validateDraft(TaskDraft(title = "x".repeat(120))))
    }

    @Test
    fun validatesDescriptionTagsAndEstimate() {
        val r =
            validateDraft(
                TaskDraft(
                    title = "ok",
                    description = "d".repeat(2001),
                    tagsText = "a,b,c,d,e,f,g,h,i",
                    estimateText = "-5",
                    dueDate = "2024-02-30",
                ),
            )
        assertIs<DraftResult.Invalid>(r)
        assertEquals(setOf("description", "tags", "estimate", "dueDate"), r.errors.keys)
        assertIs<DraftResult.Invalid>(validateDraft(TaskDraft(title = "ok", estimateText = "1.5")))
        assertIs<DraftResult.Invalid>(validateDraft(TaskDraft(title = "ok", estimateText = "0")))
    }

    @Test
    fun normalisesTags() {
        assertEquals(listOf("bug", "ui", "backend"), parseTags("Bug, ui  #backend, BUG,,"))
        val ok = validateDraft(TaskDraft(title = "  Trim me ", tagsText = "A, a", estimateText = "45"))
        assertIs<DraftResult.Ok>(ok)
        assertEquals("Trim me", ok.value.title)
        assertEquals(listOf("a"), ok.value.tags)
        assertEquals(45, ok.value.estimateMinutes)
    }
}
