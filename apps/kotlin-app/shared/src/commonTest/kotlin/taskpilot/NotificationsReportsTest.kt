package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NotificationsReportsTest {
    private val members = listOf(Member("m1", "Alex Kim", "#000000"), Member("m2", "Sam Rivera", "#000000"))

    private fun ids(): () -> String {
        var n = 0
        return { "n${++n}" }
    }

    @Test
    fun assignmentAndMentionNotifications() {
        val before = listOf(task("a", title = "A"), task("b", title = "B").copy(assigneeId = "m1"))
        val after =
            listOf(
                task(
                    "a",
                    title = "A",
                ).copy(assigneeId = "m1", comments = listOf(Comment("c1", "m2", "hey @Sam Rivera and @Alex Kim", iso(0)))),
                task("b", title = "B").copy(assigneeId = "m1", title = "B2"),
                task("new", title = "N").copy(assigneeId = "m2"),
            )
        val n = notificationsForChange(before, after, members, "Sam Rivera", iso(0), ids())
        assertEquals(
            listOf("m1:ASSIGNED:a", "m2:MENTIONED:a", "m1:MENTIONED:a", "m2:ASSIGNED:new"),
            n.map { "${it.userId}:${it.type}:${it.taskId}" },
        )
        assertEquals("Sam Rivera assigned you \"A\"", n[0].message)
        assertTrue(notificationsForChange(after, after, members, "x", iso(0), ids()).isEmpty())
        // Unknown members are ignored.
        assertTrue(notificationsForChange(before, listOf(task("a").copy(assigneeId = "ghost")), members, "x", iso(0), ids()).isEmpty())
    }

    @Test
    fun blockerCompletionNotifiesAssigneesOfOpenBlockedTasks() {
        val before =
            listOf(
                task("blocker", title = "Blocker"),
                task("t1", title = "T1").copy(assigneeId = "m1", blockedBy = listOf("blocker")),
                task("t2", title = "T2", status = Status.DONE).copy(assigneeId = "m2", blockedBy = listOf("blocker")),
                task("t3", title = "T3").copy(blockedBy = listOf("blocker")),
            )
        val after = before.map { if (it.id == "blocker") it.withStatus(Status.DONE, iso(0)) else it }
        val n = notificationsForChange(before, after, members, "Alex Kim", iso(0), ids())
        assertEquals(listOf("m1:BLOCKER_DONE:t1"), n.map { "${it.userId}:${it.type}:${it.taskId}" })
        assertEquals("Blocker \"Blocker\" of \"T1\" was completed", n.single().message)
        // The next occurrence of a recurring task is generated, not assigned: no "assigned you".
        val copy = task("copy", title = "Blocker").copy(assigneeId = "m2")
        val withCopy = notificationsForChange(before, after + copy, members, "Alex Kim", iso(0), ids(), setOf("copy"))
        assertEquals(listOf("BLOCKER_DONE"), withCopy.map { it.type.name })
        assertEquals(2, notificationsForChange(before, after + copy, members, "Alex Kim", iso(0), ids()).size)
    }

    @Test
    fun dueNotificationsOncePerTaskPerDay() {
        val tasks =
            listOf(
                task("over", due = day(-2)).copy(assigneeId = "m1"),
                task("today", due = day(0)).copy(assigneeId = "m1"),
                task("tomorrow", due = day(1)).copy(assigneeId = "m1"),
                task("later", due = day(2)).copy(assigneeId = "m1"),
                task("done", due = day(-1), status = Status.DONE).copy(assigneeId = "m1"),
                task("other", due = day(0)).copy(assigneeId = "m2"),
            )
        val first = dueNotifications(tasks, emptyList(), "m1", TODAY, iso(0), ids())
        assertEquals(listOf("over:OVERDUE", "today:DUE_SOON", "tomorrow:DUE_SOON"), first.map { "${it.taskId}:${it.type}" })
        assertTrue(first[1].message.contains("due today"))
        assertTrue(dueNotifications(tasks, first, "m1", TODAY, iso(0), ids()).isEmpty())
        // Next day: "later" is now due tomorrow and "today" has become overdue, so all four remind again.
        assertEquals(4, dueNotifications(tasks, first, "m1", TODAY + 1, iso(1), ids()).size)
    }

    @Test
    fun readStateAndLimit() {
        val list = (1..3).map { Notification("n$it", if (it == 3) "m2" else "m1", NotificationType.ASSIGNED, "t", "x", iso(0)) }
        assertEquals(2, unreadCount(list, "m1"))
        assertEquals(1, unreadCount(markRead(list, "n1"), "m1"))
        assertEquals(0, unreadCount(markAllRead(list, "m1"), "m1"))
        assertEquals(1, unreadCount(markAllRead(list, "m1"), "m2"))
        assertEquals(listOf("n2", "n1"), notificationsFor(list, "m1").map { it.id })
        val many = (1..NOTIFICATION_LIMIT).map { Notification("o$it", "m1", NotificationType.ASSIGNED, "t", "x", iso(0), read = it <= 5) }
        val trimmed = appendNotifications(many, list)
        assertEquals(NOTIFICATION_LIMIT, trimmed.size)
        assertTrue(trimmed.none { it.id == "o1" || it.id == "o3" })
        assertTrue(trimmed.any { it.id == "o6" } && trimmed.last().id == "n3")
    }

    @Test
    fun burndownCountsOpenTasksPerDay() {
        val tasks =
            listOf(
                task("a", projectId = "p", createdAt = iso(-10)),
                task("b", projectId = "p", createdAt = iso(-10), status = Status.DONE, completedAt = iso(-5)),
                task("c", projectId = "p", createdAt = iso(-3)),
                task("d", projectId = "q", createdAt = iso(-40)),
            )
        val series = burndown(tasks, CLOCK, "p")
        assertEquals(30, series.size)
        assertEquals(TODAY, series.last().first)
        val byDay = series.toMap()
        assertEquals(0, byDay[TODAY - 11])
        assertEquals(2, byDay[TODAY - 10])
        assertEquals(1, byDay[TODAY - 5]) // b completed that day
        assertEquals(2, byDay[TODAY])
        assertEquals(3, burndown(tasks, CLOCK, null).last().second)
        assertEquals(0, burndown(tasks, CLOCK, NO_PROJECT).last().second)
    }

    @Test
    fun workloadSumsOpenEstimates() {
        val tasks =
            listOf(
                task("a").copy(assigneeId = "m1", estimateMinutes = 90),
                task("b").copy(assigneeId = "m1", estimateMinutes = 30),
                task("c", status = Status.DONE).copy(assigneeId = "m1", estimateMinutes = 600),
                task("d").copy(assigneeId = "m2"),
                task("e").copy(estimateMinutes = 15),
            )
        val w = workloadPerAssignee(tasks, members)
        assertEquals(listOf(2.0, 0.0, 0.3), w.map { it.hours })
        assertEquals(1, w[1].unestimated)
        assertNull(w[2].member)
    }

    @Test
    fun cycleTimeAveragesByPriority() {
        val tasks =
            listOf(
                task("a", priority = Priority.HIGH, status = Status.DONE, createdAt = iso(-4), completedAt = iso(-1)),
                task("b", priority = Priority.HIGH, status = Status.DONE, createdAt = iso(-2), completedAt = iso(0)),
                task("c", priority = Priority.LOW, status = Status.DONE, createdAt = iso(-1), completedAt = iso(0)),
                task("d", priority = Priority.LOW),
            )
        val c = cycleTimeByPriority(tasks).associateBy { it.priority }
        assertEquals(2.5, c.getValue(Priority.HIGH).averageDays)
        assertEquals(2, c.getValue(Priority.HIGH).count)
        assertEquals(1.0, c.getValue(Priority.LOW).averageDays)
        assertNull(c.getValue(Priority.URGENT).averageDays)
        assertEquals(Priority.URGENT, cycleTimeByPriority(tasks).first().priority)
    }

    @Test
    fun csvEscapesAndKeepsOrder() {
        val tasks =
            listOf(
                task("2", title = "Say \"hi\", then go", projectId = "p").copy(tags = listOf("a", "b"), assigneeId = "m1"),
                task("1", title = "=SUM(A1)", description = "line1\nline2"),
            )
        val csv = tasksToCsv(tasks, listOf(Project("p", "Web, App", "#000000", iso(0))), members)
        val lines = csv.split("\r\n")
        assertTrue(lines[0].startsWith("id,title,status,priority,project,assignee,tags"))
        assertTrue(lines[1].startsWith("2,\"Say \"\"hi\"\", then go\",todo,medium,\"Web, App\",Alex Kim,a;b,"))
        assertTrue(lines[2].startsWith("1,'=SUM(A1),todo"))
        assertTrue(csv.contains("\"line1\nline2\""))
        assertEquals("", csvCell(null))
        assertEquals("-5", csvCell("-5", text = false))
    }
}
