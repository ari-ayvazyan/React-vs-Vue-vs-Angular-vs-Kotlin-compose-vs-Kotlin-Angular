package taskpilot

/**
 * Minimal calendar arithmetic (no date libraries allowed).
 * Dates are represented as "epoch days" (days since 1970-01-01) and as 'YYYY-MM-DD' strings.
 */
object Dates {
    const val DAY_MS: Long = 86_400_000L

    /** Howard Hinnant's days_from_civil. */
    fun epochDay(year: Int, month: Int, day: Int): Int {
        val y = if (month <= 2) year - 1 else year
        val era = (if (y >= 0) y else y - 399) / 400
        val yoe = y - era * 400
        val mp = (month + 9) % 12
        val doy = (153 * mp + 2) / 5 + day - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    /** Returns (year, month 1..12, day 1..31). */
    fun civil(epochDay: Int): Triple<Int, Int, Int> {
        val z = epochDay + 719_468
        val era = (if (z >= 0) z else z - 146_096) / 146_097
        val doe = z - era * 146_097
        val yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        val y = yoe + era * 400
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val d = doy - (153 * mp + 2) / 5 + 1
        val m = if (mp < 10) mp + 3 else mp - 9
        return Triple(if (m <= 2) y + 1 else y, m, d)
    }

    fun format(epochDay: Int): String {
        val (y, m, d) = civil(epochDay)
        return "${y.toString().padStart(4, '0')}-${pad2(m)}-${pad2(d)}"
    }

    private val DATE_RE = Regex("""^(\d{4})-(\d{2})-(\d{2})$""")

    /** Parses 'YYYY-MM-DD' (strictly, rejecting impossible dates) to an epoch day. */
    fun parse(value: String): Int? {
        val match = DATE_RE.matchEntire(value) ?: return null
        val (y, m, d) = match.destructured
        val year = y.toInt()
        val month = m.toInt()
        val day = d.toInt()
        if (month !in 1..12 || day !in 1..daysInMonth(year, month)) return null
        return epochDay(year, month, day)
    }

    fun isLeap(year: Int): Boolean = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0

    fun daysInMonth(year: Int, month: Int): Int =
        when (month) {
            2 -> if (isLeap(year)) 29 else 28
            4, 6, 9, 11 -> 30
            else -> 31
        }

    /** 0 = Monday ... 6 = Sunday. */
    fun weekdayMonFirst(epochDay: Int): Int = Math2.floorMod(epochDay + 3, 7)

    /** ISO-8601 UTC timestamp for epoch milliseconds, e.g. 2024-01-02T03:04:05.006Z. */
    fun isoFromMillis(ms: Long): String {
        val day = Math2.floorDiv(ms, DAY_MS).toInt()
        val rem = ms - day.toLong() * DAY_MS
        val h = (rem / 3_600_000).toInt()
        val min = ((rem / 60_000) % 60).toInt()
        val s = ((rem / 1000) % 60).toInt()
        val milli = (rem % 1000).toInt()
        return "${format(day)}T${pad2(h)}:${pad2(min)}:${pad2(s)}.${milli.toString().padStart(3, '0')}Z"
    }

    private val ISO_RE = Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$""")

    /** Parses an ISO-8601 timestamp (Z or offset) to epoch millis; null if invalid. */
    fun millisFromIso(value: String): Long? {
        val m = ISO_RE.matchEntire(value) ?: return null
        val g = m.groupValues
        val day = parse("${g[1]}-${g[2]}-${g[3]}") ?: return null
        val h = g[4].toInt()
        val min = g[5].toInt()
        val s = g[6].ifEmpty { "0" }.toInt()
        if (h > 23 || min > 59 || s > 59) return null
        val frac = g[7].padEnd(3, '0').take(3).toInt()
        var ms = day.toLong() * DAY_MS + h * 3_600_000L + min * 60_000L + s * 1000L + frac
        val tz = g[8]
        if (tz != "Z") {
            val sign = if (tz[0] == '-') -1 else 1
            val offset = tz.substring(1, 3).toInt() * 60 + tz.substring(4, 6).toInt()
            ms -= sign * offset * 60_000L
        }
        return ms
    }

    /** Local calendar day of an ISO timestamp given the local UTC offset in minutes (east positive). */
    fun localDayOfIso(value: String, offsetMinutes: Int): Int? {
        val ms = millisFromIso(value) ?: return null
        return Math2.floorDiv(ms + offsetMinutes * 60_000L, DAY_MS).toInt()
    }

    private fun pad2(v: Int) = v.toString().padStart(2, '0')

    val MONTH_NAMES =
        listOf(
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

    val WEEKDAY_SHORT = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

    /** Short human label such as "Mar 5" (adds the year when it differs from [currentYear]). */
    fun shortLabel(epochDay: Int, currentYear: Int? = null): String {
        val (y, m, d) = civil(epochDay)
        val base = "${MONTH_NAMES[m - 1].take(3)} $d"
        return if (currentYear != null && currentYear != y) "$base, $y" else base
    }
}

internal object Math2 {
    fun floorMod(a: Int, b: Int): Int = ((a % b) + b) % b

    fun floorDiv(a: Long, b: Long): Long {
        val q = a / b
        return if ((a % b != 0L) && ((a xor b) < 0)) q - 1 else q
    }
}
