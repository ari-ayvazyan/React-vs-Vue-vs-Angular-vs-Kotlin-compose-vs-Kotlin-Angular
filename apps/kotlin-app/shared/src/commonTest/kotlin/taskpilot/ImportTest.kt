package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ImportTest {
    private val valid =
        """
        {"projects":[{"id":"p1","name":"Web","color":"#112233","createdAt":"2024-01-01T00:00:00.000Z"}],
         "tasks":[{"id":"t1","title":"Hello","description":"","status":"done","priority":"high","projectId":"p1",
                   "tags":["A","b"],"dueDate":"2024-02-01","estimateMinutes":30,"timeSpentMinutes":5,
                   "subtasks":[{"id":"s1","title":"Step","done":true}],
                   "createdAt":"2024-01-01T00:00:00.000Z","completedAt":"2024-01-02T00:00:00.000Z","order":0}],
         "settings":{"theme":"dark","pomodoroMinutes":30,"pageSize":50}}
        """.trimIndent()

    @Test
    fun acceptsValidDocument() {
        val r = importState(valid)
        assertIs<ImportResult.Ok>(r)
        assertEquals(1, r.state.tasks.size)
        assertEquals(listOf("a", "b"), r.state.tasks[0].tags)
        assertEquals(ThemeMode.DARK, r.state.settings.theme)
    }

    @Test
    fun rejectsMalformedJsonAndWrongShapes() {
        assertIs<ImportResult.Error>(importState("{not json"))
        assertIs<ImportResult.Error>(importState("[]"))
        val missing = importState("""{"projects":[]}""")
        assertIs<ImportResult.Error>(missing)
        assertTrue(missing.message.contains("tasks"))
    }

    @Test
    fun reportsOffendingFieldPath() {
        val bad = importState(valid.replace("\"status\":\"done\"", "\"status\":\"finished\""))
        assertIs<ImportResult.Error>(bad)
        assertTrue(bad.message.contains("tasks[0].status"), bad.message)
        val badProject = importState(valid.replace("\"projectId\":\"p1\"", "\"projectId\":\"zzz\""))
        assertIs<ImportResult.Error>(badProject)
        assertTrue(badProject.message.contains("tasks[0].projectId"))
        val badDate = importState(valid.replace("2024-02-01", "02/01/2024"))
        assertIs<ImportResult.Error>(badDate)
        assertTrue(badDate.message.contains("dueDate"))
        val badEstimate = importState(valid.replace("\"estimateMinutes\":30", "\"estimateMinutes\":-3"))
        assertIs<ImportResult.Error>(badEstimate)
    }
}
