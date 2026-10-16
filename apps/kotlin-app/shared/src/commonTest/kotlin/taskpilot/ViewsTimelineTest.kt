package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ViewsTimelineTest {
    private val query =
        TaskQuery(
            search = "login",
            statuses = setOf(Status.TODO),
            priorities = setOf(Priority.HIGH),
            project = "p1",
            assignee = "m2",
            sort = SortField.TITLE,
            ascending = false,
            page = 4,
        )

    @Test
    fun viewStoresFiltersWithoutPage() {
        val view = SavedView("v1", "Mine", viewParams(query), iso(0))
        assertEquals(query.copy(page = 1), view.query)
        assertTrue("page" !in view.params)
        assertEquals("v1", listUrlParams(view).toMap()[VIEW_PARAM])
        assertEquals(view, matchingView(listOf(view), query.copy(page = 2)))
        assertNull(matchingView(listOf(view), query.copy(search = "other")))
    }

    @Test
    fun boardDropsStatusSortAndPage() {
        val view = SavedView("v1", "Mine", viewParams(query), iso(0))
        val board = TaskQuery.fromParams(boardUrlParams(view).toMap())
        assertEquals(emptySet(), board.statuses)
        assertEquals(setOf(Priority.HIGH), board.priorities)
        assertEquals("p1", board.project)
        assertEquals("m2", board.assignee)
        assertEquals("login", board.search)
        assertEquals(SortField.DUE, board.sort)
        assertEquals(2, boardIgnoredParts(query).size)
        assertTrue(boardIgnoredParts(TaskQuery(project = "p")).isEmpty())
    }

    @Test
    fun viewNameValidation() {
        val views = listOf(SavedView("a", "Urgent", emptyMap(), iso(0)))
        assertEquals("Name is required.", validateViewName("  ", views))
        assertTrue(validateViewName("urgent", views)!!.contains("exists"))
        assertNull(validateViewName("urgent", views, editingId = "a"))
        assertTrue(validateViewName("x".repeat(41), views)!!.contains("40"))
    }

    @Test
    fun importAcceptsViews() {
        val json =
            """{"projects":[],"tasks":[],"views":[{"id":"v","name":"Mine","params":{"assignee":"m1","sort":"title","dir":"desc"},
               "createdAt":"2024-01-01T00:00:00Z"}]}"""
        val r = importState(json)
        assertIs<ImportResult.Ok>(r)
        assertEquals(
            "m1",
            r.state.views
                .single()
                .query.assignee,
        )
        assertIs<ImportResult.Error>(importState(json.replace("\"Mine\"", "\"\"")))
        assertTrue(AppJson.decodeFromString(AppState.serializer(), """{"tasks":[],"projects":[]}""").views.isEmpty())
    }

    @Test
    fun barsRangeAndRows() {
        val tasks =
            listOf(
                task("a", projectId = "p1", due = day(5), createdAt = iso(-3)),
                task("b", projectId = "p1", due = day(-10), createdAt = iso(-2)), // due before creation
                task("c", due = day(2), createdAt = iso(0)),
                task("d"),
            )
        val (bars, undated) = timelineBars(tasks, 0)
        assertEquals(listOf("d"), undated.map { it.id })
        assertEquals(TODAY - 3 to TODAY + 5, bars[0].start to bars[0].end)
        assertEquals(TODAY - 10, bars[1].start)
        val range = timelineRange(bars, TODAY)
        assertEquals(0, Dates.weekdayMonFirst(range.first))
        assertEquals(6, Dates.weekdayMonFirst(range.last))
        assertTrue(range.first <= TODAY - 17 && range.last >= TODAY + 12)
        val projects = listOf(Project("p1", "Web", "#000000", iso(0)))
        val rows = timelineRows(bars, projects, emptySet())
        assertEquals(
            listOf("group:p1", "b", "a", "group:none", "c"),
            rows.map {
                if (it is TimelineRow.Group) "group:${it.key}" else (it as TimelineRow.Item).bar.task.id
            },
        )
        val collapsed = timelineRows(bars, projects, setOf("p1"))
        assertEquals(3, collapsed.size)
        assertEquals(2, (collapsed[0] as TimelineRow.Group).count)
    }

    @Test
    fun ticksPerZoom() {
        val range = Dates.epochDay(2024, 6, 3)..Dates.epochDay(2024, 9, 1)
        assertEquals(range.count(), timelineTicks(Zoom.WEEK, range).size)
        assertTrue(timelineTicks(Zoom.MONTH, range).all { Dates.weekdayMonFirst(it.day) == 0 })
        assertEquals(listOf("Jul", "Aug", "Sep"), timelineTicks(Zoom.QUARTER, range).map { it.label })
        assertEquals(Zoom.MONTH, Zoom.fromKey("bogus"))
    }

    @Test
    fun dragSnapsAndClamps() {
        assertEquals(105, dueAfterDrag(100, 90, 5 * 12.0 + 4, 12.0))
        assertEquals(99, dueAfterDrag(100, 90, -14.0, 12.0))
        assertEquals(90, dueAfterDrag(100, 90, -1000.0, 12.0))
    }

    @Test
    fun virtualWindowAndLinks() {
        assertEquals(0..21, visibleRows(0.0, 400.0, 32.0, 1000))
        assertEquals(92..121, visibleRows(3200.0, 400.0, 32.0, 1000))
        assertEquals(988..999, visibleRows(31900.0, 400.0, 32.0, 1000))
        assertTrue(visibleRows(0.0, 400.0, 32.0, 0).isEmpty())
        val tasks =
            listOf(
                task("a", due = day(1)),
                task("b", due = day(3)).copy(blockedBy = listOf("a", "zzz")),
                task("c").copy(blockedBy = listOf("a")),
            )
        val rows = timelineRows(timelineBars(tasks, 0).first, emptyList(), emptySet())
        val links = dependencyLinks(rows)
        assertEquals(1, links.size)
        assertEquals("a" to "b", links[0].blocker.task.id to links[0].blocked.task.id)
        assertEquals(1 to 2, links[0].fromRow to links[0].toRow)
    }
}
