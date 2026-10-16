package taskpilot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorkflowsTest {
    private val review = WorkflowStatus("review", "Review", "#000000", Status.IN_PROGRESS)
    private val custom =
        listOf(
            WorkflowStatus("backlog", "Backlog", "#111111", Status.TODO),
            WorkflowStatus("doing", "Doing", "#222222", Status.IN_PROGRESS),
            review,
            WorkflowStatus("shipped", "Shipped", "#333333", Status.DONE),
        )
    private val projects =
        listOf(
            Project("root", "Root", "#000000", iso(0), workflow = custom),
            Project("child", "Child", "#000000", iso(0), parentId = "root"),
            Project("grand", "Grand", "#000000", iso(0), parentId = "child"),
            Project("other", "Other", "#000000", iso(0)),
        )

    @Test
    fun treeHelpers() {
        assertEquals(setOf("root", "child", "grand"), descendantIds(projects, "root"))
        assertEquals(listOf("child", "root"), ancestors(projects, "grand").map { it.id })
        assertEquals("Root › Child › Grand", projectPath(projects, "grand"))
        assertEquals(listOf("root" to 0, "child" to 1, "grand" to 2, "other" to 0), projectTree(projects).map { it.project.id to it.depth })
        assertFalse(canSetParent(projects, "root", "grand"))
        assertFalse(canSetParent(projects, "root", "root"))
        assertTrue(canSetParent(projects, "other", "grand"))
        assertTrue(canSetParent(projects, "grand", null))
    }

    @Test
    fun workflowInheritance() {
        assertEquals(custom, effectiveWorkflow(projects, "grand"))
        assertEquals(DEFAULT_WORKFLOW, effectiveWorkflow(projects, "other"))
        assertEquals(DEFAULT_WORKFLOW, effectiveWorkflow(projects, null))
        assertEquals("root", workflowOwner(projects, "grand")?.id)
        assertNull(workflowOwner(projects, "other"))
        val customised = projects.map { if (it.id == "child") it.copy(workflow = DEFAULT_WORKFLOW) else it }
        assertEquals(DEFAULT_WORKFLOW, effectiveWorkflow(customised, "grand"))
        assertEquals(setOf("root"), projectsUsingWorkflowOf(customised, "root"))
    }

    @Test
    fun normalizeMapsStatusIdsByCategory() {
        val tasks =
            listOf(
                task("a", projectId = "grand"), // v1 data: statusId "todo" not in custom workflow
                task("b", projectId = "child").copy(status = Status.IN_PROGRESS, statusId = "review"),
                task("c", projectId = "root").withStatus(Status.DONE, iso(0)), // category change hint
                task("d", projectId = "other"),
            )
        val n = normalizeTasks(tasks, projects)
        assertEquals(listOf("backlog", "review", "shipped", "todo"), n.map { it.statusId })
        assertEquals(n, normalizeTasks(n, projects))
        assertEquals("Review", n[1].workflowStatus(projects).name)
    }

    @Test
    fun workflowValidation() {
        assertNull(validateWorkflow(custom))
        assertTrue(validateWorkflow(custom.filterNot { it.category == Status.DONE })!!.contains("Done"))
        assertNotNull(validateWorkflow(custom + custom[0]))
        assertNotNull(validateWorkflow(custom + WorkflowStatus("x", "review", "#000000", Status.TODO)))
        assertEquals("ready_for_qa", newStatusId("Ready for QA!", custom))
        assertEquals("review_2", newStatusId("Review", custom))
    }

    @Test
    fun deletingAStatusMovesTasks() {
        val tasks =
            listOf(task("a", projectId = "grand").copy(status = Status.IN_PROGRESS, statusId = "review"), task("b", projectId = "other"))
        val (p2, t2) = deleteWorkflowStatus(projects, tasks, "root", "review", "shipped", iso(0))!!
        assertEquals(3, p2.first { it.id == "root" }.workflow!!.size)
        assertEquals("shipped", t2[0].statusId)
        assertEquals(Status.DONE, t2[0].status)
        assertEquals(iso(0), t2[0].completedAt)
        assertEquals(tasks[1], t2[1])
        // The last status of a category cannot be removed.
        assertNull(deleteWorkflowStatus(projects, tasks, "root", "shipped", "doing", iso(0)))
    }

    @Test
    fun deletingAProjectHandlesSubProjects() {
        val tasks = listOf(task("a", projectId = "root"), task("b", projectId = "child"), task("c", projectId = "grand"))
        val (up, upTasks) = deleteProjectTree(projects, tasks, "root", SubProjectAction.MOVE_UP, deleteTasks = false)
        assertEquals(listOf("child", "grand", "other"), up.map { it.id })
        assertNull(up.first { it.id == "child" }.parentId)
        assertEquals(custom, up.first { it.id == "child" }.workflow) // keeps the workflow it inherited
        assertEquals(listOf(null, "child", "grand"), upTasks.map { it.projectId })
        assertEquals("todo", upTasks[0].statusId) // re-normalised to the default workflow
        val (del, delTasks) = deleteProjectTree(projects, tasks, "root", SubProjectAction.DELETE, deleteTasks = true)
        assertEquals(listOf("other"), del.map { it.id })
        assertTrue(delTasks.isEmpty())
    }

    @Test
    fun filtersAndProgressIncludeDescendants() {
        val tasks =
            listOf(
                task("a", projectId = "root"),
                task("b", projectId = "grand", status = Status.DONE),
                task("c", projectId = "other"),
            )
        assertEquals(listOf("a", "b"), filterTasks(tasks, TaskQuery(project = "root"), TODAY, projects).map { it.id })
        assertEquals(listOf("b"), filterTasks(tasks, TaskQuery(project = "child"), TODAY, projects).map { it.id })
        assertEquals(listOf("a"), filterTasks(tasks, TaskQuery(project = "root"), TODAY).map { it.id })
        val progress = projectProgressWithDescendants(tasks, projects, projects.filter { it.parentId == null })
        assertEquals(listOf(2 to 1, 1 to 0), progress.map { it.total to it.done })
        assertEquals(
            2,
            burndown(tasks.map { it.copy(createdAt = iso(-3)) }, CLOCK, "root", projects = projects)
                .first {
                    it.first ==
                        TODAY - 2
                }.second,
        )
    }

    @Test
    fun workflowBoardColumns() {
        val tasks =
            listOf(
                task("a", projectId = "root").copy(statusId = "backlog", order = 0),
                task("b", projectId = "root").copy(status = Status.IN_PROGRESS, statusId = "review", order = 0),
                task("c", projectId = "other").copy(status = Status.IN_PROGRESS, statusId = "in_progress", order = 1),
            )
        assertEquals(listOf("backlog", "review", "doing"), tasks.map { workflowColumnKey(it, custom) })
        val key = { t: Task -> workflowColumnKey(t, custom) }
        val moved = moveTaskTo(tasks, "a", "review", 0, key) { applyWorkflowColumn(it, review, projects, iso(0)) }
        assertEquals("review", moved.first { it.id == "a" }.statusId)
        assertEquals(Status.IN_PROGRESS, moved.first { it.id == "a" }.status)
        assertEquals(listOf("a", "b"), columnTasksBy(moved, "review", key).map { it.id })
        val done = applyWorkflowColumn(tasks[2], custom.last(), projects, iso(0))
        assertEquals("done", done.statusId) // "other" uses the default workflow: first done-category status
        assertEquals(iso(0), done.completedAt)
        val keys = custom.map { it.id }
        val kb =
            moveTaskByKeyboardIn(tasks, "b", 1, 0, keys, key) { k ->
                { t: Task ->
                    applyWorkflowColumn(t, custom.first { it.id == k }, projects, iso(0))
                }
            }
        assertEquals("shipped", kb.first { it.id == "b" }.statusId)
    }

    @Test
    fun migrationFromV1AndImportOfV2() {
        val v1 =
            """{"tasks":[{"id":"t","title":"Old","status":"in_progress","priority":"low","projectId":"p","createdAt":"2024-01-01T00:00:00Z"}],
               "projects":[{"id":"p","name":"P","color":"#000000","createdAt":"2024-01-01T00:00:00Z"}],"settings":{"theme":"dark"}}"""
        val migrated = decodeStoredState(v1)!!
        assertEquals(SCHEMA_VERSION, migrated.schemaVersion)
        assertEquals("in_progress", migrated.tasks[0].statusId)
        assertNull(migrated.projects[0].parentId)
        val imported = importState(v1)
        assertIs<ImportResult.Ok>(imported)
        // v2 round trip with workflow + sub-project.
        val state =
            AppState(
                tasks =
                    normalizeTasks(
                        listOf(task("x", projectId = "grand").copy(status = Status.IN_PROGRESS, statusId = "review")),
                        projects,
                    ),
                projects = projects,
            )
        val back = importState(exportState(state))
        assertIs<ImportResult.Ok>(back)
        assertEquals(state.projects, back.state.projects)
        assertEquals("review", back.state.tasks[0].statusId)
        assertTrue(exportState(state).contains("\"schemaVersion\": 2"))
        val cyclic = exportState(state.copy(projects = projects.map { if (it.id == "root") it.copy(parentId = "grand") else it }))
        val err = importState(cyclic)
        assertIs<ImportResult.Error>(err)
        assertTrue(err.message.contains("cycle"), err.message)
        val badWorkflow =
            exportState(
                state.copy(
                    projects =
                        projects.map {
                            if (it.id ==
                                "root"
                            ) {
                                it.copy(workflow = custom.dropLast(1))
                            } else {
                                it
                            }
                        },
                ),
            )
        assertIs<ImportResult.Error>(importState(badWorkflow))
        assertIs<ImportResult.Error>(importState("""{"schemaVersion":3,"tasks":[],"projects":[]}"""))
    }
}
