package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MembersRecurrenceTest {
    @Test
    fun demoAssigneesAndRecurrenceMatchReference() {
        val state = generateDemoData(300, NOW_MS, TODAY)
        assertEquals(listOf("m1", "m2", "m3", "m4", "m5"), state.members.map { it.id })
        assertEquals("Alex Kim", state.members[0].name)
        assertEquals(
            listOf("m1", null, "m4", "m3", "m4", "m2", "m5", "m2"),
            state.tasks.take(8).map { it.assigneeId },
        )
        assertEquals(Recurrence.WEEKLY, state.tasks[0].recurrence)
        assertEquals(Recurrence.NONE, state.tasks[1].recurrence)
        assertEquals(26, state.tasks.count { it.recurrence == Recurrence.WEEKLY })
        assertEquals(40, state.tasks.count { it.assigneeId == null })
    }

    @Test
    fun baseGeneratorFieldsAreUnchanged() {
        // Stripping the new fields must give exactly the original generator output.
        val t = generateDemoData(5, NOW_MS, TODAY).tasks
        assertEquals("Test landing page #1", t[0].title)
        assertEquals(134, t[0].timeSpentMinutes)
        assertEquals(listOf("docs", "chore"), t[4].tags)
    }

    @Test
    fun initialsAndContrast() {
        assertEquals("AK", initials("Alex Kim"))
        assertEquals("MP", initials("  Morgan  de  Patel "))
        assertEquals("CH", initials("cher"))
        assertEquals("?", initials("  "))
        assertEquals("#111827", readableTextColor("#22c55e"))
        assertEquals("#ffffff", readableTextColor("#1e3a8a"))
    }

    @Test
    fun memberNameValidationAndRemoval() {
        val members = listOf(Member("a", "Alex", "#000000"), Member("b", "Sam", "#ffffff"))
        assertEquals("Name is required.", validateMemberName(" ", members))
        assertTrue(validateMemberName("alex", members)!!.contains("exists"))
        assertNull(validateMemberName("alex", members, editingId = "a"))
        val tasks = listOf(task("1").copy(assigneeId = "a"), task("2").copy(assigneeId = "b"))
        val (t2, m2) = removeMember(tasks, members, "a")
        assertEquals(listOf(null, "b"), t2.map { it.assigneeId })
        assertEquals(listOf("b"), m2.map { it.id })
    }

    @Test
    fun assigneeFilterAndUrl() {
        val tasks = listOf(task("1").copy(assigneeId = "a"), task("2"), task("3").copy(assigneeId = "b"))
        assertEquals(listOf("1"), filterTasks(tasks, TaskQuery(assignee = "a"), TODAY).map { it.id })
        assertEquals(listOf("2"), filterTasks(tasks, TaskQuery(assignee = UNASSIGNED), TODAY).map { it.id })
        val q = TaskQuery(assignee = "b")
        assertEquals(q, TaskQuery.fromParams(q.toParams().toMap()))
    }

    @Test
    fun openPerAssigneeCountsOnlyOpenTasks() {
        val members = listOf(Member("a", "A", "#000000"), Member("b", "B", "#000000"))
        val tasks =
            listOf(
                task("1").copy(assigneeId = "a"),
                task("2", status = Status.DONE).copy(assigneeId = "a"),
                task("3"),
                task("4").copy(assigneeId = "zzz"),
            )
        val load = openPerAssignee(tasks, members)
        assertEquals(listOf(1, 0, 2), load.map { it.open })
        assertNull(load.last().member)
    }

    @Test
    fun nextDueDateAdvancesByInterval() {
        assertEquals("2024-06-13", nextDueDate("2024-06-12", Recurrence.DAILY, TODAY))
        assertEquals("2024-06-19", nextDueDate("2024-06-12", Recurrence.WEEKLY, TODAY))
        assertEquals("2024-02-29", nextDueDate("2024-01-31", Recurrence.MONTHLY, TODAY))
        assertEquals("2025-01-15", nextDueDate("2024-12-15", Recurrence.MONTHLY, TODAY))
        // No due date: advance from today.
        assertEquals(day(7), nextDueDate(null, Recurrence.WEEKLY, TODAY))
    }

    @Test
    fun completingRecurringTaskSpawnsResetCopy() {
        val original =
            task("r", due = day(-1), spent = 50).copy(
                recurrence = Recurrence.WEEKLY,
                assigneeId = "a",
                subtasks = listOf(Subtask("s1", "Step 1", true), Subtask("s2", "Step 2", false)),
            )
        val before = listOf(original, task("other", order = 3))
        val after = before.map { if (it.id == "r") it.withStatus(Status.DONE, iso(0)) else it }
        val result = spawnRecurrences(before, after, iso(0), TODAY) { "copy-of-${it.id}" }
        assertEquals(3, result.size)
        val copy = result.last()
        assertEquals("copy-of-r", copy.id)
        assertEquals(Status.TODO, copy.status)
        assertNull(copy.completedAt)
        assertEquals(day(6), copy.dueDate)
        assertEquals(0, copy.timeSpentMinutes)
        assertEquals(listOf(false, false), copy.subtasks.map { it.done })
        assertEquals("a", copy.assigneeId)
        assertEquals(Recurrence.WEEKLY, copy.recurrence)
        assertEquals(4, copy.order)
        // Non-recurring tasks and already-done tasks do not spawn copies.
        assertEquals(after, spawnRecurrences(after, after, iso(0), TODAY) { "x" })
        val plain = listOf(task("p"))
        val plainDone = plain.map { it.withStatus(Status.DONE, iso(0)) }
        assertEquals(plainDone, spawnRecurrences(plain, plainDone, iso(0), TODAY) { "x" })
    }

    @Test
    fun undoRevertsCompletionAndCopyTogether() {
        val before = listOf(task("r").copy(recurrence = Recurrence.DAILY))
        val after = spawnRecurrences(before, before.map { it.withStatus(Status.DONE, iso(0)) }, iso(0), TODAY) { "n" }
        val h = History(before).push(after)
        assertEquals(2, h.present.size)
        assertEquals(before, h.undo().present)
    }

    @Test
    fun importHandlesMembersAndLegacyData() {
        val legacy =
            """{"projects":[],"tasks":[{"id":"t","title":"Old","status":"todo","priority":"low","createdAt":"2024-01-01T00:00:00Z"}]}"""
        val ok = importState(legacy)
        assertIs<ImportResult.Ok>(ok)
        assertEquals(Recurrence.NONE, ok.state.tasks[0].recurrence)
        assertTrue(ok.state.members.isEmpty())
        val withMember =
            """{"projects":[],"members":[{"id":"m1","name":"Alex","color":"#0ea5e9"}],
               "tasks":[{"id":"t","title":"x","status":"todo","priority":"low","createdAt":"2024-01-01T00:00:00Z",
               "assigneeId":"m1","recurrence":"monthly"}]}"""
        val ok2 = importState(withMember)
        assertIs<ImportResult.Ok>(ok2)
        assertEquals(Recurrence.MONTHLY, ok2.state.tasks[0].recurrence)
        val bad = importState(withMember.replace("\"assigneeId\":\"m1\"", "\"assigneeId\":\"ghost\""))
        assertIs<ImportResult.Error>(bad)
        assertTrue(bad.message.contains("assigneeId"))
        val badRec = importState(withMember.replace("monthly", "yearly"))
        assertIs<ImportResult.Error>(badRec)
        // Persisted JSON from before this change (no members/assigneeId/recurrence) decodes with defaults.
        val decoded = AppJson.decodeFromString(AppState.serializer(), legacy)
        assertNull(decoded.tasks[0].assigneeId)
        assertTrue(decoded.members.isEmpty())
    }
}
