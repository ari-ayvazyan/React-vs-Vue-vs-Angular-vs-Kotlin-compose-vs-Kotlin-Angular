package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class QueryTest {
    private val tasks =
        arrayOf(
            task("1", title = "Fix login", priority = Priority.URGENT, dueDate = "2026-10-10", tags = arrayOf("bug")),
            task("2", title = "Write docs", status = Status.DONE, dueDate = "2026-10-10", description = "API reference"),
            task("3", title = "Plan sprint", priority = Priority.LOW, dueDate = TODAY, projectId = "p1"),
            task("4", title = "Design board", status = Status.IN_PROGRESS, dueDate = "2026-10-18", tags = arrayOf("design")),
            task("5", title = "Research", priority = Priority.HIGH, projectId = "p1"),
        )

    private fun ids(q: TaskQuery) = queryTasks(stateOf(tasks), q, TODAY, 100).items.map { it.id }

    @Test
    fun filtersByStatusAndPriority() {
        val q = TaskQuery.DEFAULT.withStatusToggled(Status.TODO)
        assertEquals(setOf("1", "3", "5"), ids(q).toSet())
        assertEquals(listOf("5"), ids(q.withPriorityToggled(Priority.HIGH)))
    }

    @Test
    fun filtersByDueBuckets() {
        assertEquals(listOf("1"), ids(TaskQuery.DEFAULT.withDue(DueFilter.OVERDUE)))
        assertEquals(listOf("3"), ids(TaskQuery.DEFAULT.withDue(DueFilter.TODAY)))
        assertEquals(setOf("3", "4"), ids(TaskQuery.DEFAULT.withDue(DueFilter.THIS_WEEK)).toSet())
        assertEquals(listOf("5"), ids(TaskQuery.DEFAULT.withDue(DueFilter.NO_DATE)))
    }

    @Test
    fun filtersByProjectAndTag() {
        assertEquals(setOf("3", "5"), ids(TaskQuery.DEFAULT.withProject("p1")).toSet())
        assertEquals(3, ids(TaskQuery.DEFAULT.withProject(NO_PROJECT)).size)
        assertEquals(listOf("4"), ids(TaskQuery.DEFAULT.withTag("design")))
    }

    @Test
    fun searchCoversTitleDescriptionAndTagsCaseInsensitively() {
        assertEquals(listOf("1"), ids(TaskQuery.DEFAULT.withSearch("LOGIN")))
        assertEquals(listOf("2"), ids(TaskQuery.DEFAULT.withSearch("api reference")))
        assertEquals(listOf("1"), ids(TaskQuery.DEFAULT.withSearch("bug")))
        assertEquals(emptyList(), ids(TaskQuery.DEFAULT.withSearch("login docs")))
    }

    @Test
    fun sortsByPriorityTitleAndDueWithNullsLast() {
        assertEquals("1", ids(TaskQuery.DEFAULT.withSort(SortKey.PRIORITY)).first())
        assertEquals("3", ids(TaskQuery.DEFAULT.withSort(SortKey.PRIORITY).withDir("asc")).first())
        assertEquals(listOf("4", "1", "3", "5", "2"), ids(TaskQuery.DEFAULT.withSort(SortKey.TITLE)))
        val due = ids(TaskQuery.DEFAULT)
        assertEquals("5", due.last())
        assertEquals("5", ids(TaskQuery.DEFAULT.withDir("desc")).last())
    }

    @Test
    fun paginatesAndClampsPage() {
        val page = queryTasks(stateOf(tasks), TaskQuery.DEFAULT.withPage(2), TODAY, 2)
        assertEquals(3, page.pageCount)
        assertEquals(2, page.items.size)
        assertEquals(3, page.from)
        val clamped = queryTasks(stateOf(tasks), TaskQuery.DEFAULT.withPage(99), TODAY, 2)
        assertEquals(3, clamped.page)
        assertEquals(1, clamped.items.size)
    }

    @Test
    fun queryStringRoundTrip() {
        val q =
            TaskQuery.DEFAULT
                .withStatusToggled(Status.DONE)
                .withStatusToggled(Status.TODO)
                .withPriorityToggled(Priority.URGENT)
                .withSearch("fix & ship")
                .withProject("p1")
                .withTag("bug")
                .withDue(DueFilter.OVERDUE)
                .withSort(SortKey.TITLE)
                .withPage(3)
        val parsed = TaskQuery.parse("?" + q.toQueryString())
        assertEquals(q.toQueryString(), parsed.toQueryString())
        assertEquals(listOf(Status.TODO, Status.DONE), parsed.statuses.toList())
        assertEquals("fix & ship", parsed.search)
        assertEquals(3, parsed.page)
        assertEquals("", TaskQuery.DEFAULT.toQueryString())
        assertTrue(TaskQuery.parse("status=bogus&sort=nope&page=-4").toQueryString().isEmpty())
    }

    @Test
    fun seedParamIsParsed() {
        assertEquals(1000, readSeedParam("?seed=1000"))
        assertEquals(null, readSeedParam("?q=x"))
        assertEquals(null, readSeedParam("?seed=abc"))
    }
}
