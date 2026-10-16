package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TeamAndRecurrenceTest {
    private val now = parseInstant("2026-10-16T12:00:00.000Z")!!

    private fun emptyStore(): TaskStore {
        val (store, _) = memoryStore("""{"tasks":[],"projects":[],"settings":{"theme":"light","pomodoroMinutes":25,"pageSize":25}}""")
        store.initialize("")
        return store
    }

    /** FNV-1a over the fields produced by the original (seed 42) generator, compared with a JS reference run. */
    @Test
    fun originalGeneratorStreamIsUnchanged() {
        val today = day(TODAY)
        val s = generateDemoState(300, now, today)
        val text =
            s.tasks.joinToString("\n") { t ->
                val created = ((now - parseInstant(t.createdAt)!!) / CivilDate.MS_PER_DAY).toInt()
                val completed =
                    t.completedAt?.let { ((parseInstant(it)!! - parseInstant(t.createdAt)!!) / CivilDate.MS_PER_DAY).toInt().toString() }
                listOf(
                    t.title,
                    t.status,
                    t.priority,
                    t.projectId.orEmpty(),
                    t.tags.joinToString("+"),
                    t.dueDate?.let { (day(it) - today).toString() }.orEmpty(),
                    created.toString(),
                    completed.orEmpty(),
                    t.estimateMinutes.toString(),
                    t.timeSpentMinutes.toString(),
                    t.subtasks.joinToString("+") { it.done.toString() },
                ).joinToString("|")
            }
        var h = 0x811c9dc5.toInt()
        for (c in text) {
            h = h xor c.code
            h *= 0x01000193
        }
        assertEquals(3254746679.0, h.toUInt().toDouble())
    }

    @Test
    fun demoMembersAndAssignmentsFollowSecondPrng() {
        val s = generateDemoState(300, now, day(TODAY))
        assertEquals(listOf("m1", "m2", "m3", "m4", "m5"), s.members.map { it.id })
        assertEquals("Alex Kim", s.members[0].name)
        assertEquals("#ef4444", s.members[4].color)
        // JS reference for mulberry32(7): (k, weekly) = (0,true) (5,false) (3,false) (2,false) (3,false) (1,false)
        assertEquals(listOf("m1", null, "m4", "m3", "m4", "m2"), s.tasks.take(6).map { it.assigneeId })
        assertEquals(Recurrence.WEEKLY, s.tasks[0].recurrence)
        assertEquals(Recurrence.NONE, s.tasks[1].recurrence)
        assertEquals(26, s.tasks.count { it.recurrence == Recurrence.WEEKLY })
        assertEquals(40, s.tasks.count { it.assigneeId == null })
    }

    @Test
    fun initialsAndContrast() {
        assertEquals("AK", initialsOf("Alex Kim"))
        assertEquals("JM", initialsOf("  jane   van der  Meer "))
        assertEquals("CH", initialsOf("cher"))
        assertEquals("?", initialsOf(" "))
        assertEquals("#ffffff", readableTextColor("#1d4ed8"))
        assertEquals("#0f172a", readableTextColor("#22c55e"))
    }

    @Test
    fun nextOccurrenceDates() {
        val today = day(TODAY)
        assertEquals("2026-10-11", formatDay(nextOccurrenceDay("2026-10-10", Recurrence.DAILY, today)!!))
        assertEquals("2026-10-17", formatDay(nextOccurrenceDay("2026-10-10", Recurrence.WEEKLY, today)!!))
        assertEquals("2026-02-28", formatDay(nextOccurrenceDay("2026-01-31", Recurrence.MONTHLY, today)!!))
        assertEquals("2024-02-29", formatDay(nextOccurrenceDay("2024-01-31", Recurrence.MONTHLY, today)!!))
        assertEquals("2027-01-15", formatDay(nextOccurrenceDay("2026-12-15", Recurrence.MONTHLY, today)!!))
        assertEquals("2026-10-23", formatDay(nextOccurrenceDay(null, Recurrence.WEEKLY, today)!!))
        assertNull(nextOccurrenceDay("2026-10-10", Recurrence.NONE, today))
    }

    @Test
    fun completingRecurringTaskSpawnsCopyAndSingleUndoRevertsBoth() {
        val store = emptyStore()
        val m = store.createMember("Alex Kim", "#0ea5e9")
        val id = store.createTask(draft("Water plants", due = "2026-10-10", recurrence = Recurrence.WEEKLY, assignee = m))
        store.addSubtask(id, "Kitchen")
        store.toggleSubtask(
            id,
            store.state
                .findTask(id)!!
                .subtasks[0]
                .id,
        )
        store.addTimeSpent(id, 30)
        store.toggleDone(id)
        assertEquals(2, store.state.tasks.size)
        assertEquals(1, store.lastSpawned.size)
        val copy = store.state.findTask(store.lastSpawned[0])!!
        assertEquals(Status.TODO, copy.status)
        assertEquals("2026-10-17", copy.dueDate)
        assertEquals(0, copy.timeSpentMinutes)
        assertEquals(listOf(false), copy.subtasks.map { it.done })
        assertEquals(m, copy.assigneeId)
        assertEquals(Recurrence.WEEKLY, copy.recurrence)
        assertNull(copy.completedAt)
        assertEquals(Status.DONE, store.state.findTask(id)!!.status)

        assertEquals("Complete task", store.undo())
        assertEquals(1, store.state.tasks.size)
        assertEquals(Status.TODO, store.state.findTask(id)!!.status)
        store.redo()
        assertEquals(2, store.state.tasks.size)
    }

    @Test
    fun everyCompletionPathSpawns() {
        val store = emptyStore()
        val a = store.createTask(draft("A", recurrence = Recurrence.DAILY))
        val b = store.createTask(draft("B", recurrence = Recurrence.MONTHLY))
        val c = store.createTask(draft("C"))
        store.markDone(arrayOf(a, c))
        assertEquals(4, store.state.tasks.size, "bulk: only the recurring one spawns")
        store.moveTask(b, Status.DONE, null)
        assertEquals(5, store.state.tasks.size, "board drop into done spawns")
        val d = store.createTask(draft("D", recurrence = Recurrence.WEEKLY))
        store.updateTask(d, draft("D", status = Status.DONE, recurrence = Recurrence.WEEKLY))
        assertEquals(7, store.state.tasks.size, "edit form status change spawns")
        store.setStatus(c, Status.TODO)
        assertEquals(7, store.state.tasks.size, "non-recurring reopen does not spawn")
    }

    @Test
    fun memberCrudAndDeleteUnassigns() {
        val store = emptyStore()
        assertEquals("", store.createMember(" ", "#000000"))
        val m = store.createMember("Sam Rivera", "#f97316")
        val t = store.createTask(draft("T", assignee = m))
        assertEquals(m, store.state.findTask(t)!!.assigneeId)
        assertTrue(store.updateMember(m, "Sam R.", "#22c55e"))
        assertEquals("SR", store.state.findMember(m)!!.initials)
        assertEquals(1, store.deleteMember(m))
        assertNull(store.state.findTask(t)!!.assigneeId)
        assertEquals(0, store.state.members.size)
        store.undo()
        assertEquals(m, store.state.findTask(t)!!.assigneeId, "undo restores member and assignment")
        assertNotNull(store.state.findMember(m))
        assertEquals(1, store.assignTasks(arrayOf(t), UNASSIGNED))
        assertNull(store.state.findTask(t)!!.assigneeId)
    }

    @Test
    fun assigneeFilterOnListBoardAndCalendar() {
        val tasks =
            arrayOf(
                task("1", assigneeId = "m1", dueDate = TODAY),
                task("2", assigneeId = "m2", dueDate = TODAY),
                task("3", dueDate = TODAY),
            )
        val q = TaskQuery.DEFAULT.withAssignee("m1")
        assertEquals(listOf("1"), queryTasks(stateOf(tasks), q, TODAY, 10).items.map { it.id })
        assertEquals(listOf("3"), queryTasks(stateOf(tasks), TaskQuery.DEFAULT.withAssignee(UNASSIGNED), TODAY, 10).items.map { it.id })
        assertEquals("assignee=m1", q.toQueryString())
        assertEquals("m1", TaskQuery.parse("?assignee=m1").assignee)
        assertTrue(q.isFiltered)
        assertEquals(listOf("2"), boardColumn(stateOf(tasks), Status.TODO, "", "m2").map { it.id })
        val grid = buildMonthGrid(2026, 10, tasks, TODAY, UNASSIGNED)
        assertEquals(
            listOf("3"),
            grid.days
                .single { it.isToday }
                .tasks
                .map { it.id },
        )
    }

    @Test
    fun openByAssigneeStatsAndBarGeometry() {
        val members = arrayOf(Member("m1", "Alex Kim", "#0ea5e9"), Member("m2", "Sam Rivera", "#f97316"))
        val state =
            AppState(
                arrayOf(
                    task("1", assigneeId = "m1"),
                    task("2", assigneeId = "m1"),
                    task("3", assigneeId = "m1", status = Status.DONE, completedAt = "2026-10-15T10:00:00.000Z"),
                    task("4"),
                ),
                emptyArray(),
                Settings.DEFAULT,
                members,
            )
        val loads = computeStatsForDay(state, day(TODAY)) { null }.openByAssignee
        assertEquals(listOf("m1" to 2, "m2" to 0, "" to 1), loads.map { it.memberId to it.open })
        val chart = buildAssigneeBars(loads, 400)
        assertEquals(3, chart.rows.size)
        assertEquals(4, chart.maxValue)
        assertEquals(0.0, chart.rows[1].width)
        assertEquals((400 - 120 - 36) / 2.0, chart.rows[0].width)
        assertTrue(chart.rows[2].y > chart.rows[1].y)
    }

    @Test
    fun legacyDataWithoutNewFieldsStillLoads() {
        val legacy =
            """{"projects":[],"tasks":[{"id":"a","title":"Old","description":"","status":"todo","priority":"low",
            |"projectId":null,"tags":[],"dueDate":null,"estimateMinutes":null,"timeSpentMinutes":0,"subtasks":[],
            |"createdAt":"2026-10-01T00:00:00.000Z","completedAt":null,"order":0}],
            |"settings":{"theme":"dark","pomodoroMinutes":25,"pageSize":25}}
            """.trimMargin()
        val r = parseImport(legacy)
        assertTrue(r.ok, r.error)
        val t = r.state!!.tasks.single()
        assertNull(t.assigneeId)
        assertEquals(Recurrence.NONE, t.recurrence)
        assertEquals(0, r.state!!.members.size)
        val (store, _) = memoryStore(legacy)
        store.initialize("")
        assertEquals(
            "Old",
            store.state.tasks
                .single()
                .title,
        )
        assertEquals(Theme.DARK, store.state.settings.theme)
    }

    @Test
    fun importValidatesMembersAndAssignees() {
        val state = generateDemoState(10, now, day(TODAY))
        val json = serializeState(state, false)
        val round = parseImport(json)
        assertTrue(round.ok, round.error)
        assertEquals(json, serializeState(round.state!!, false))
        val bad = json.replace("\"assigneeId\":\"m1\"", "\"assigneeId\":\"ghost\"")
        assertFalse(parseImport(bad).ok)
        assertTrue(parseImport(bad).error.contains("does not match any member"))
        val badRec = json.replaceFirst("\"recurrence\":\"none\"", "\"recurrence\":\"yearly\"")
        assertTrue(parseImport(badRec).error.contains("recurrence"), parseImport(badRec).error)
    }
}
