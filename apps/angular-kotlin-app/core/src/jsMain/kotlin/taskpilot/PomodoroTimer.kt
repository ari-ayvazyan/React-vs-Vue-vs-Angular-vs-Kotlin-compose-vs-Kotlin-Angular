@file:OptIn(ExperimentalJsExport::class)

package taskpilot

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * Pomodoro countdown state machine. Time is passed in explicitly (epoch ms) so it is deterministic and testable.
 * Methods that stop the clock return the whole minutes to credit to the task's `timeSpentMinutes`.
 */
@JsExport
class PomodoroTimer {
    var taskId: String? = null
        private set
    var running: Boolean = false
        private set
    var finished: Boolean = false
        private set
    var durationMinutes: Int = 25
        private set

    private var startedAt = 0.0
    private var accumulatedMs = 0.0
    private var creditedMinutes = 0

    val active: Boolean get() = taskId != null

    fun elapsedMs(nowMs: Double): Double = accumulatedMs + if (running) (nowMs - startedAt).coerceAtLeast(0.0) else 0.0

    fun remainingSeconds(nowMs: Double): Int {
        val remaining = durationMinutes * 60_000.0 - elapsedMs(nowMs)
        return ceil(remaining / 1000).toInt().coerceAtLeast(0)
    }

    /** 0..1 progress of the current pomodoro. */
    fun progress(nowMs: Double): Double = (elapsedMs(nowMs) / (durationMinutes * 60_000.0)).coerceIn(0.0, 1.0)

    /**
     * Starts or resumes the timer for [task]. Starting a different task while one is active is refused
     * (returns false); the caller should reset the other task first.
     */
    fun start(
        task: String,
        minutes: Int,
        nowMs: Double,
    ): Boolean {
        if (taskId != null && taskId != task) return false
        if (running) return true
        if (taskId == null || finished) {
            taskId = task
            durationMinutes = minutes.coerceIn(Limits.POMODORO_MIN, Limits.POMODORO_MAX)
            accumulatedMs = 0.0
            creditedMinutes = 0
            finished = false
        }
        startedAt = nowMs
        running = true
        return true
    }

    /** Pauses; returns whole minutes to credit now (partial minutes carry over). */
    fun pause(nowMs: Double): Int {
        if (!running) return 0
        accumulatedMs = elapsedMs(nowMs)
        running = false
        return creditWhole()
    }

    /** Advances the clock. Returns minutes to credit when the pomodoro just finished, otherwise -1. */
    fun tick(nowMs: Double): Int {
        if (!running) return -1
        val total = durationMinutes * 60_000.0
        if (elapsedMs(nowMs) < total) return -1
        accumulatedMs = total
        running = false
        finished = true
        return creditRounded()
    }

    /** Stops and clears the timer; returns remaining minutes to credit (rounded). */
    fun reset(nowMs: Double): Int {
        if (taskId == null) return 0
        accumulatedMs = elapsedMs(nowMs)
        running = false
        val credit = if (finished) 0 else creditRounded()
        taskId = null
        finished = false
        accumulatedMs = 0.0
        creditedMinutes = 0
        return credit
    }

    private fun creditWhole(): Int {
        val whole = floor(accumulatedMs / 60_000.0).toInt()
        val delta = whole - creditedMinutes
        creditedMinutes = whole
        return delta.coerceAtLeast(0)
    }

    private fun creditRounded(): Int {
        val rounded = (accumulatedMs / 60_000.0).roundToInt()
        val delta = rounded - creditedMinutes
        creditedMinutes = rounded
        return delta.coerceAtLeast(0)
    }
}
