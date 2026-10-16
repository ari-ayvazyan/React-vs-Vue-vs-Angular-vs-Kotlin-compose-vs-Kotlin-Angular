package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class BoardTest {
    private val tasks =
        listOf(
            task("a", status = Status.TODO, order = 0),
            task("b", status = Status.TODO, order = 1),
            task("c", status = Status.TODO, order = 2),
            task("d", status = Status.DONE, order = 0, completedAt = iso(-1)),
        )

    private fun col(list: List<Task>, s: Status) = columnTasks(list, s).map { it.id }

    @Test
    fun movesBetweenColumnsAndSetsCompletedAt() {
        val moved = moveTask(tasks, "b", Status.DONE, 0, iso(0))
        assertEquals(listOf("a", "c"), col(moved, Status.TODO))
        assertEquals(listOf("b", "d"), col(moved, Status.DONE))
        assertEquals(iso(0), moved.first { it.id == "b" }.completedAt)
        assertEquals(listOf(0, 1), columnTasks(moved, Status.TODO).map { it.order })
        val back = moveTask(moved, "d", Status.IN_PROGRESS, 0, iso(0))
        assertNull(back.first { it.id == "d" }.completedAt)
    }

    @Test
    fun reordersWithinColumnAndByKeyboard() {
        val moved = moveTask(tasks, "a", Status.TODO, 2, iso(0))
        assertEquals(listOf("b", "c", "a"), col(moved, Status.TODO))
        val up = moveTaskByKeyboard(tasks, "c", 0, -1, iso(0))
        assertEquals(listOf("a", "c", "b"), col(up, Status.TODO))
        val right = moveTaskByKeyboard(tasks, "a", 1, 0, iso(0))
        assertEquals(listOf("a"), col(right, Status.IN_PROGRESS))
        // Cannot move past the first column / top of column.
        assertEquals(tasks, moveTaskByKeyboard(tasks, "a", -1, 0, iso(0)))
        assertEquals(tasks, moveTaskByKeyboard(tasks, "a", 0, -1, iso(0)))
        assertNotNull(moveTaskByKeyboard(tasks, "d", 0, 1, iso(0)))
    }
}
