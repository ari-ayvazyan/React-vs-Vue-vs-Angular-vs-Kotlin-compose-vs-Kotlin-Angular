package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StoreTest {
    private fun emptyStore(): TaskStore {
        val (store, _) = memoryStore("""{"tasks":[],"projects":[],"settings":{"theme":"dark","pomodoroMinutes":25,"pageSize":25}}""")
        store.initialize("")
        return store
    }

    @Test
    fun seedsDemoDataOnEmptyStorageAndPersists() {
        val (store, saved) = memoryStore()
        assertEquals(-1, store.initialize(""))
        assertEquals(300, store.state.tasks.size)
        assertNotNull(saved())
        assertEquals(1000, store.initialize("?seed=1000"))
        assertEquals(1000, store.state.tasks.size)
    }

    @Test
    fun loadsPersistedStateAndSettings() {
        val store = emptyStore()
        assertEquals(0, store.state.tasks.size)
        assertEquals(Theme.DARK, store.state.settings.theme)
    }

    @Test
    fun createUpdateAndCompletedAtInvariant() {
        val store = emptyStore()
        val id = store.createTask(draft("Write tests", tags = "Kotlin, TEST"))
        val t = store.state.findTask(id)!!
        assertEquals(listOf("kotlin", "test"), t.tags.toList())
        assertNull(t.completedAt)
        store.toggleDone(id)
        assertNotNull(store.state.findTask(id)!!.completedAt)
        store.toggleDone(id)
        assertNull(store.state.findTask(id)!!.completedAt)
        assertEquals("", store.createTask(draft("")))
        assertTrue(store.updateTask(id, draft("Renamed", status = Status.IN_PROGRESS)))
        assertEquals("Renamed", store.state.findTask(id)!!.title)
    }

    @Test
    fun undoRedoRestoresTasksAndProjects() {
        val store = emptyStore()
        val a = store.createTask(draft("A"))
        store.createTask(draft("B"))
        store.deleteTask(a)
        assertEquals(1, store.state.tasks.size)
        assertEquals("Delete task", store.undo())
        assertEquals(2, store.state.tasks.size)
        assertTrue(store.canRedo)
        store.redo()
        assertEquals(1, store.state.tasks.size)
        store.undo()
        store.createTask(draft("C"))
        assertFalse(store.canRedo, "new mutation clears redo stack")
        val p = store.createProject("Web", "#123456")
        store.deleteProject(p, false)
        store.undo()
        assertNotNull(store.state.findProject(p))
    }

    @Test
    fun historyDepthIsBoundedTo50() {
        val store = emptyStore()
        repeat(60) { store.createTask(draft("T$it")) }
        var undos = 0
        while (store.canUndo) {
            store.undo()
            undos++
        }
        assertEquals(50, undos)
        assertEquals(10, store.state.tasks.size)
    }

    @Test
    fun settingsAreNotUndoable() {
        val store = emptyStore()
        store.createTask(draft("A"))
        store.setPageSize(50)
        store.undo()
        assertEquals(50, store.state.settings.pageSize)
        assertEquals(0, store.state.tasks.size)
    }

    @Test
    fun bulkActions() {
        val store = emptyStore()
        val ids = (1..4).map { store.createTask(draft("T$it")) }.toTypedArray()
        val p = store.createProject("Ops", "#10b981")
        assertEquals(2, store.markDone(arrayOf(ids[0], ids[1])))
        assertEquals(3, store.moveToProject(arrayOf(ids[0], ids[1], ids[2]), p))
        assertEquals(3, store.state.tasks.count { it.projectId == p })
        store.deleteProject(p, true)
        assertEquals(1, store.state.tasks.size)
    }

    @Test
    fun boardMovesUpdateStatusAndOrder() {
        val store = emptyStore()
        val a = store.createTask(draft("A"))
        val b = store.createTask(draft("B"))
        val c = store.createTask(draft("C"))
        store.moveTask(c, Status.TODO, a)
        assertEquals(listOf(c, a, b), boardColumn(store.state, Status.TODO, "", "").map { it.id })
        store.moveTask(a, Status.DONE, null)
        assertEquals(Status.DONE, store.state.findTask(a)!!.status)
        assertNotNull(store.state.findTask(a)!!.completedAt)
        assertEquals(listOf(0, 1), boardColumn(store.state, Status.TODO, "", "").map { it.order })
        assertTrue(store.moveTaskBy(b, 0, -1, TaskQuery.DEFAULT, TODAY))
        assertEquals(listOf(b, c), boardColumn(store.state, Status.TODO, "", "").map { it.id })
        assertTrue(store.moveTaskBy(b, 1, 0, TaskQuery.DEFAULT, TODAY))
        assertEquals(Status.IN_PROGRESS, store.state.findTask(b)!!.status)
        assertFalse(store.moveTaskBy(a, 1, 0, TaskQuery.DEFAULT, TODAY))
    }

    @Test
    fun subtasksAndTimeTracking() {
        val store = emptyStore()
        val id = store.createTask(draft("A"))
        assertTrue(store.addSubtask(id, "Step"))
        assertFalse(store.addSubtask(id, "  "))
        val sub =
            store.state
                .findTask(id)!!
                .subtasks
                .single()
        store.toggleSubtask(id, sub.id)
        assertEquals(1, store.state.findTask(id)!!.subtasksDone)
        store.addTimeSpent(id, 25)
        assertEquals(25, store.state.findTask(id)!!.timeSpentMinutes)
    }

    @Test
    fun importReplacesStateAndIsUndoable() {
        val store = emptyStore()
        store.createTask(draft("A"))
        val other = generateDemoState(5, parseInstant("2026-10-16T12:00:00.000Z")!!, day(TODAY))
        assertTrue(store.importJson(serializeState(other, true)).ok)
        assertEquals(5, store.state.tasks.size)
        store.undo()
        assertEquals(1, store.state.tasks.size)
        assertFalse(store.importJson("{}").ok)
        assertEquals(1, store.state.tasks.size)
    }
}
