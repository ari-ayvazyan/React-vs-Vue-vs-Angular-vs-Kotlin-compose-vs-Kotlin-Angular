package taskpilot.web

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.browser.window
import kotlin.math.roundToLong

/**
 * Global pomodoro timer (one at a time). Lives outside any page so it keeps running while
 * navigating; the top bar shows a mini indicator. Elapsed time is logged to the task's
 * `timeSpentMinutes` on pause, finish and reset.
 */
object Pomodoro {
    var taskId by mutableStateOf<String?>(null)
        private set
    var durationMs by mutableStateOf(25 * 60_000L)
        private set
    private var remainingAtStart by mutableStateOf(25 * 60_000L)
    var runningSince by mutableStateOf<Long?>(null)
        private set
    private var carryMs = 0L

    /** Ticks every 250ms while running to drive the display. */
    var now by mutableStateOf(Platform.nowMs())
        private set
    private var interval: Int? = null

    val running: Boolean get() = runningSince != null

    fun remainingMs(): Long {
        val since = runningSince ?: return remainingAtStart
        return (remainingAtStart - (now - since)).coerceAtLeast(0)
    }

    fun isFor(id: String) = taskId == id

    fun start(id: String) {
        if (taskId != null && taskId != id) {
            if (running) pause()
            reset(log = true)
        }
        if (taskId != id) {
            taskId = id
            durationMs = Store.settings.pomodoroMinutes * 60_000L
            remainingAtStart = durationMs
            carryMs = 0
        }
        if (running) return
        if (remainingAtStart <= 0) remainingAtStart = durationMs
        now = Platform.nowMs()
        runningSince = now
        interval = window.setInterval({ tick() }, 250)
    }

    private fun tick() {
        now = Platform.nowMs()
        if (running && remainingMs() <= 0) finish()
    }

    private fun stopTicking() {
        interval?.let { window.clearInterval(it) }
        interval = null
    }

    fun pause() {
        val since = runningSince ?: return
        val t = Platform.nowMs()
        val elapsed = (t - since).coerceAtMost(remainingAtStart)
        remainingAtStart -= elapsed
        runningSince = null
        stopTicking()
        log(elapsed, round = false)
    }

    fun reset(log: Boolean = true) {
        val since = runningSince
        if (since != null) {
            val elapsed = (Platform.nowMs() - since).coerceAtMost(remainingAtStart)
            runningSince = null
            stopTicking()
            if (log) log(elapsed, round = true)
        } else if (log) {
            log(0, round = true)
        }
        remainingAtStart = durationMs
    }

    private fun finish() {
        val id = taskId
        reset(log = true)
        val title = id?.let { Store.task(it)?.title } ?: "task"
        Store.toast("Pomodoro finished for \"$title\" — time logged.", tone = "success")
    }

    /** Stops without logging (task deleted / data replaced). */
    fun discard() {
        runningSince = null
        stopTicking()
        taskId = null
        carryMs = 0
    }

    private fun log(elapsedMs: Long, round: Boolean) {
        val id = taskId ?: return
        val total = carryMs + elapsedMs
        val minutes = if (round) (total / 60_000.0).roundToLong() else total / 60_000
        carryMs = if (round) 0 else total % 60_000
        if (minutes > 0) Store.updateTask(id) { it.copy(timeSpentMinutes = it.timeSpentMinutes + minutes.toInt()) }
    }

    fun format(ms: Long): String {
        val totalSec = (ms + 999) / 1000
        val m = totalSec / 60
        val s = totalSec % 60
        return "${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}"
    }
}
