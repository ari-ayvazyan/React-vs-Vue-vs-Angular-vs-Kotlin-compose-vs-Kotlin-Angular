@file:OptIn(ExperimentalJsExport::class)

package taskpilot

import kotlin.js.Date

/**
 * Hand-written calendar arithmetic (no date library).
 * Dates are represented as "epoch days" (days since 1970-01-01) and formatted as `YYYY-MM-DD`.
 */
internal object CivilDate {
    const val MS_PER_DAY: Double = 86_400_000.0

    /** Howard Hinnant's days_from_civil. */
    fun daysFromCivil(
        year: Int,
        month: Int,
        day: Int,
    ): Int {
        val y = if (month <= 2) year - 1 else year
        val era = (if (y >= 0) y else y - 399) / 400
        val yoe = y - era * 400
        val mp = (month + 9) % 12
        val doy = (153 * mp + 2) / 5 + day - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    /** Returns (year, month 1-12, day). */
    fun civilFromDays(epochDay: Int): Triple<Int, Int, Int> {
        val z = epochDay + 719_468
        val era = (if (z >= 0) z else z - 146_096) / 146_097
        val doe = z - era * 146_097
        val yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val d = doy - (153 * mp + 2) / 5 + 1
        val m = if (mp < 10) mp + 3 else mp - 9
        val y = yoe + era * 400 + (if (m <= 2) 1 else 0)
        return Triple(y, m, d)
    }

    fun isLeap(year: Int): Boolean = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0

    fun daysInMonth(
        year: Int,
        month: Int,
    ): Int =
        when (month) {
            2 -> if (isLeap(year)) 29 else 28
            4, 6, 9, 11 -> 30
            else -> 31
        }

    /** 0 = Monday ... 6 = Sunday. 1970-01-01 was a Thursday. */
    fun weekdayMonFirst(epochDay: Int): Int = ((epochDay % 7) + 7 + 3) % 7
}

private fun pad(
    value: Int,
    width: Int = 2,
): String = value.toString().padStart(width, '0')

/** Formats an epoch day as `YYYY-MM-DD`. */
internal fun formatDay(epochDay: Int): String {
    val (y, m, d) = CivilDate.civilFromDays(epochDay)
    return "${pad(y, 4)}-${pad(m)}-${pad(d)}"
}

private val DATE_RE = Regex("""^(\d{4})-(\d{2})-(\d{2})$""")
private val DATE_TIME_RE =
    Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$""")

/** Parses a strict `YYYY-MM-DD` date into an epoch day, or null if invalid. */
internal fun parseDay(value: String?): Int? {
    if (value == null) return null
    val match = DATE_RE.matchEntire(value) ?: return null
    val y = match.groupValues[1].toInt()
    val m = match.groupValues[2].toInt()
    val d = match.groupValues[3].toInt()
    if (m !in 1..12 || d < 1 || d > CivilDate.daysInMonth(y, m)) return null
    return CivilDate.daysFromCivil(y, m, d)
}

/** Formats epoch milliseconds as a UTC ISO-8601 timestamp (like JS `toISOString`). */
internal fun formatInstant(epochMs: Double): String {
    val ms = kotlin.math.floor(epochMs)
    val day = kotlin.math.floor(ms / CivilDate.MS_PER_DAY).toInt()
    var rem = (ms - day * CivilDate.MS_PER_DAY).toInt()
    val hours = rem / 3_600_000
    rem %= 3_600_000
    val minutes = rem / 60_000
    rem %= 60_000
    val seconds = rem / 1000
    val millis = rem % 1000
    return "${formatDay(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}Z"
}

/** Parses an ISO-8601 timestamp (`Z` or `±HH:MM` offset) into epoch milliseconds, or null. */
internal fun parseInstant(value: String?): Double? {
    if (value == null) return null
    val m = DATE_TIME_RE.matchEntire(value) ?: return null
    val g = m.groupValues
    val day = parseDay("${g[1]}-${g[2]}-${g[3]}") ?: return null
    val h = g[4].toInt()
    val min = g[5].toInt()
    val s = g[6].ifEmpty { "0" }.toInt()
    if (h > 23 || min > 59 || s > 59) return null
    val frac = g[7].padEnd(3, '0').take(3).toInt()
    var offsetMinutes = 0
    if (g[8] != "Z") {
        val sign = if (g[8][0] == '-') -1 else 1
        offsetMinutes = sign * (g[8].substring(1, 3).toInt() * 60 + g[8].substring(4, 6).toInt())
    }
    return day * CivilDate.MS_PER_DAY + h * 3_600_000.0 + min * 60_000.0 + s * 1000.0 + frac - offsetMinutes * 60_000.0
}

/** Platform clock: the only place that touches the host's current time / time zone. */
internal object Clock {
    fun nowMs(): Double = Date.now()

    /** Local calendar day (epoch day) of the given instant in the host time zone. */
    fun localDay(epochMs: Double): Int {
        val d = Date(epochMs)
        return CivilDate.daysFromCivil(d.getFullYear(), d.getMonth() + 1, d.getDate())
    }

    fun today(): Int = localDay(nowMs())
}

/** Local calendar day of an ISO timestamp, or null when unparsable. */
internal fun localDayOfInstant(iso: String?): Int? = parseInstant(iso)?.let { Clock.localDay(it) }

private val MONTH_NAMES =
    arrayOf(
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    )

private val WEEKDAY_SHORT = arrayOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

/** Date helpers exported for templates. */
@JsExport
object DateFmt {
    /** Today's local date as `YYYY-MM-DD`. */
    fun today(): String = formatDay(Clock.today())

    /** Current instant as ISO-8601. */
    fun nowIso(): String = formatInstant(Clock.nowMs())

    fun addDays(
        date: String,
        days: Int,
    ): String = parseDay(date)?.let { formatDay(it + days) } ?: date

    fun isValidDate(date: String): Boolean = parseDay(date) != null

    fun monthName(month: Int): String = MONTH_NAMES[(month - 1).coerceIn(0, 11)]

    fun weekdayNames(): Array<String> = WEEKDAY_SHORT.copyOf()

    /** "Oct 16" style short label for a `YYYY-MM-DD` date. */
    fun short(date: String?): String {
        val day = parseDay(date) ?: return ""
        val (_, m, d) = CivilDate.civilFromDays(day)
        return "${MONTH_NAMES[m - 1].take(3)} $d"
    }

    /** "Fri, Oct 16, 2026" style label. */
    fun long(date: String?): String {
        val day = parseDay(date) ?: return ""
        val (y, m, d) = CivilDate.civilFromDays(day)
        return "${WEEKDAY_SHORT[CivilDate.weekdayMonFirst(day)]}, ${MONTH_NAMES[m - 1].take(3)} $d, $y"
    }

    /** Human relative label: "Today", "Tomorrow", "Yesterday", "in 3 days", "5 days ago". */
    fun relative(
        date: String?,
        today: String,
    ): String {
        val day = parseDay(date) ?: return ""
        val t = parseDay(today) ?: return ""
        return when (val diff = day - t) {
            0 -> "Today"
            1 -> "Tomorrow"
            -1 -> "Yesterday"
            else -> if (diff > 0) "in $diff days" else "${-diff} days ago"
        }
    }

    /** Local date part (`YYYY-MM-DD`) of an ISO timestamp. */
    fun localDate(iso: String?): String = localDayOfInstant(iso)?.let { formatDay(it) } ?: ""

    /** Formats minutes as "1h 05m" / "45m". */
    fun duration(minutes: Int): String {
        val h = minutes / 60
        val m = minutes % 60
        return if (h > 0) "${h}h ${pad(m)}m" else "${m}m"
    }

    /** Local "Oct 16, 2026, 14:05" for an ISO timestamp. */
    fun dateTime(iso: String?): String {
        val ms = parseInstant(iso) ?: return ""
        val d = Date(ms)
        return "${MONTH_NAMES[d.getMonth()].take(3)} ${d.getDate()}, ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}"
    }

    /** Relative age: "just now", "5 min ago", "3 h ago", "2 days ago", then a short date. */
    fun ago(
        iso: String?,
        nowIso: String,
    ): String {
        val then = parseInstant(iso) ?: return ""
        val now = parseInstant(nowIso) ?: return ""
        val minutes = ((now - then) / 60_000).toInt()
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "$minutes min ago"
            minutes < 24 * 60 -> "${minutes / 60} h ago"
            minutes < 7 * 24 * 60 -> "${minutes / (24 * 60)} days ago"
            else -> short(formatDay(Clock.localDay(then)))
        }
    }

    /** Formats seconds as "MM:SS". */
    fun clock(seconds: Int): String {
        val s = seconds.coerceAtLeast(0)
        return "${pad(s / 60)}:${pad(s % 60)}"
    }
}
