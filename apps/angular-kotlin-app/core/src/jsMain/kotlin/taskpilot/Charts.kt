@file:OptIn(ExperimentalJsExport::class)

package taskpilot

import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

/** Geometry for hand-drawn SVG charts. All coordinates are in the SVG viewBox space. */
@JsExport
class ChartPoint(
    val x: Double,
    val y: Double,
    val value: Int,
    val label: String,
    val date: String,
)

@JsExport
class AxisTick(
    val position: Double,
    val label: String,
)

@JsExport
class LineChart(
    val width: Int,
    val height: Int,
    val left: Int,
    val right: Int,
    val top: Int,
    val bottom: Int,
    val linePath: String,
    val areaPath: String,
    val points: Array<ChartPoint>,
    val yTicks: Array<AxisTick>,
    val xTicks: Array<AxisTick>,
    val maxValue: Int,
    val total: Int,
)

@JsExport
class DonutArc(
    val path: String,
    val color: String,
    val label: String,
    val value: Int,
    val percent: Int,
)

@JsExport
class Donut(
    val arcs: Array<DonutArc>,
    val total: Int,
)

private fun fmt(v: Double): String = ((v * 100).roundToInt() / 100.0).toString()

/** "Nice" tick step (1, 2, 5 x 10^n) giving roughly four intervals for [maxValue]. */
internal fun niceStep(maxValue: Int): Int {
    if (maxValue <= 4) return 1
    val rawStep = maxValue / 4.0
    var magnitude = 1.0
    while (magnitude * 10 <= rawStep) magnitude *= 10
    return listOf(1.0, 2.0, 5.0, 10.0)
        .map { it * magnitude }
        .first { it >= rawStep }
        .toInt()
}

/** Upper bound of the y axis: the smallest multiple of [niceStep] covering [maxValue] (at least 4). */
internal fun niceMax(maxValue: Int): Int {
    if (maxValue <= 4) return 4
    val step = niceStep(maxValue)
    return ceil(maxValue.toDouble() / step).toInt() * step
}

/** Builds a line + area chart for a daily series. */
@JsExport
fun buildLineChart(
    series: Array<DayCount>,
    width: Int,
    height: Int,
): LineChart {
    val left = 36
    val right = 12
    val top = 12
    val bottom = 28
    val plotW = (width - left - right).toDouble()
    val plotH = (height - top - bottom).toDouble()
    val maxValue = niceMax(series.maxOfOrNull { it.count } ?: 0)
    val n = max(series.size - 1, 1)
    val points =
        series
            .mapIndexed { i, d ->
                ChartPoint(
                    x = left + plotW * i / n,
                    y = top + plotH - plotH * d.count / maxValue,
                    value = d.count,
                    label = d.label,
                    date = d.date,
                )
            }.toTypedArray()
    val line = points.mapIndexed { i, p -> "${if (i == 0) "M" else "L"}${fmt(p.x)},${fmt(p.y)}" }.joinToString(" ")
    val baseY = fmt(top + plotH)
    val area =
        if (points.isEmpty()) {
            ""
        } else {
            "$line L${fmt(points.last().x)},$baseY L${fmt(points.first().x)},$baseY Z"
        }
    val step = niceStep(maxValue)
    val yTicks =
        (0..maxValue step step)
            .map { v -> AxisTick(top + plotH - plotH * v / maxValue, v.toString()) }
            .toTypedArray()
    val xTicks =
        points
            .filterIndexed { i, _ -> (points.size - 1 - i) % 7 == 0 }
            .map { AxisTick(it.x, it.label) }
            .toTypedArray()
    return LineChart(
        width,
        height,
        left,
        right,
        top,
        bottom,
        line,
        area,
        points,
        yTicks,
        xTicks,
        maxValue,
        series.sumOf { it.count },
    )
}

/** Builds donut arcs (outer radius [r], inner radius [inner]) centred at ([cx], [cy]). */
@JsExport
fun buildDonut(
    slices: Array<PrioritySlice>,
    cx: Double,
    cy: Double,
    r: Double,
    inner: Double,
): Donut {
    val total = slices.sumOf { it.count }
    if (total == 0) return Donut(emptyArray(), 0)
    var angle = -PI / 2
    val arcs =
        slices.filter { it.count > 0 }.map { s ->
            val sweep = 2 * PI * s.count / total
            val path =
                if (s.count == total) {
                    // Full ring: two half arcs (a single arc cannot span 360 degrees).
                    val o = "M${fmt(cx)},${fmt(cy - r)} A$r,$r 0 1 1 ${fmt(cx)},${fmt(cy + r)} A$r,$r 0 1 1 ${fmt(cx)},${fmt(cy - r)} Z"
                    val i =
                        "M${fmt(cx)},${fmt(cy - inner)} A$inner,$inner 0 1 0 ${fmt(cx)},${fmt(cy + inner)} " +
                            "A$inner,$inner 0 1 0 ${fmt(cx)},${fmt(cy - inner)} Z"
                    "$o $i"
                } else {
                    arcPath(cx, cy, r, inner, angle, angle + sweep)
                }
            angle += sweep
            DonutArc(path, s.color, s.label, s.count, percent(s.count, total))
        }
    return Donut(arcs.toTypedArray(), total)
}

private fun arcPath(
    cx: Double,
    cy: Double,
    r: Double,
    inner: Double,
    start: Double,
    end: Double,
): String {
    val large = if (end - start > PI) 1 else 0
    val x1 = cx + r * cos(start)
    val y1 = cy + r * sin(start)
    val x2 = cx + r * cos(end)
    val y2 = cy + r * sin(end)
    val x3 = cx + inner * cos(end)
    val y3 = cy + inner * sin(end)
    val x4 = cx + inner * cos(start)
    val y4 = cy + inner * sin(start)
    return "M${fmt(x1)},${fmt(y1)} A$r,$r 0 $large 1 ${fmt(x2)},${fmt(y2)} " +
        "L${fmt(x3)},${fmt(y3)} A$inner,$inner 0 $large 0 ${fmt(x4)},${fmt(y4)} Z"
}

/** Index of the chart point closest to viewBox x-coordinate [x] (for hover tooltips), or -1 when empty. */
@JsExport
fun nearestPointIndex(
    chart: LineChart,
    x: Double,
): Int {
    if (chart.points.isEmpty()) return -1
    return chart.points.indices.minBy { kotlin.math.abs(chart.points[it].x - x) }
}

@JsExport
class BarRow(
    val key: String,
    val label: String,
    val value: Int,
    val color: String,
    /** Top of the bar band. */
    val y: Double,
    /** Bar width in viewBox units (0 for a zero value). */
    val width: Double,
)

@JsExport
class BarChart(
    val width: Int,
    val height: Int,
    /** x where bars start (labels are drawn right-aligned left of it). */
    val left: Int,
    val barHeight: Int,
    val rows: Array<BarRow>,
    val xTicks: Array<AxisTick>,
    val maxValue: Int,
)

/** Horizontal bar chart geometry for open tasks per assignee. */
@JsExport
fun buildAssigneeBars(
    loads: Array<AssigneeLoad>,
    width: Int,
): BarChart {
    val left = 120
    val right = 36
    val top = 4
    val barHeight = 22
    val gap = 14
    val axis = 22
    val plotW = (width - left - right).toDouble()
    val maxValue = niceMax(loads.maxOfOrNull { it.open } ?: 0)
    val rows =
        loads
            .mapIndexed { i, l ->
                BarRow(
                    key = l.memberId,
                    label = l.name,
                    value = l.open,
                    color = l.color,
                    y = (top + i * (barHeight + gap)).toDouble(),
                    width = plotW * l.open / maxValue,
                )
            }.toTypedArray()
    val step = niceStep(maxValue)
    val ticks = (0..maxValue step step).map { v -> AxisTick(left + plotW * v / maxValue, v.toString()) }.toTypedArray()
    val height = top + loads.size * (barHeight + gap) - gap + axis + 8
    return BarChart(width, height, left, barHeight, rows, ticks, maxValue)
}
