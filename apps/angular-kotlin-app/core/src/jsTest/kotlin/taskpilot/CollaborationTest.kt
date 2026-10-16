package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CollaborationTest {
    /** Store with members m1/m2 (current user m1) and no tasks. */
    private fun store(): TaskStore {
        val json =
            """{"tasks":[],"projects":[],"members":[{"id":"m1","name":"Alex Kim","color":"#0ea5e9"},
            |{"id":"m2","name":"Sam Rivera","color":"#f97316"}],
            |"settings":{"theme":"light","pomodoroMinutes":25,"pageSize":25,"currentUserId":"m1"}}
            """.trimMargin()
        val (s, _) = memoryStore(json)
        s.initialize("")
        return s
    }

    @Test
    fun cyclesAreRejectedWithClearMessage() {
        val s = store()
        val a = s.createTask(draft("A"))
        val b = s.createTask(draft("B"))
        val c = s.createTask(draft("C"))
        assertEquals("", s.addBlocker(a, b)) // B blocks A
        assertEquals("", s.addBlocker(b, c)) // C blocks B
        val err = s.addBlocker(c, a) // A blocks C -> C→B→A→C
        assertTrue(err.contains("cycle"), err)
        assertTrue(err.contains("“A”") && err.contains("“C”"), err)
        assertTrue(s.addBlocker(a, a).contains("itself"))
        assertTrue(s.addBlocker(a, b).contains("already"))
        assertEquals(listOf(c), blockerCandidates(s.state, a, "", 10).map { it.id })
        assertTrue(blockerCandidates(s.state, c, "", 10).isEmpty(), "A and B would both create cycles")
    }

    @Test
    fun blockedTaskCannotBeCompletedFromAnyPath() {
        val s = store()
        val blocker = s.createTask(draft("Design API"))
        val t = s.createTask(draft("Build client"))
        s.addBlocker(t, blocker)
        assertTrue(isBlocked(s.state, s.state.findTask(t)!!))
        val v = s.version
        s.toggleDone(t)
        assertEquals(Status.TODO, s.state.findTask(t)!!.status)
        assertTrue(s.lastError.contains("“Build client” is blocked by “Design API”"), s.lastError)
        assertTrue(s.version > v, "listeners are notified about the rejection")
        s.setStatus(t, Status.DONE)
        s.moveTask(t, Status.DONE, null)
        assertFalse(s.moveTaskBy(t, 2, 0, TaskQuery.DEFAULT, TODAY) && s.state.findTask(t)!!.status == Status.DONE)
        s.updateTask(t, draft("Build client", status = Status.DONE))
        assertEquals(Status.TODO, s.state.findTask(t)!!.status)
        assertEquals(0, s.state.tasks.count { it.status == Status.DONE })
        // bulk: the unblocked task is completed, the blocked one is not
        val other = s.createTask(draft("Other"))
        s.markDone(arrayOf(t, other))
        assertEquals(Status.DONE, s.state.findTask(other)!!.status)
        assertEquals(Status.TODO, s.state.findTask(t)!!.status)
        assertTrue(s.lastError.isNotEmpty())
        // completing the blocker (also in the same bulk action) unblocks
        s.markDone(arrayOf(blocker, t))
        assertEquals(Status.DONE, s.state.findTask(t)!!.status)
        assertEquals("", s.lastError)
    }

    @Test
    fun deletingBlockerCleansReferencesAndUndoRestores() {
        val s = store()
        val a = s.createTask(draft("A"))
        val b = s.createTask(draft("B"))
        s.addBlocker(a, b)
        s.deleteTask(b)
        assertEquals(
            0,
            s.state
                .findTask(a)!!
                .blockedBy.size,
        )
        s.undo()
        assertEquals(
            listOf(b),
            s.state
                .findTask(a)!!
                .blockedBy
                .toList(),
        )
        s.removeBlocker(a, b)
        assertEquals(
            0,
            s.state
                .findTask(a)!!
                .blockedBy.size,
        )
    }

    @Test
    fun commentsUseCurrentUser() {
        val s = store()
        val t = s.createTask(draft("T"))
        assertEquals("Comment cannot be empty.", s.addComment(t, "   "))
        assertEquals("", s.addComment(t, " Hi @Sam Rivera "))
        s.setCurrentUser("m2")
        assertEquals("", s.addComment(t, "Thanks"))
        val comments = s.state.findTask(t)!!.comments
        assertEquals(listOf("m1", "m2"), comments.map { it.authorId })
        assertEquals("Hi @Sam Rivera", comments[0].body)
        s.setCurrentUser("ghost")
        assertEquals("m2", s.state.settings.currentUserId, "unknown member ignored")
        s.setCurrentUser("")
        assertTrue(s.addComment(t, "x").contains("current user"))
    }

    @Test
    fun mentionsRenderAndAutocomplete() {
        val members = arrayOf(Member("m1", "Alex Kim", "#000000"), Member("m2", "Alex", "#000000"), Member("m3", "Sam Rivera", "#000000"))
        val segs = renderComment("Ping @alex kim and @Sam Rivera, not mail@Alex or @Nobody", members)
        assertEquals(
            listOf("" to "Ping ", "m1" to "@alex kim", "" to " and ", "m3" to "@Sam Rivera", "" to ", not mail@Alex or @Nobody"),
            segs.map {
                it.memberId to
                    it.text
            },
        )
        val text = "Hello @sa"
        val q = mentionAt(text, text.length)!!
        assertEquals(6, q.start)
        assertEquals("sa", q.query)
        assertEquals(listOf("m3"), mentionSuggestions(members, q.query, 5).map { it.id })
        assertEquals(listOf("m2", "m1"), mentionSuggestions(members, "al", 5).map { it.id })
        assertEquals(listOf("m3"), mentionSuggestions(members, "riv", 5).map { it.id })
        val applied = applyMention(text, q, text.length, members[2])
        assertEquals("Hello @Sam Rivera ", applied.text)
        assertEquals(applied.text.length, applied.caret)
        assertNull(mentionAt("mail@x", 6))
        assertNull(mentionAt("@a\nb", 4))
        assertNotNull(mentionAt("@", 1))
    }

    @Test
    fun activityIsRecordedForEveryChange() {
        val s = store()
        val p = s.createProject("Web", "#123456")
        val t = s.createTask(draft("Write docs"))
        val b = s.createTask(draft("Blocker"))
        s.updateTask(t, draft("Write API docs", project = p, assignee = "m2", due = "2026-10-20"))
        s.setStatus(t, Status.IN_PROGRESS)
        s.addBlocker(t, b)
        s.addComment(t, "Started")
        s.addSubtask(t, "Outline")
        s.deleteTask(b)
        val log = taskActivity(s.state.activity, t).reversed()
        val summary = log.map { "${it.type}:${it.field}:${it.from}->${it.to}" }
        assertEquals(
            listOf(
                "created:null:null->Write docs",
                "edit:title:Write docs->Write API docs",
                "edit:projectId:No project->Web",
                "edit:dueDate:No date->Tue, Oct 20, 2026",
                "assignee:assigneeId:Unassigned->Sam Rivera",
                "status:status:To do->In progress",
                "dependency:blockedBy:null->Blocker",
                "comment:comments:null->Started",
                "edit:subtasks:null->added “Outline”",
                "dependency:blockedBy:Blocker->null",
            ),
            summary,
        )
        assertTrue(log.all { it.actorId == "m1" })
        val deleted = s.state.activity.last { it.taskId == b }
        assertEquals(ActivityType.DELETED, deleted.type)
        assertEquals("Blocker", deleted.taskTitle)
        assertEquals("changed status from “To do” to “In progress”", describeActivity(log[5]))
        assertEquals("added blocker “Blocker”", describeActivity(log[6]))
        assertEquals("removed blocker “Blocker”", describeActivity(log[9]))
    }

    @Test
    fun undoRedoKeepTheLogConsistent() {
        val s = store()
        val t = s.createTask(draft("T"))
        val n = s.state.activity.size
        s.setStatus(t, Status.IN_PROGRESS)
        assertEquals(n + 1, s.state.activity.size)
        s.undo()
        assertEquals(n, s.state.activity.size, "undo removes the entry")
        s.redo()
        assertEquals(n + 1, s.state.activity.size)
        assertEquals(
            ActivityType.STATUS,
            s.state.activity
                .last()
                .type,
        )
        // settings changes are not logged and do not touch the log
        s.setPageSize(50)
        assertEquals(n + 1, s.state.activity.size)
        // recurring completion: completion + created copy are one undo step
        val r = s.createTask(draft("R", recurrence = Recurrence.DAILY))
        val m = s.state.activity.size
        s.toggleDone(r)
        assertEquals(
            listOf(ActivityType.STATUS, ActivityType.CREATED),
            s.state.activity
                .drop(m)
                .map { it.type },
        )
        s.undo()
        assertEquals(m, s.state.activity.size)
    }

    @Test
    fun activityQueryFiltersPaginatesNewestFirst() {
        val entries =
            (1..120)
                .map { i ->
                    ActivityEntry(
                        "a$i",
                        "t",
                        if (i % 2 ==
                            0
                        ) {
                            "m1"
                        } else {
                            "m2"
                        },
                        if (i % 3 ==
                            0
                        ) {
                            ActivityType.STATUS
                        } else {
                            ActivityType.EDIT
                        },
                        null,
                        null,
                        null,
                        "2026-10-16T10:00:00.000Z",
                        "T",
                    )
                }.toTypedArray()
        val first = queryActivity(entries, ActivityQuery.parse(""), ActivityQuery.PAGE_SIZE)
        assertEquals(3, first.pageCount)
        assertEquals("a120", first.items.first().id)
        assertEquals(50, first.items.size)
        val q = ActivityQuery.parse("?actor=m1&type=status&page=9")
        val page = queryActivity(entries, q, 50)
        assertEquals(20, page.total)
        assertEquals(1, page.page)
        assertTrue(page.items.all { it.actorId == "m1" && it.type == ActivityType.STATUS })
        assertEquals("actor=m1&type=status&page=9", q.toQueryString())
        assertEquals("", ActivityQuery.parse("type=bogus").toQueryString())
    }

    @Test
    fun serializationRoundTripAndValidation() {
        val s = store()
        val a = s.createTask(draft("A"))
        val b = s.createTask(draft("B"))
        s.addBlocker(a, b)
        s.addComment(a, "Hello @Sam Rivera")
        val json = s.exportJson()
        val r = parseImport(json)
        assertTrue(r.ok, r.error)
        assertEquals(serializeState(s.state, false), serializeState(r.state!!, false))
        assertEquals("m1", r.state!!.settings.currentUserId)

        fun withBlockers(
            id: String,
            blockers: Array<String>,
        ): String {
            val root: dynamic = JSON.parse<Any?>(json)
            val tasks: Array<dynamic> = root.tasks.unsafeCast<Array<dynamic>>()
            tasks.first { it.id == id }.blockedBy = blockers
            return JSON.stringify(root)
        }
        val dangling = withBlockers(a, arrayOf("zzz"))
        assertTrue(parseImport(dangling).error.contains("unknown task"), parseImport(dangling).error)
        val cyclic = withBlockers(b, arrayOf(a))
        assertTrue(parseImport(cyclic).error.contains("cycle"), parseImport(cyclic).error)
    }
}
