package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NotificationsReportsTest {
    private fun store(): TaskStore {
        val json =
            """{"tasks":[],"projects":[{"id":"p1","name":"Web","color":"#6366f1","createdAt":"2026-10-01T00:00:00.000Z"}],
            |"members":[{"id":"m1","name":"Alex Kim","color":"#0ea5e9"},{"id":"m2","name":"Sam Rivera","color":"#f97316"}],
            |"settings":{"theme":"light","pomodoroMinutes":25,"pageSize":25,"currentUserId":"m1"}}
            """.trimMargin()
        val (s, _) = memoryStore(json)
        s.initialize("")
        return s
    }

    private fun types(
        s: TaskStore,
        user: String,
    ) = notificationsFor(s.state, user).map { it.type }

    @Test
    fun assignmentAndMentionNotifyTheRecipient() {
        val s = store()
        val t = s.createTask(draft("Spec", assignee = "m2"))
        assertEquals(listOf(NotificationType.ASSIGNED), types(s, "m2"))
        assertEquals(emptyList(), types(s, "m1"))
        s.addComment(t, "Hey @Alex Kim and @alex kim, see this")
        assertEquals(listOf(NotificationType.MENTIONED), types(s, "m1"), "one per comment even if mentioned twice")
        assertTrue(notificationsFor(s.state, "m1")[0].text.contains("Alex Kim mentioned you"))
        s.updateTask(t, draft("Spec", assignee = "m2", description = "x"))
        assertEquals(1, types(s, "m2").size, "unchanged assignee does not re-notify")
        assertEquals(1, unreadCount(s.state, "m1"))
    }

    @Test
    fun blockerCompletionNotifiesAssigneeOfBlockedTask() {
        val s = store()
        val blocker = s.createTask(draft("API"))
        val t = s.createTask(draft("Client", assignee = "m2"))
        s.addBlocker(t, blocker)
        s.toggleDone(blocker)
        val n = notificationsFor(s.state, "m2").first()
        assertEquals(NotificationType.BLOCKER_DONE, n.type)
        assertEquals(t, n.taskId)
        assertTrue(n.text.contains("“API”"))
    }

    @Test
    fun dueRemindersOncePerTaskPerDay() {
        val s = store()
        val today = DateFmt.today()
        s.createTask(draft("Overdue", assignee = "m1", due = DateFmt.addDays(today, -3)))
        s.createTask(draft("Tomorrow", assignee = "m1", due = DateFmt.addDays(today, 1)))
        s.createTask(draft("Later", assignee = "m1", due = DateFmt.addDays(today, 5)))
        s.createTask(draft("Other user", assignee = "m2", due = today))
        val due = notificationsFor(s.state, "m1").filter { it.type == NotificationType.DUE }
        assertEquals(2, due.size)
        assertTrue(due.any { it.text.contains("overdue") } && due.any { it.text.contains("tomorrow") })
        assertEquals(0, s.refreshDueNotifications(), "no duplicates on the same day")
        s.setCurrentUser("m2")
        assertEquals(1, notificationsFor(s.state, "m2").count { it.type == NotificationType.DUE }, "switching user creates their reminders")
    }

    @Test
    fun markReadAndUndoKeepsNotifications() {
        val s = store()
        val t = s.createTask(draft("A", assignee = "m1"))
        s.createTask(draft("B", assignee = "m1"))
        assertEquals(2, unreadCount(s.state, "m1"))
        s.markNotificationRead(notificationsFor(s.state, "m1").last().id)
        assertEquals(1, unreadCount(s.state, "m1"))
        s.markAllNotificationsRead()
        assertEquals(0, unreadCount(s.state, "m1"))
        s.undo()
        assertEquals(2, notificationsFor(s.state, "m1").size, "notifications are not undone")
        assertTrue(s.state.findTask(t) != null)
        val r = parseImport(s.exportJson())
        assertTrue(r.ok, r.error)
        assertEquals(2, r.state!!.notifications.size)
    }

    @Test
    fun burndownCountsOpenTasksPerDay() {
        val d = { iso: String? -> parseInstant(iso)?.let { kotlin.math.floor(it / CivilDate.MS_PER_DAY).toInt() } }
        val state =
            AppState(
                arrayOf(
                    task("a", projectId = "p1", createdAt = "2026-10-01T10:00:00.000Z"),
                    task(
                        "b",
                        projectId = "p1",
                        createdAt = "2026-10-01T10:00:00.000Z",
                        status = Status.DONE,
                        completedAt = "2026-10-10T10:00:00.000Z",
                    ),
                    task("c", projectId = "p1", createdAt = "2026-10-12T10:00:00.000Z"),
                    task("x", createdAt = "2026-10-01T10:00:00.000Z"),
                ),
                emptyArray(),
                Settings.DEFAULT,
                emptyArray(),
            )
        val s = burndownSeries(state, "p1", day(TODAY), d)
        assertEquals(30, s.size)
        assertEquals(2, s.single { it.date == "2026-10-09" }.count)
        assertEquals(1, s.single { it.date == "2026-10-10" }.count)
        assertEquals(2, s.single { it.date == "2026-10-12" }.count)
        assertEquals(0, s.first().count)
        assertEquals(3, burndownSeries(state, "", day(TODAY), d).last().count)
    }

    @Test
    fun workloadAndCycleTime() {
        val members = arrayOf(Member("m1", "Alex Kim", "#0ea5e9"))
        val tasks =
            arrayOf(
                task("1", assigneeId = "m1").copy(estimateMinutes = 90),
                task("2", assigneeId = "m1").copy(estimateMinutes = 30),
                task(
                    "3",
                    assigneeId = "m1",
                    status = Status.DONE,
                    completedAt = "2026-10-03T10:00:00.000Z",
                    priority = Priority.URGENT,
                    createdAt = "2026-10-01T10:00:00.000Z",
                ).copy(estimateMinutes = 600),
                task(
                    "4",
                    priority = Priority.URGENT,
                    status = Status.DONE,
                    createdAt = "2026-10-01T10:00:00.000Z",
                    completedAt = "2026-10-05T10:00:00.000Z",
                ),
                task("5").copy(estimateMinutes = 60),
            )
        val st = AppState(tasks, emptyArray(), Settings.DEFAULT, members)
        val w = workloadByAssignee(st)
        assertEquals(listOf("m1" to 2.0, "" to 1.0), w.map { it.key to it.value })
        assertEquals("2.0 h", w[0].valueLabel)
        val c = cycleTimeByPriority(st)
        assertEquals(listOf("urgent", "high", "medium", "low"), c.map { it.key })
        assertEquals(3.0, c[0].value)
        assertEquals("3.0 d (2)", c[0].valueLabel)
        assertEquals("–", c[1].valueLabel)
        val chart = buildHBars(w, 400)
        assertEquals(2, chart.rows.size)
        assertEquals(
            4.0,
            chart.xTicks
                .last()
                .label
                .toDouble(),
        )
    }

    @Test
    fun csvExportsFilteredSortedTasksSafely() {
        val members = arrayOf(Member("m1", "Alex Kim", "#0ea5e9"))
        val tasks =
            arrayOf(
                task("1", title = "Beta, \"quoted\"", priority = Priority.HIGH, assigneeId = "m1", description = "line1\nline2"),
                task("2", title = "=HYPERLINK(\"x\")", priority = Priority.HIGH),
                task("3", title = "Alpha", priority = Priority.LOW),
            )
        val st = AppState(tasks, emptyArray(), Settings.DEFAULT, members)
        val q = TaskQuery.DEFAULT.withPriorityToggled(Priority.HIGH).withSort(SortKey.TITLE)
        val csv = exportTasksCsv(st, q, TODAY)
        val lines = csv.split("\r\n")
        assertTrue(lines[0].startsWith("id,title,status"))
        assertTrue(lines[1].startsWith("2,\"'=HYPERLINK(\"\"x\"\")\""), lines[1])
        assertTrue(lines[2].startsWith("1,\"Beta, \"\"quoted\"\"\",To do,todo,high,,Alex Kim"), lines[2])
        assertTrue(csv.contains("\"line1\nline2\""))
        assertEquals(2, exportTaskCount(st, q, TODAY))
        assertEquals("", lines.last())
    }
}
