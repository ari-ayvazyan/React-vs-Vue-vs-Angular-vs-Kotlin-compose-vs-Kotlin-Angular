package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DependenciesCommentsActivityTest {
    private val members = listOf(Member("m1", "Alex Kim", "#000000"), Member("m2", "Sam", "#000000"), Member("m3", "Sam Rivera", "#000000"))

    private fun chain() =
        listOf(
            task("a", title = "A").copy(blockedBy = listOf("b")),
            task("b", title = "B").copy(blockedBy = listOf("c")),
            task("c", title = "C"),
            task("d", title = "D"),
        )

    @Test
    fun detectsCyclesIncludingIndirectOnes() {
        val tasks = chain()
        assertEquals(listOf("a", "b", "c"), dependencyCycle(tasks, "c", "a"))
        assertNotNull(dependencyCycle(tasks, "b", "a"))
        assertNull(dependencyCycle(tasks, "a", "d"))
        assertNull(dependencyCycle(tasks, "d", "a"))
        assertEquals("A task cannot block itself.", dependencyError(tasks, "d", "d"))
        val msg = dependencyError(tasks, "c", "a")!!
        assertTrue(msg.contains("cycle") && msg.contains("\"A\""), msg)
        assertTrue(dependencyError(tasks, "a", "b")!!.contains("already"))
        assertNull(dependencyError(tasks, "c", "d"))
    }

    @Test
    fun blockedStateIgnoresDoneAndMissingBlockers() {
        val tasks =
            chain() + task("e").copy(blockedBy = listOf("ghost")) + task("f").copy(blockedBy = listOf("g")) +
                task("g", status = Status.DONE)
        assertEquals(setOf("a", "b"), blockedTaskIds(tasks))
        assertEquals(listOf("B"), openBlockers(tasks[0], tasks).map { it.title })
        assertEquals(listOf("a"), blockedTasksOf("b", tasks).map { it.id })
    }

    @Test
    fun enforceBlockersRejectsOnlyBlockedCompletions() {
        val before = chain()
        val after = before.map { if (it.id in setOf("a", "d")) it.withStatus(Status.DONE, iso(0)).copy(title = it.title + "!") else it }
        val (result, rejected) = enforceBlockers(before, after)
        assertEquals(listOf("a"), rejected.map { it.task.id })
        assertEquals(listOf("B"), rejected.single().blockers.map { it.title })
        val a = result.first { it.id == "a" }
        assertEquals(Status.TODO, a.status)
        assertNull(a.completedAt)
        assertEquals("A!", a.title) // other edits are kept
        assertEquals(Status.DONE, result.first { it.id == "d" }.status)
        assertTrue(blockedMessage(rejected).contains("blocked by \"B\""))
        // Completing the blocker in the same change is allowed.
        val both = before.map { if (it.id in setOf("b", "c")) it.withStatus(Status.DONE, iso(0)) else it }
        assertTrue(enforceBlockers(before, both).second.isEmpty())
        // Cascading: b is rejected, so a (blocked by b) is rejected too.
        val ab = before.map { if (it.id in setOf("a", "b")) it.withStatus(Status.DONE, iso(0)) else it }
        assertEquals(setOf("a", "b"), enforceBlockers(before, ab).second.map { it.task.id }.toSet())
    }

    @Test
    fun parsesMentionsPreferringLongestName() {
        val segs = parseMentions("Hi @Sam Rivera and @sam, ping @alex kim! email a@Sam", members)
        assertEquals(listOf("m3", "m2", "m1"), segs.mapNotNull { it.member?.id })
        assertEquals("@Sam Rivera", segs[1].text)
        assertEquals(setOf("m1", "m2", "m3"), mentionedMemberIds("@Sam Rivera @Sam @Alex Kim", members))
        assertEquals(listOf(CommentSegment("no mentions")), parseMentions("no mentions", members))
        assertTrue(parseMentions("@Samuel", members).none { it.member != null })
    }

    @Test
    fun mentionAutocompleteHelpers() {
        assertEquals(MentionQuery(6, "Al"), mentionQueryAt("Hello @Al", 9))
        assertEquals(MentionQuery(0, "Sam R"), mentionQueryAt("@Sam R", 6))
        assertNull(mentionQueryAt("mail a@b", 8))
        assertNull(mentionQueryAt("@x\ny", 4))
        assertEquals(listOf("m2", "m3"), mentionCandidates("sa", members).map { it.id })
        assertEquals(listOf("m3"), mentionCandidates("riv", members).map { it.id })
        val (text, caret) = applyMention("Hi @al there", MentionQuery(3, "al"), members[0], 6)
        assertEquals("Hi @Alex Kim there", text)
        assertEquals(13, caret)
        assertNotNull(validateComment("  "))
        assertNotNull(validateComment("x".repeat(2001)))
        assertNull(validateComment("ok"))
    }

    @Test
    fun diffActivityRecordsEachChange() {
        var n = 0
        val before = listOf(task("a", title = "A"), task("b", title = "B"))
        val after =
            listOf(
                task("a", title = "A2").copy(
                    status = Status.IN_PROGRESS,
                    assigneeId = "m1",
                    blockedBy = listOf("c"),
                    comments = listOf(Comment("c1", "m1", "Hello", iso(0))),
                ),
                task("c", title = "C"),
            )
        val entries = diffActivity(before, after, "m2", iso(0)) { "e${++n}" }
        val summary = entries.map { "${it.type.key}:${it.field}:${it.from}:${it.to}" }
        assertEquals(
            listOf(
                "updated:title:A:A2",
                "status:status:todo:in_progress",
                "assignee:assignee:null:m1",
                "dependencies:blockedBy::c",
                "comment:comment:null:Hello",
                "created:null:null:C",
                "deleted:null:B:null",
            ),
            summary,
        )
        assertTrue(entries.all { it.actorId == "m2" && it.at == iso(0) })
        assertEquals(listOf("e1", "e2"), entries.take(2).map { it.id })
        // Reordering alone is not logged.
        assertTrue(diffActivity(before, before.map { it.copy(order = 9) }, null, iso(0)) { "x" }.isEmpty())
    }

    @Test
    fun undoRemovesActivityEntriesWithTheChange() {
        val tasks = listOf(task("a"))
        val state0 = AppState(tasks = tasks)
        val changed = tasks.map { it.copy(title = "New") }
        val state1 =
            state0.copy(
                tasks = changed,
                activity = appendActivity(state0.activity, diffActivity(tasks, changed, "m1", iso(0)) { "e1" }),
            )
        val h = History(state0).push(state1)
        assertEquals(1, h.present.activity.size)
        assertTrue(
            h
                .undo()
                .present.activity
                .isEmpty(),
        )
        assertEquals(
            1,
            h
                .undo()
                .redo()
                .present.activity.size,
        )
        val many = appendActivity((1..ACTIVITY_LIMIT).map { state1.activity[0].copy(id = "x$it") }, state1.activity)
        assertEquals(ACTIVITY_LIMIT, many.size)
        assertEquals("e1", many.last().id)
    }

    @Test
    fun describesAndFiltersActivity() {
        val names =
            object : ActivityNames {
                override fun task(id: String) = mapOf("b" to "Blocker")[id]

                override fun member(id: String?) = members.firstOrNull { it.id == id }?.name

                override fun project(id: String?) = null
            }

        fun e(type: ActivityType, field: String? = null, from: String? = null, to: String? = null, actor: String? = "m1") =
            ActivityEntry("id", "t", actor, type, field, from, to, iso(0))
        assertEquals("changed status from To do to Done", describeActivity(e(ActivityType.STATUS, "status", "todo", "done"), names))
        assertEquals("assigned Alex Kim", describeActivity(e(ActivityType.ASSIGNEE, "assignee", null, "m1"), names))
        assertEquals("added blocker \"Blocker\"", describeActivity(e(ActivityType.DEPENDENCIES, "blockedBy", "", "b"), names))
        assertEquals("logged 25 min", describeActivity(e(ActivityType.UPDATED, ActivityField.TIME, "5", "30"), names))
        val log =
            listOf(
                e(ActivityType.CREATED).copy(id = "1"),
                e(ActivityType.STATUS, actor = "m2").copy(id = "2"),
                e(ActivityType.STATUS).copy(id = "3"),
            )
        assertEquals(listOf("3", "2", "1"), filterActivity(log, ActivityQuery()).map { it.id })
        assertEquals(listOf("3"), filterActivity(log, ActivityQuery(memberId = "m1", type = ActivityType.STATUS)).map { it.id })
        val q = ActivityQuery("m2", ActivityType.COMMENT, 3)
        assertEquals(q, ActivityQuery.fromParams(q.toParams().toMap()))
    }

    @Test
    fun importHandlesDependenciesCommentsAndActivity() {
        val json =
            """{"projects":[],"members":[{"id":"m1","name":"Alex","color":"#0ea5e9"}],
               "tasks":[{"id":"t1","title":"x","status":"todo","priority":"low","createdAt":"2024-01-01T00:00:00Z",
                         "blockedBy":["t2","ghost","t1"],"comments":[{"id":"c","authorId":"m1","body":"hi","createdAt":"2024-01-02T00:00:00Z"}]},
                        {"id":"t2","title":"y","status":"todo","priority":"low","createdAt":"2024-01-01T00:00:00Z"}],
               "activity":[{"id":"e","taskId":"t1","actorId":"m1","type":"comment","field":"comment","to":"hi","at":"2024-01-02T00:00:00Z"}],
               "settings":{"theme":"light","pomodoroMinutes":25,"pageSize":25,"currentUserId":null}}"""
        val r = importState(json)
        assertIs<ImportResult.Ok>(r)
        assertEquals(listOf("t2"), r.state.tasks[0].blockedBy)
        assertEquals(
            "hi",
            r.state.tasks[0]
                .comments
                .single()
                .body,
        )
        assertEquals(1, r.state.activity.size)
        assertNull(r.state.settings.currentUserId)
        val bad = importState(json.replace("\"type\":\"comment\"", "\"type\":\"exploded\""))
        assertIs<ImportResult.Error>(bad)
        assertTrue(bad.message.contains("activity[0].type"))
        // Legacy settings default the current user to m1.
        assertEquals(DEFAULT_CURRENT_USER, Settings().currentUserId)
        val legacy = AppJson.decodeFromString(AppState.serializer(), """{"tasks":[],"projects":[],"settings":{"theme":"dark"}}""")
        assertEquals("m1", legacy.settings.currentUserId)
        assertTrue(legacy.activity.isEmpty())
    }
}
