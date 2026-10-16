package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SubprojectsWorkflowTest {
    private fun store(): TaskStore {
        val (s, _) = memoryStore("""{"tasks":[],"projects":[],"settings":{"theme":"light","pomodoroMinutes":25,"pageSize":25}}""")
        s.initialize("")
        return s
    }

    /** web > (app > ios), docs; returns ids. */
    private fun tree(s: TaskStore): List<String> {
        val web = s.createProject("Web", "#6366f1")
        val app = s.createProject("App", "#ec4899", web)
        val ios = s.createProject("iOS", "#10b981", app)
        val docs = s.createProject("Docs", "#f59e0b")
        return listOf(web, app, ios, docs)
    }

    @Test
    fun treeOrderPathsAndCycleValidation() {
        val s = store()
        val (web, app, ios, docs) = tree(s)
        val nodes = projectTree(s.state)
        assertEquals(listOf(web, app, ios, docs), nodes.map { it.project.id })
        assertEquals(listOf(0, 1, 2, 0), nodes.map { it.depth })
        assertEquals("Web › App › iOS", projectPath(s.state, ios))
        assertEquals(setOf(app, ios), projectDescendants(s.state, web).toSet())
        assertTrue(validateParent(s.state, web, ios).contains("cycle"))
        assertTrue(validateParent(s.state, web, web).isNotEmpty())
        assertTrue(s.setProjectParent(web, ios).contains("cycle"))
        assertEquals("", s.setProjectParent(docs, app))
        assertEquals("Web › App › Docs", projectPath(s.state, docs))
        assertTrue(projectOptions(s.state)[1].label.contains("↳ App"))
    }

    @Test
    fun filtersProgressAndBurndownIncludeDescendants() {
        val s = store()
        val (web, app, ios, docs) = tree(s)
        s.createTask(draft("w", project = web))
        s.createTask(draft("a", project = app, status = Status.DONE))
        s.createTask(draft("i", project = ios))
        s.createTask(draft("d", project = docs))
        val q = TaskQuery.DEFAULT.withProject(web)
        assertEquals(setOf("w", "a", "i"), queryTasks(s.state, q, TODAY, 50).items.map { it.title }.toSet())
        assertEquals(setOf("a", "i"), queryTasks(s.state, TaskQuery.DEFAULT.withProject(app), TODAY, 50).items.map { it.title }.toSet())
        val progress = projectProgress(s.state, web)!!
        assertEquals(3, progress.total)
        assertEquals(1, progress.done)
        assertEquals(3, exportTaskCount(s.state, q, TODAY))
    }

    @Test
    fun deleteProjectMovesUpOrDeletesSubprojects() {
        val s = store()
        val (web, app, ios, _) = tree(s)
        s.addStatus(app, "Review", "#a855f7", Status.IN_PROGRESS) // app customises; ios inherits it
        val t = s.createTask(draft("x", project = ios, status = "review"))
        s.deleteProject(app, deleteTasks = false, deleteSubprojects = false)
        assertEquals(web, s.state.findProject(ios)!!.parentId, "moved up one level")
        assertTrue(s.state.findProject(ios)!!.hasOwnWorkflow, "kept the inherited custom workflow")
        assertEquals("review", s.state.findTask(t)!!.status)
        s.undo()
        s.deleteProject(app, deleteTasks = true, deleteSubprojects = true)
        assertNull(s.state.findProject(ios))
        assertNull(s.state.findTask(t))
        assertNotNull(s.state.findProject(web))
    }

    @Test
    fun workflowsInheritCustomizeAndValidate() {
        val s = store()
        val (web, app, ios, _) = tree(s)
        assertEquals(listOf("todo", "in_progress", "done"), workflowFor(s.state, ios).map { it.id })
        assertEquals("", s.addStatus(web, "Review", "#a855f7", Status.IN_PROGRESS))
        assertEquals("review", workflowFor(s.state, ios)[3].id, "sub-projects inherit")
        s.moveStatus(web, "review", -1)
        assertEquals(listOf("todo", "in_progress", "review", "done"), workflowFor(s.state, app).map { it.id })
        s.customizeWorkflow(app)
        assertEquals("", s.addStatus(app, "QA", "#14b8a6", Status.IN_PROGRESS))
        assertEquals(4, workflowFor(s.state, web).size, "parent unaffected")
        assertEquals(5, workflowFor(s.state, ios).size, "grandchild inherits the customised child")
        assertTrue(s.addStatus(web, "review", "#000000", Status.TODO).contains("unique"))
        assertTrue(s.deleteStatus(web, "done", "todo").contains("category"), "a done category status must remain")
        assertTrue(validateWorkflow(arrayOf(WorkflowStatus("a", "A", "#000000", Status.TODO))).contains("missing"))
        s.resetWorkflow(app)
        assertEquals(4, workflowFor(s.state, ios).size)
    }

    @Test
    fun categoriesDriveDoneLogic() {
        val s = store()
        val (web) = tree(s)
        s.addStatus(web, "Shipped", "#059669", Status.DONE)
        s.updateStatus(web, "done", "Cancelled", "#94a3b8", Status.DONE)
        val t = s.createTask(draft("Feature", project = web, recurrence = Recurrence.WEEKLY, due = "2026-10-20"))
        s.setStatus(t, "shipped")
        val task = s.state.findTask(t)!!
        assertEquals(Status.DONE, task.category)
        assertTrue(task.isDone)
        assertNotNull(task.completedAt)
        assertEquals(1, s.lastSpawned.size, "recurrence uses the done category")
        assertEquals(Status.TODO, s.state.findTask(s.lastSpawned[0])!!.category)
        assertEquals(1, computeDashboardStats(s.state, TODAY).completedLast7Days.coerceAtMost(1))
        s.toggleDone(t)
        assertEquals("todo", s.state.findTask(t)!!.status)
        assertNull(s.state.findTask(t)!!.completedAt)
        s.toggleDone(t)
        assertEquals("done", s.state.findTask(t)!!.status, "first done-category status (renamed “Cancelled”)")
        // Recategorising a status updates its tasks.
        s.updateStatus(web, "done", "Cancelled", "#94a3b8", Status.IN_PROGRESS)
        assertTrue(s.lastError.isEmpty())
        assertEquals(Status.IN_PROGRESS, s.state.findTask(t)!!.category)
        assertNull(s.state.findTask(t)!!.completedAt)
    }

    @Test
    fun blockerInCustomDoneStatusUnblocks() {
        val s = store()
        val (web) = tree(s)
        s.addStatus(web, "Shipped", "#059669", Status.DONE)
        val blocker = s.createTask(draft("API", project = web))
        val t = s.createTask(draft("Client"))
        s.addBlocker(t, blocker)
        assertTrue(isBlocked(s.state, s.state.findTask(t)!!))
        s.setStatus(blocker, "shipped")
        assertFalse(isBlocked(s.state, s.state.findTask(t)!!))
    }

    @Test
    fun deleteStatusMovesTasksAndUndoRestores() {
        val s = store()
        val (web, app) = tree(s)
        s.addStatus(web, "Review", "#a855f7", Status.IN_PROGRESS)
        val a = s.createTask(draft("a", project = web, status = "review"))
        val b = s.createTask(draft("b", project = app, status = "review"))
        assertTrue(s.deleteStatus(web, "review", "review").isNotEmpty(), "target must differ")
        assertEquals("", s.deleteStatus(web, "review", Status.DONE))
        assertEquals(listOf("done", "done"), listOf(a, b).map { s.state.findTask(it)!!.status })
        assertEquals(listOf(0, 0, 2), workflowUsage(s.state, web).toList(), "counts include inheriting sub-projects")
        assertNotNull(s.state.findTask(b)!!.completedAt)
        s.undo()
        assertEquals(listOf("review", "review"), listOf(a, b).map { s.state.findTask(it)!!.status })
        assertEquals(4, workflowFor(s.state, web).size)
    }

    @Test
    fun projectBoardShowsWorkflowColumnsAndMovesSetStatus() {
        val s = store()
        val (web, app) = tree(s)
        s.customizeWorkflow(app) // app's own copy does not get the parent's later "Review" status
        s.addStatus(web, "Review", "#a855f7", Status.IN_PROGRESS)
        s.addStatus(app, "QA", "#14b8a6", Status.IN_PROGRESS)
        val w = s.createTask(draft("w", project = web))
        val q = s.createTask(draft("q", project = app, status = "qa"))
        val board = boardColumns(s.state, TaskQuery.DEFAULT.withProject(web), TODAY)
        assertEquals(listOf("todo", "in_progress", "done", "review"), board.map { it.id })
        assertEquals(listOf(q), board.first { it.id == "in_progress" }.tasks.map { it.id }, "sub-project status placed by category")
        s.moveTaskToColumn(w, "review", null, web)
        assertEquals("review", s.state.findTask(w)!!.status)
        s.moveTaskToColumn(q, "review", null, web)
        assertEquals("in_progress", s.state.findTask(q)!!.status, "status not in its workflow → first of the category")
        val all = boardColumns(s.state, TaskQuery.DEFAULT, TODAY)
        assertEquals(listOf("todo", "in_progress", "done"), all.map { it.id })
        assertEquals(setOf(w, q), all[1].tasks.map { it.id }.toSet())
        // columns: todo, in_progress, done, review – w is in "review" (last), one column left is "done"
        assertTrue(s.moveTaskBy(w, -1, 0, TaskQuery.DEFAULT.withProject(web), TODAY))
        assertEquals("done", s.state.findTask(w)!!.status)
        assertTrue(s.state.findTask(w)!!.isDone)
    }

    @Test
    fun movingTaskToProjectWithOtherWorkflowMapsByCategory() {
        val s = store()
        val (web, _, _, docs) = tree(s)
        s.addStatus(web, "Review", "#a855f7", Status.IN_PROGRESS)
        val t = s.createTask(draft("t", project = web, status = "review"))
        s.moveToProject(arrayOf(t), docs)
        assertEquals(Status.IN_PROGRESS, s.state.findTask(t)!!.status)
        assertEquals("in_progress", remapStatus(s.state, docs, "review", Status.IN_PROGRESS))
    }

    @Test
    fun legacyStorageIsMigratedToV2() {
        val v1 =
            """{"projects":[{"id":"p1","name":"Web","color":"#6366f1","createdAt":"2026-10-01T00:00:00.000Z"}],
            |"tasks":[{"id":"a","title":"Old","description":"","status":"done","priority":"low","projectId":"p1","tags":[],
            |"dueDate":null,"estimateMinutes":null,"timeSpentMinutes":0,"subtasks":[],"createdAt":"2026-10-01T00:00:00.000Z",
            |"completedAt":"2026-10-02T00:00:00.000Z","order":0}],"settings":{"theme":"dark","pomodoroMinutes":25,"pageSize":25}}
            """.trimMargin()
        val (s, saved) = memoryStore(v1, key = LEGACY_STORAGE_KEY)
        s.initialize("")
        assertTrue(s.migratedFromLegacy)
        assertEquals(
            "Old",
            s.state.tasks
                .single()
                .title,
        )
        assertEquals(
            Status.DONE,
            s.state.tasks
                .single()
                .category,
        )
        assertEquals(Theme.DARK, s.state.settings.theme)
        val v2 = saved()!!
        assertTrue(v2.contains("\"schema\":2"), "persisted under the v2 key with the new schema")
        val r = parseImport(v1)
        assertTrue(r.ok, r.error)
        assertEquals(1, r.sourceSchema)
        assertEquals(2, parseImport(v2).sourceSchema)
    }

    @Test
    fun v2ImportRoundTripAndValidation() {
        val s = store()
        val (web, app) = tree(s)
        s.addStatus(web, "Review", "#a855f7", Status.IN_PROGRESS)
        s.createTask(draft("t", project = app, status = "review"))
        val json = s.exportJson()
        val r = parseImport(json)
        assertTrue(r.ok, r.error)
        assertEquals(serializeState(s.state, false), serializeState(r.state!!, false))
        assertEquals(
            app,
            r.state!!
                .projects
                .first { it.name == "App" }
                .id,
        )
        assertTrue(parseImport(json.replace("\"status\": \"review\"", "\"status\": \"nope\"")).error.contains("not a status"))
        val cyclic = json.replace("\"parentId\": null", "\"parentId\": \"$app\"")
        assertTrue(parseImport(cyclic).error.contains("cycle"), parseImport(cyclic).error)
        assertTrue(parseImport(json.replace("\"schema\": 2", "\"schema\": 7")).error.contains("Unsupported schema"))
    }

    @Test
    fun activityAndNotificationsUseWorkflowNames() {
        val s = store()
        val (web) = tree(s)
        s.addStatus(web, "Review", "#a855f7", Status.IN_PROGRESS)
        val t = s.createTask(draft("t", project = web))
        s.setStatus(t, "review")
        val entry = s.state.activity.last()
        assertEquals(ActivityType.STATUS, entry.type)
        assertEquals("To do" to "Review", entry.from to entry.to)
    }
}
