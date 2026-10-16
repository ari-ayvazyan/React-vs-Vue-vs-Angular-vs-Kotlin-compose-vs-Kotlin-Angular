package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ViewsTimelineTest {
    private fun store(): TaskStore {
        val (s, _) = memoryStore("""{"tasks":[],"projects":[],"settings":{"theme":"light","pomodoroMinutes":25,"pageSize":25}}""")
        s.initialize("")
        return s
    }

    @Test
    fun saveRenameDeleteViews() {
        val s = store()
        val q = TaskQuery.parse("?q=api&priority=high,urgent&status=todo&sort=title&dir=desc&page=4")
        val id = s.saveView(" Hot API ", q)
        val v = s.state.views.single()
        assertEquals(id, v.id)
        assertEquals("Hot API", v.name)
        assertEquals("q=api&status=todo&priority=high%2Curgent&sort=title&dir=desc", v.query, "page is not saved")
        assertEquals("", s.saveView("hot api", TaskQuery.DEFAULT), "names are unique ignoring case")
        assertTrue(validateViewName(s.state.views, "", null).isNotEmpty())
        assertTrue(s.renameView(id, "Hot"))
        assertEquals(
            "Hot",
            s.state.views
                .single()
                .name,
        )
        s.deleteView(id)
        assertEquals(0, s.state.views.size)
        s.undo()
        assertEquals(
            "Hot",
            s.state.views
                .single()
                .name,
            "view CRUD is undoable",
        )
    }

    @Test
    fun viewQueriesForListAndBoard() {
        val v = SavedView("v1", "Mine", "q=api&status=todo&priority=high&assignee=m1&sort=title", "2026-10-16T00:00:00.000Z")
        assertEquals("q=api&priority=high&assignee=m1", v.boardQueryString(), "board drops status and sort")
        assertTrue(v.boardIgnoresStatus)
        assertEquals("To do · High · Assignee · “api” · by title ↑", v.summary)
        assertEquals(v, activeView(arrayOf(v), "?q=api&status=todo&priority=high&assignee=m1&sort=title&dir=asc&page=3"))
        assertNull(activeView(arrayOf(v), "?q=api"))
        val tasks =
            arrayOf(
                task("1", title = "API client", priority = Priority.HIGH, assigneeId = "m1"),
                task("2", title = "API docs", priority = Priority.LOW, assigneeId = "m1"),
                task("3", title = "API server", priority = Priority.HIGH, assigneeId = "m1", status = Status.DONE),
            )
        assertEquals(listOf("1"), boardColumns(stateOf(tasks), v.toTaskQuery(), TODAY).first { it.id == Status.TODO }.tasks.map { it.id })
        assertEquals(
            listOf("3"),
            boardColumns(stateOf(tasks), v.toTaskQuery(), TODAY)
                .first {
                    it.id == Status.DONE
                }.tasks
                .map { it.id },
            "status ignored",
        )
    }

    @Test
    fun keyboardMoveRespectsBoardQuery() {
        val s = store()
        val a = s.createTask(draft("Alpha", tags = "x"))
        val b = s.createTask(draft("Beta"))
        val c = s.createTask(draft("Gamma", tags = "x"))
        val q = TaskQuery.DEFAULT.withTag("x")
        assertTrue(s.moveTaskBy(c, 0, -1, q, TODAY), "moves above Alpha, skipping hidden Beta")
        assertEquals(listOf(c, a, b), boardColumn(s.state, Status.TODO, "", "").map { it.id })
    }

    @Test
    fun setDueDateIsUndoableAndLogged() {
        val s = store()
        val t = s.createTask(draft("T", due = "2026-10-20"))
        assertTrue(s.setDueDate(t, "2026-10-25"))
        assertEquals("2026-10-25", s.state.findTask(t)!!.dueDate)
        assertEquals(
            "dueDate",
            s.state.activity
                .last()
                .field,
        )
        assertFalse(s.setDueDate(t, "2026-13-01"))
        s.undo()
        assertEquals("2026-10-20", s.state.findTask(t)!!.dueDate)
    }

    private fun timelineState(): AppState {
        val p = Project("p1", "Web", "#6366f1", "2026-10-01T00:00:00.000Z")
        val tasks =
            arrayOf(
                task("a", createdAt = "2026-10-05T12:00:00.000Z", dueDate = "2026-10-09", projectId = "p1"),
                task("b", createdAt = "2026-10-06T12:00:00.000Z", dueDate = "2026-10-20", projectId = "p1").copy(blockedBy = arrayOf("a")),
                task("c", createdAt = "2026-10-10T12:00:00.000Z", dueDate = "2026-10-08"),
                task("d", createdAt = "2026-10-10T12:00:00.000Z"),
                task(
                    "e",
                    createdAt = "2026-10-10T12:00:00.000Z",
                    dueDate = "2026-10-12",
                    status = Status.DONE,
                    completedAt = "2026-10-11T00:00:00.000Z",
                ),
            )
        return AppState(tasks, arrayOf(p), Settings.DEFAULT, emptyArray())
    }

    @Test
    fun timelineLayoutGroupsBarsAndArrows() {
        val tl = buildTimeline(timelineState(), TimelineZoom.WEEK, TODAY, emptyArray(), false)
        assertEquals(36.0, tl.dayWidth)
        assertEquals(0, CivilDate.weekdayMonFirst(day(tl.startDate)), "starts on a Monday")
        assertTrue(day(tl.startDate) <= day("2026-10-05") - 3)
        assertEquals(listOf("group:p1", "task:a", "task:b", "group:none", "task:c", "task:e"), tl.rows.map { "${it.kind}:${it.key}" })
        assertEquals(listOf("d"), tl.undated.map { it.id })
        val a = tl.bars.single { it.task.id == "a" }
        // Oct 5..Oct 9 inclusive = 5 days
        assertEquals(5 * 36.0, a.width)
        assertEquals((day("2026-10-05") - day(tl.startDate)) * 36.0, a.x)
        val c = tl.bars.single { it.task.id == "c" }
        assertTrue(c.inverted)
        assertEquals("2026-10-08", c.dueDate)
        val arrow = tl.arrows.single()
        assertEquals("a" to "b", arrow.fromId to arrow.toId)
        assertTrue(arrow.path.startsWith("M${(a.x + a.width).toInt()}"), arrow.path)
        assertTrue(tl.ticks.any { it.major && it.label == "October 2026" })
        assertEquals("2026-10-09", timelineDayAt(tl, a.x + a.width - 1))
        assertEquals(a.x + a.width, timelineDayEndX(tl, "2026-10-09"))
        val longer = timelinePreview(tl, a, "2026-10-12")
        assertEquals(a.x, longer.x)
        assertEquals(8 * 36.0, longer.width)
        val before = timelinePreview(tl, a, "2026-10-03")
        assertEquals(a.x - 2 * 36.0, before.x, "due before start: bar spans due..start")
        assertEquals(3 * 36.0, before.width)
        assertEquals("2026-10-16", shiftDate("2026-10-09", 7))
    }

    @Test
    fun timelineCollapseHideDoneAndZoom() {
        val st = timelineState()
        val collapsed = buildTimeline(st, TimelineZoom.MONTH, TODAY, arrayOf("p1"), true)
        assertEquals(listOf("group:p1", "group:none", "task:c"), collapsed.rows.map { "${it.kind}:${it.key}" })
        assertTrue(collapsed.rows.first().collapsed)
        assertEquals(2, collapsed.rows.first().count)
        assertTrue(collapsed.arrows.isEmpty(), "arrows only between visible bars")
        assertEquals(TASK_ROW + 2 * GROUP_ROW, collapsed.height)
        val quarter = buildTimeline(st, TimelineZoom.QUARTER, TODAY, emptyArray(), false)
        assertEquals(5.0, quarter.dayWidth)
        assertTrue(quarter.ticks.any { it.major && it.label.startsWith("Q") })
        assertTrue(quarter.width < buildTimeline(st, TimelineZoom.WEEK, TODAY, emptyArray(), false).width)
    }

    @Test
    fun timelineHandlesThousandTasks() {
        val now = parseInstant("2026-10-16T12:00:00.000Z")!!
        val st = generateDemoState(1000, now, day(TODAY))
        val tl = buildTimeline(st, TimelineZoom.MONTH, TODAY, emptyArray(), false)
        assertEquals(st.tasks.count { it.dueDate != null }, tl.bars.size)
        assertEquals(st.tasks.count { it.dueDate == null }, tl.undated.size)
        assertEquals(7, tl.rows.count { it.kind == "group" })
    }

    @Test
    fun viewsSurviveExportImport() {
        val s = store()
        s.saveView("Urgent", TaskQuery.DEFAULT.withPriorityToggled(Priority.URGENT))
        val r = parseImport(s.exportJson())
        assertTrue(r.ok, r.error)
        assertEquals(
            "priority=urgent",
            r.state!!
                .views
                .single()
                .query,
        )
    }
}
