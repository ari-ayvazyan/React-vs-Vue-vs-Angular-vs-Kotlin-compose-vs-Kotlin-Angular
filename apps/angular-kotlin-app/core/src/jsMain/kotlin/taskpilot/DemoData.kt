@file:OptIn(ExperimentalJsExport::class)

package taskpilot

import kotlin.math.floor
import kotlin.math.min

/**
 * Kotlin port of the spec's mulberry32 PRNG. Kotlin/JS compiles `Int * Int` to `Math.imul`,
 * and `ushr` matches JS `>>>`, so the sequence is bit-identical to the JS reference.
 */
@JsExport
class Mulberry32(
    seed: Int,
) {
    private var a: Int = seed

    fun next(): Double {
        a += 0x6D2B79F5
        var t = (a xor (a ushr 15)) * (1 or a)
        t = (t + (t xor (t ushr 7)) * (61 or t)) xor t
        return (t xor (t ushr 14)).toUInt().toDouble() / 4_294_967_296.0
    }
}

internal object DemoConstants {
    val PROJECT_NAMES = arrayOf("Website", "Mobile App", "Marketing", "Infrastructure", "Hiring", "Personal")
    val PROJECT_COLORS = arrayOf("#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6")
    val TAGS = arrayOf("bug", "feature", "chore", "research", "design", "backend", "frontend", "urgent-fix", "meeting", "docs")
    val VERBS = arrayOf("Fix", "Build", "Review", "Write", "Design", "Refactor", "Test", "Plan", "Deploy", "Research")
    val NOUNS =
        arrayOf(
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
    val PRIORITIES = arrayOf(Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.URGENT)
    val ESTIMATES = arrayOf(15, 30, 60, 120, 240)
    val MEMBER_NAMES = arrayOf("Alex Kim", "Sam Rivera", "Jordan Lee", "Taylor Brooks", "Morgan Patel")
    val MEMBER_COLORS = arrayOf("#0ea5e9", "#f97316", "#22c55e", "#a855f7", "#ef4444")
    const val SEED = 42
    const val ASSIGNMENT_SEED = 7
    const val DEFAULT_COUNT = 300
}

/**
 * Deterministic demo data (seed 42). `nowMs` / `today` are injectable for tests;
 * dates are relative to them, everything else is identical across runs.
 */
internal fun generateDemoState(
    count: Int,
    nowMs: Double,
    today: Int,
    settings: Settings = Settings.DEFAULT,
): AppState {
    val r = Mulberry32(DemoConstants.SEED)

    fun pick(n: Int): Int = floor(r.next() * n).toInt()

    val nowIso = formatInstant(nowMs)
    val projects =
        DemoConstants.PROJECT_NAMES
            .mapIndexed { i, name -> Project("p${i + 1}", name, DemoConstants.PROJECT_COLORS[i], nowIso) }
            .toTypedArray()
    val orderCounters = mutableMapOf<String, Int>()
    val tasks = ArrayList<Task>(count.coerceAtLeast(0))
    for (i in 0 until count) {
        val title = "${DemoConstants.VERBS[
            pick(
                DemoConstants.VERBS.size,
            ),
        ]} ${DemoConstants.NOUNS[pick(DemoConstants.NOUNS.size)]} #${i + 1}"
        val sr = r.next()
        val status =
            when {
                sr < 0.45 -> Status.DONE
                sr < 0.65 -> Status.IN_PROGRESS
                else -> Status.TODO
            }
        val priority = DemoConstants.PRIORITIES[pick(4)]
        val projectId = if (r.next() < 0.1) null else projects[pick(6)].id
        val tags = LinkedHashSet<String>()
        repeat(pick(4)) { tags.add(DemoConstants.TAGS[pick(10)]) }
        val dueDate = if (r.next() < 0.15) null else formatDay(today + pick(60) - 25)
        val createdMs = nowMs - pick(60) * CivilDate.MS_PER_DAY
        val completedAt =
            if (status == Status.DONE) {
                formatInstant(min(createdMs + pick(10) * CivilDate.MS_PER_DAY, nowMs))
            } else {
                null
            }
        val estimate = DemoConstants.ESTIMATES[pick(5)]
        val spent = pick(180)
        val subtasks =
            Array(pick(4)) { s ->
                Subtask("t${i + 1}-s${s + 1}", "Step ${s + 1}", r.next() < 0.5)
            }
        val order = orderCounters.getOrElse(status) { 0 }
        orderCounters[status] = order + 1
        tasks.add(
            Task(
                id = "t${i + 1}",
                title = title,
                description = "Demo task ${i + 1}",
                status = status,
                priority = priority,
                projectId = projectId,
                tags = tags.toTypedArray(),
                dueDate = dueDate,
                estimateMinutes = estimate,
                timeSpentMinutes = spent,
                subtasks = subtasks,
                createdAt = formatInstant(createdMs),
                completedAt = completedAt,
                order = order,
                assigneeId = null,
                recurrence = Recurrence.NONE,
            ),
        )
    }
    val members = demoMembers()
    return AppState(assignDemoMembers(tasks, members).toTypedArray(), projects, settings, members)
}

internal fun demoMembers(): Array<Member> =
    DemoConstants.MEMBER_NAMES
        .mapIndexed { i, name -> Member("m${i + 1}", name, DemoConstants.MEMBER_COLORS[i]) }
        .toTypedArray()

/**
 * Second pass with its own PRNG (seed 7) so the original task stream stays byte-identical:
 * per task, `k = floor(r()*6)` (5 = unassigned) and then `r() < 0.1` → weekly recurrence.
 */
internal fun assignDemoMembers(
    tasks: List<Task>,
    members: Array<Member>,
): List<Task> {
    val r = Mulberry32(DemoConstants.ASSIGNMENT_SEED)
    return tasks.map { t ->
        val k = floor(r.next() * 6).toInt()
        val weekly = r.next() < 0.1
        t.copy(
            assigneeId = if (k == 5) null else members[k].id,
            recurrence = if (weekly) Recurrence.WEEKLY else Recurrence.NONE,
        )
    }
}

/** Spec entry point: `generateDemoData(count)` relative to the current time. */
@JsExport
fun generateDemoData(count: Int): AppState = generateDemoState(count, Clock.nowMs(), Clock.today())
