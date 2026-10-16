package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class QueryTest {
    private val tasks =
        listOf(
            task("a", title = "Fix login bug", status = Status.TODO, priority = Priority.URGENT, due = day(-2), tags = listOf("bug")),
            task("b", title = "Write docs", status = Status.DONE, priority = Priority.LOW, due = day(-5), projectId = "p1"),
            task("c", title = "Design dashboard", status = Status.IN_PROGRESS, priority = Priority.HIGH, due = day(0), projectId = "p1"),
            task("d", title = "plan release", description = "Coordinate the LOGIN migration", priority = Priority.MEDIUM, due = null),
            task("e", title = "Refactor search", priority = Priority.LOW, due = day(4), tags = listOf("backend", "research")),
        )

    private fun ids(q: TaskQuery) = filterTasks(tasks, q, TODAY).map { it.id }

    @Test
    fun filtersByStatusAndPriority() {
        assertEquals(listOf("a", "d", "e"), ids(TaskQuery(statuses = setOf(Status.TODO))))
        assertEquals(listOf("b", "e"), ids(TaskQuery(priorities = setOf(Priority.LOW))))
        assertEquals(listOf("e"), ids(TaskQuery(statuses = setOf(Status.TODO), priorities = setOf(Priority.LOW))))
    }

    @Test
    fun filtersByProjectTagAndDue() {
        assertEquals(listOf("b", "c"), ids(TaskQuery(project = "p1")))
        assertEquals(listOf("a", "d", "e"), ids(TaskQuery(project = NO_PROJECT)))
        assertEquals(listOf("e"), ids(TaskQuery(tag = "backend")))
        // b is done so it is not overdue even though its date passed.
        assertEquals(listOf("a"), ids(TaskQuery(due = DueFilter.OVERDUE)))
        assertEquals(listOf("c"), ids(TaskQuery(due = DueFilter.TODAY)))
        assertEquals(listOf("d"), ids(TaskQuery(due = DueFilter.NONE)))
        // Week of Wed 2024-06-12 is Mon 06-10 .. Sun 06-16.
        assertEquals(listOf("a", "c", "e"), ids(TaskQuery(due = DueFilter.WEEK)))
    }

    @Test
    fun searchIsCaseInsensitiveAcrossTitleDescriptionAndTags() {
        assertEquals(listOf("a", "d"), ids(TaskQuery(search = "login")))
        assertEquals(listOf("e"), ids(TaskQuery(search = "RESEARCH")))
        assertEquals(listOf("a"), ids(TaskQuery(search = "fix bug")))
        assertEquals(emptyList(), ids(TaskQuery(search = "nothing-matches")))
        assertTrue(tasks[0].matchesSearch("   "))
        assertFalse(tasks[0].matchesSearch("docs"))
    }

    @Test
    fun sortsByEachFieldAndDirection() {
        assertEquals(listOf("b", "a", "c", "e", "d"), sortTasks(tasks, SortField.DUE, true).map { it.id })
        assertEquals(listOf("e", "c", "a", "b", "d"), sortTasks(tasks, SortField.DUE, false).map { it.id })
        assertEquals("a", sortTasks(tasks, SortField.PRIORITY, false).first().id)
        assertEquals(listOf("c", "a", "d", "e", "b"), sortTasks(tasks, SortField.TITLE, true).map { it.id })
        val created = listOf(task("x", createdAt = iso(-1)), task("y", createdAt = iso(-3)))
        assertEquals(listOf("y", "x"), sortTasks(created, SortField.CREATED, true).map { it.id })
    }

    @Test
    fun queryRoundTripsThroughUrlParams() {
        val q =
            TaskQuery(
                search = "login",
                statuses = setOf(Status.DONE, Status.TODO),
                priorities = setOf(Priority.HIGH),
                project = "p1",
                tag = "bug",
                due = DueFilter.WEEK,
                sort = SortField.TITLE,
                ascending = false,
                page = 3,
            )
        val params = q.toParams()
        assertEquals("todo,done", params.toMap()["status"])
        assertEquals(q, TaskQuery.fromParams(params.toMap()))
        assertEquals(emptyList(), TaskQuery().toParams())
        assertEquals(TaskQuery(), TaskQuery.fromParams(mapOf("status" to "bogus", "page" to "-4", "due" to "never")))
    }

    @Test
    fun paginationClampsPage() {
        val items = (1..53).toList()
        val p = paginate(items, 3, 25)
        assertEquals(3, p.pageCount)
        assertEquals(listOf(51, 52, 53), p.items)
        assertEquals(1, paginate(items, 0, 25).page)
        assertEquals(3, paginate(items, 99, 25).page)
        assertEquals(1, paginate(emptyList<Int>(), 1, 25).pageCount)
    }
}
