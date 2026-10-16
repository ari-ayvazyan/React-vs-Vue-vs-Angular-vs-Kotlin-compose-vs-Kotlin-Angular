package taskpilot

import kotlin.math.floor
import kotlin.math.min

/** Port of the spec's mulberry32 PRNG; Kotlin Int arithmetic wraps exactly like `| 0` / Math.imul. */
fun mulberry32(seed: Int): () -> Double {
    var a = seed
    return {
        a += 0x6D2B79F5
        var t = (a xor (a ushr 15)) * (1 or a)
        t = (t + (t xor (t ushr 7)) * (61 or t)) xor t
        (t xor (t ushr 14)).toUInt().toDouble() / 4294967296.0
    }
}

object Demo {
    const val SEED = 42
    const val DEFAULT_COUNT = 300

    val PROJECT_NAMES = listOf("Website", "Mobile App", "Marketing", "Infrastructure", "Hiring", "Personal")
    val PROJECT_COLORS = listOf("#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6")
    val TAGS = listOf("bug", "feature", "chore", "research", "design", "backend", "frontend", "urgent-fix", "meeting", "docs")
    val VERBS = listOf("Fix", "Build", "Review", "Write", "Design", "Refactor", "Test", "Plan", "Deploy", "Research")
    val NOUNS =
        listOf(
            "login flow",
            "dashboard",
            "API docs",
            "onboarding",
            "landing page",
            "CI pipeline",
            "invoice export",
            "search",
            "settings page",
            "release notes",
        )
    val ESTIMATES = listOf(15, 30, 60, 120, 240)
    const val ASSIGNEE_SEED = 7
    val MEMBERS =
        listOf(
            Member("m1", "Alex Kim", "#0ea5e9"),
            Member("m2", "Sam Rivera", "#f97316"),
            Member("m3", "Jordan Lee", "#22c55e"),
            Member("m4", "Taylor Brooks", "#a855f7"),
            Member("m5", "Morgan Patel", "#ef4444"),
        )
}

/**
 * Deterministic demo data. [nowMs] is the current instant and [today] the local epoch day
 * (both injected so the generator is pure and testable).
 */
fun generateDemoData(
    count: Int,
    nowMs: Long,
    today: Int,
    settings: Settings = Settings(),
): AppState {
    val r = mulberry32(Demo.SEED)

    fun pick(size: Int): Int = floor(r() * size).toInt()

    val nowIso = Dates.isoFromMillis(nowMs)
    val projects =
        Demo.PROJECT_NAMES.mapIndexed { i, name ->
            Project(id = "proj-${i + 1}", name = name, color = Demo.PROJECT_COLORS[i], createdAt = nowIso)
        }
    val orderCounters = IntArray(Status.entries.size)
    val tasks = ArrayList<Task>(count.coerceAtLeast(0))
    for (i in 0 until count) {
        val title = "${Demo.VERBS[pick(Demo.VERBS.size)]} ${Demo.NOUNS[pick(Demo.NOUNS.size)]} #${i + 1}"
        val sr = r()
        val status =
            when {
                sr < 0.45 -> Status.DONE
                sr < 0.65 -> Status.IN_PROGRESS
                else -> Status.TODO
            }
        val priority = Priority.entries[pick(4)]
        val projectId = if (r() < 0.1) null else projects[pick(6)].id
        val tagCount = pick(4)
        val tags = LinkedHashSet<String>()
        repeat(tagCount) { tags.add(Demo.TAGS[pick(10)]) }
        val dueDate = if (r() < 0.15) null else Dates.format(today + pick(60) - 25)
        val createdMs = nowMs - pick(60) * Dates.DAY_MS
        val completedAt =
            if (status == Status.DONE) {
                Dates.isoFromMillis(min(createdMs + pick(10) * Dates.DAY_MS, nowMs))
            } else {
                null
            }
        val estimate = Demo.ESTIMATES[pick(Demo.ESTIMATES.size)]
        val spent = pick(180)
        val subtaskCount = pick(4)
        val subtasks =
            (1..subtaskCount).map { n ->
                Subtask(id = "task-${i + 1}-s$n", title = "Step $n", done = r() < 0.5)
            }
        tasks +=
            Task(
                id = "task-${i + 1}",
                title = title,
                description = "Demo task ${i + 1}",
                status = status,
                priority = priority,
                projectId = projectId,
                tags = tags.toList(),
                dueDate = dueDate,
                estimateMinutes = estimate,
                timeSpentMinutes = spent,
                subtasks = subtasks,
                createdAt = Dates.isoFromMillis(createdMs),
                completedAt = completedAt,
                order = orderCounters[status.ordinal]++,
            )
    }
    return AppState(tasks = assignDemoMembers(tasks), projects = projects, settings = settings, members = Demo.MEMBERS)
}

/**
 * Assignees and recurrence come from a second PRNG (seed 7) so the base generator's sequence, and
 * therefore every other field, stays identical to the original spec output.
 */
internal fun assignDemoMembers(tasks: List<Task>): List<Task> {
    val r = mulberry32(Demo.ASSIGNEE_SEED)
    return tasks.map { t ->
        val k = floor(r() * 6).toInt()
        val recurrence = if (r() < 0.1) Recurrence.WEEKLY else Recurrence.NONE
        t.copy(assigneeId = if (k == 5) null else Demo.MEMBERS[k].id, recurrence = recurrence)
    }
}
