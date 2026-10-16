package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.browser.window
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.CheckboxInput
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.H1
import org.jetbrains.compose.web.dom.H2
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Li
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Section
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import org.jetbrains.compose.web.dom.Ul
import org.jetbrains.compose.web.svg.Defs
import org.jetbrains.compose.web.svg.Marker
import org.jetbrains.compose.web.svg.Path
import org.jetbrains.compose.web.svg.Svg
import org.w3c.dom.HTMLElement
import org.w3c.dom.events.Event
import org.w3c.dom.events.MouseEvent
import taskpilot.Dates
import taskpilot.Status
import taskpilot.TimelineBar
import taskpilot.TimelineRow
import taskpilot.Zoom
import taskpilot.dependencyLinks
import taskpilot.dueAfterDrag
import taskpilot.isOverdue
import taskpilot.timelineBars
import taskpilot.timelineRange
import taskpilot.timelineRows
import taskpilot.timelineTicks
import taskpilot.visibleRows
import taskpilot.web.Router
import taskpilot.web.Store
import taskpilot.web.ui.Avatar
import taskpilot.web.ui.EmptyState
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconView
import taskpilot.web.ui.Link
import taskpilot.web.ui.PriorityBadge

private const val ROW_H = 32.0
private const val HEADER_H = 44.0

/** An in-progress drag of a bar's right edge. */
private data class EdgeDrag(val taskId: String, val startX: Double, val originalDue: Int, val start: Int, val preview: Int)

private fun px(v: Double) = "${kotlin.math.round(v * 10) / 10}px"

/**
 * `/timeline`: Gantt-style chart. Rows are virtualised (only rows near the viewport are in the
 * DOM) so ?seed=1000 stays smooth; dependency arrows are drawn in one SVG overlay.
 */
@Composable
fun TimelinePage() {
    val params = Router.params()
    val zoom = Zoom.fromKey(params["zoom"])
    val hideDone = params["done"] == "hide"
    val clock = Store.clock()
    val today = clock.today
    val all = Store.tasks
    val source = remember(all, hideDone) { if (hideDone) all.filter { it.status != Status.DONE } else all }
    val split = remember(source, clock.offsetMinutes) { timelineBars(source, clock.offsetMinutes) }
    val (bars, undated) = split
    val range = remember(bars, today) { timelineRange(bars, today) }
    var collapsed by remember { mutableStateOf(setOf<String>()) }
    val rows = remember(bars, Store.projects, collapsed) { timelineRows(bars, Store.projects, collapsed) }
    val links = remember(rows) { dependencyLinks(rows) }
    // Narrower task-name column on phones; CSS reads the same value through --label-w.
    val labelW = if (window.innerWidth < 768) 132.0 else 260.0
    val ppd = zoom.pxPerDay
    val chartW = range.count() * ppd
    val totalH = rows.size * ROW_H

    fun x(day: Int) = labelW + (day - range.first) * ppd

    var scrollTop by remember { mutableStateOf(0.0) }
    var viewportH by remember { mutableStateOf(600.0) }
    val scroller = remember { arrayOfNulls<HTMLElement>(1) }
    var drag by remember { mutableStateOf<EdgeDrag?>(null) }

    fun setParam(key: String, value: String?) {
        val next = params.toMutableMap()
        if (value == null) next.remove(key) else next[key] = value
        Router.navigate(Router.buildUrl("/timeline", next.entries.sortedBy { it.key }.map { it.key to it.value }), replace = true)
    }

    fun scrollToToday() {
        val el = scroller[0] ?: return
        el.scrollLeft = (x(today) - labelW - (el.clientWidth - labelW) / 3).coerceAtLeast(0.0)
    }
    // Centre on today initially and whenever the zoom changes.
    LaunchedEffect(zoom, range.first) { window.requestAnimationFrame { scrollToToday() } }

    // Window-level listeners while dragging a bar edge (mouse and touch).
    DisposableEffect(drag?.taskId) {
        val d = drag
        if (d == null) {
            onDispose { }
        } else {
            fun clientX(e: Event): Double =
                if (e is MouseEvent) {
                    e.clientX.toDouble()
                } else {
                    (
                        e
                            .asDynamic()
                            .touches
                            ?.get(0)
                            ?.clientX as? Number
                    )?.toDouble()
                        ?: (
                            e
                                .asDynamic()
                                .changedTouches
                                ?.get(0)
                                ?.clientX as? Number
                        )?.toDouble() ?: d.startX
                }
            val move: (Event) -> Unit = { e ->
                val cur = drag
                if (cur != null) {
                    e.preventDefault()
                    val next = dueAfterDrag(cur.originalDue, cur.start, clientX(e) - cur.startX, ppd)
                    if (next != cur.preview) drag = cur.copy(preview = next)
                }
            }
            val up: (Event) -> Unit = {
                val cur = drag
                drag = null
                if (cur != null && cur.preview != cur.originalDue) {
                    val due = Dates.format(cur.preview)
                    Store.updateTask(cur.taskId) { it.copy(dueDate = due) }
                    Store.toast("Due date moved to ${Dates.shortLabel(cur.preview)}", actionLabel = "Undo") { Store.undo() }
                }
            }
            window.addEventListener("mousemove", move)
            window.addEventListener("mouseup", up)
            window.addEventListener("touchmove", move)
            window.addEventListener("touchend", up)
            onDispose {
                window.removeEventListener("mousemove", move)
                window.removeEventListener("mouseup", up)
                window.removeEventListener("touchmove", move)
                window.removeEventListener("touchend", up)
            }
        }
    }

    Div({ classes("page-header") }) {
        Div {
            H1 { Text("Timeline") }
            P({ classes("subtitle") }) {
                Text("${bars.size} scheduled · ${undated.size} without due date · drag a bar's right edge to change its due date")
            }
        }
        Div({ classes("timeline-tools") }) {
            Label(attrs = { classes("check-label") }) {
                CheckboxInput(hideDone) {
                    attr("data-testid", "timeline-hide-done")
                    onChange { setParam("done", if (it.value) "hide" else null) }
                }
                Text("Hide done")
            }
            Div({
                classes("segmented")
                attr("role", "group")
                attr("aria-label", "Zoom")
            }) {
                Zoom.entries.forEach { z ->
                    Button({
                        classes("seg-btn")
                        if (z == zoom) classes("on")
                        attr("type", "button")
                        attr("aria-pressed", (z == zoom).toString())
                        attr("data-testid", "zoom-${z.key}")
                        onClick { setParam("zoom", if (z == Zoom.MONTH) null else z.key) }
                    }) { Text(z.label) }
                }
            }
            Button({
                classes("btn", "btn-sm")
                attr("type", "button")
                attr("data-testid", "timeline-today")
                onClick { scrollToToday() }
            }) { Text("Today") }
        }
    }

    if (bars.isEmpty()) {
        EmptyState("Nothing scheduled", "Tasks with a due date appear here as bars from their creation date to their due date.")
    } else {
        Div({
            classes("timeline-scroll")
            attr("data-testid", "timeline")
            attr("role", "region")
            attr("aria-label", "Timeline chart, ${zoom.label.lowercase()} zoom")
            attr("tabindex", "0")
            ref { el ->
                scroller[0] = el
                viewportH = el.clientHeight.toDouble()
                onDispose { scroller[0] = null }
            }
            onScroll { e ->
                val el = e.target as HTMLElement
                val top = (el.scrollTop - HEADER_H).coerceAtLeast(0.0)
                // Only recompose when the visible row window can change.
                if (kotlin.math.abs(top - scrollTop) >= ROW_H || top == 0.0) scrollTop = top
                viewportH = el.clientHeight.toDouble()
            }
        }) {
            Div({
                classes("timeline-canvas")
                style {
                    property("width", px(labelW + chartW))
                    property("height", px(HEADER_H + totalH))
                    property("--label-w", px(labelW))
                }
            }) {
                TimelineHeader(zoom, range, ::x, labelW + chartW)
                TimelineGrid(zoom, range, ::x, totalH)
                // Today marker spans the whole chart.
                Div({
                    classes("today-line")
                    attr("aria-hidden", "true")
                    style {
                        property("left", px(x(today) + ppd / 2))
                        property("height", px(HEADER_H + totalH))
                    }
                })
                val window = visibleRows(scrollTop, viewportH, ROW_H, rows.size)
                Div({
                    classes("timeline-rows")
                    attr("role", "list")
                }) {
                    for (i in window) {
                        when (val row = rows[i]) {
                            is TimelineRow.Group ->
                                key("g-" + row.key) {
                                    GroupRow(row, i, labelW + chartW) {
                                        collapsed = if (row.key in collapsed) collapsed - row.key else collapsed + row.key
                                    }
                                }
                            is TimelineRow.Item ->
                                key("t-" + row.bar.task.id) {
                                    val d = drag?.takeIf { it.taskId == row.bar.task.id }
                                    BarRow(row.bar, i, d?.preview ?: row.bar.end, d != null, ::x, ppd, today) { startX ->
                                        drag = EdgeDrag(row.bar.task.id, startX, row.bar.end, row.bar.start, row.bar.end)
                                    }
                                }
                        }
                    }
                }
                DependencyArrows(links, window, ::x, ppd, labelW + chartW, totalH, drag)
            }
        }
    }
    UndatedList(undated)
}

@Composable
private fun TimelineHeader(zoom: Zoom, range: IntRange, x: (Int) -> Double, width: Double) {
    val ticks = remember(zoom, range) { timelineTicks(zoom, range) }
    Div({
        classes("timeline-header")
        style { property("width", px(width)) }
    }) {
        Div({ classes("timeline-corner") }) { Text("Task") }
        ticks.forEach { t ->
            Div({
                classes("tick")
                if (t.major) classes("major")
                style { property("left", px(x(t.day))) }
            }) { Span({ classes("tick-label") }) { Text(t.label) } }
        }
    }
}

/** Vertical grid lines for every tick, below the rows. */
@Composable
private fun TimelineGrid(zoom: Zoom, range: IntRange, x: (Int) -> Double, height: Double) {
    val ticks = remember(zoom, range) { timelineTicks(zoom, range) }
    ticks.forEach { t ->
        Div({
            classes("tl-gridline")
            if (t.major) classes("major")
            attr("aria-hidden", "true")
            style {
                property("left", px(x(t.day)))
                property("top", px(HEADER_H))
                property("height", px(height))
            }
        })
    }
}

@Composable
private fun GroupRow(row: TimelineRow.Group, index: Int, width: Double, onToggle: () -> Unit) {
    Div({
        classes("tl-row", "tl-group")
        attr("role", "listitem")
        attr("data-testid", "timeline-group")
        style {
            property("top", px(HEADER_H + index * ROW_H))
            property("width", px(width))
        }
    }) {
        org.jetbrains.compose.web.dom.Button({
            classes("tl-label", "tl-group-btn")
            attr("type", "button")
            attr("aria-expanded", (!row.collapsed).toString())
            attr("data-testid", "timeline-group-toggle")
            onClick { onToggle() }
        }) {
            Span({ classes("chev") }) { IconView(if (row.collapsed) Icon.ChevronRight else Icon.ChevronDown, 14) }
            Span({
                classes("dot")
                style { property("background", row.color ?: "var(--text-muted)") }
            })
            Span({ classes("tl-group-name") }) { Text(row.name) }
            Span({ classes("col-count") }) { Text(row.count.toString()) }
        }
    }
}

@Composable
private fun BarRow(
    bar: TimelineBar,
    index: Int,
    end: Int,
    dragging: Boolean,
    x: (Int) -> Double,
    ppd: Double,
    today: Int,
    onDragStart: (Double) -> Unit,
) {
    val t = bar.task
    val project = Store.project(t.projectId)
    val color = project?.color ?: "#64748b"
    val left = x(bar.start)
    val width = (end - bar.start + 1) * ppd
    val due = Dates.format(end)
    Div({
        classes("tl-row")
        attr("role", "listitem")
        attr("data-testid", "timeline-row")
        attr("data-task-id", t.id)
        style { property("top", px(HEADER_H + index * ROW_H)) }
    }) {
        Div({ classes("tl-label") }) {
            Link("/tasks/${t.id}", "tl-title") { Text(t.title) }
            Store.member(t.assigneeId)?.let { Avatar(it) }
        }
        Div({
            classes("tl-bar", "prio-edge-${t.priority.key}")
            if (t.status == Status.DONE) classes("done")
            if (t.isOverdue(today)) classes("overdue")
            if (dragging) classes("dragging")
            attr("data-testid", "timeline-bar")
            attr("title", "${t.title}: ${Dates.format(bar.start)} → $due")
            style {
                property("left", px(left))
                property("width", px(width))
                property("--bar-color", color)
            }
        }) {
            if (width > 70) Span({ classes("tl-bar-text") }) { Text(t.title) }
            Div({
                classes("tl-handle")
                attr("role", "slider")
                attr("tabindex", "0")
                attr("aria-label", "Due date of ${t.title}")
                attr("aria-valuetext", Dates.shortLabel(end))
                attr("aria-valuenow", end.toString())
                attr("aria-valuemin", bar.start.toString())
                attr("data-testid", "timeline-bar-handle")
                attr("title", "Drag to change the due date (arrow keys: ±1 day, Shift: ±1 week)")
                onMouseDown { e ->
                    if (e.button.toInt() == 0) {
                        e.preventDefault()
                        e.stopPropagation()
                        onDragStart(e.clientX.toDouble())
                    }
                }
                onTouchStart { e ->
                    val touch = e.nativeEvent.asDynamic().touches[0]
                    if (touch != null) onDragStart((touch.clientX as Number).toDouble())
                }
                onKeyDown { e ->
                    val step = if (e.shiftKey) 7 else 1
                    val delta =
                        when (e.key) {
                            "ArrowRight" -> step
                            "ArrowLeft" -> -step
                            else -> 0
                        }
                    if (delta != 0) {
                        e.preventDefault()
                        val next = maxOf(bar.start, bar.end + delta)
                        if (next != bar.end) {
                            Store.updateTask(t.id) { it.copy(dueDate = Dates.format(next)) }
                            Store.announce("Due date of ${t.title}: ${Dates.shortLabel(next)}")
                        }
                    }
                }
            })
            if (dragging) {
                Span({ classes("tl-drag-tip") }) { Text(Dates.shortLabel(end)) }
            }
        }
        if (width <= 70) {
            Span({
                classes("tl-after")
                style { property("left", px(left + width + 6)) }
            }) { PriorityBadge(t.priority) }
        }
    }
}

@Composable
private fun DependencyArrows(
    links: List<taskpilot.DependencyLink>,
    window: IntRange,
    x: (Int) -> Double,
    ppd: Double,
    width: Double,
    height: Double,
    drag: EdgeDrag?,
) {
    if (links.isEmpty() || window.isEmpty()) return
    val shown = links.filter { minOf(it.fromRow, it.toRow) <= window.last && maxOf(it.fromRow, it.toRow) >= window.first }
    Svg(attrs = {
        classes("tl-arrows")
        attr("aria-hidden", "true")
        attr("width", width.toString())
        attr("height", height.toString())
        style { property("top", px(HEADER_H)) }
    }) {
        Defs {
            Marker({
                id("tl-arrowhead")
                attr("viewBox", "0 0 10 10")
                attr("refX", "9")
                attr("refY", "5")
                attr("markerWidth", "7")
                attr("markerHeight", "7")
                attr("orient", "auto-start-reverse")
            }) { Path("M0,0 L10,5 L0,10 z", { classes("arrow-head") }) }
        }
        shown.forEach { l ->
            val blockerEnd = if (drag?.taskId == l.blocker.task.id) drag.preview else l.blocker.end
            val x1 = x(blockerEnd) + ppd
            val y1 = l.fromRow * ROW_H + ROW_H / 2
            val x2 = x(l.blocked.start)
            val y2 = l.toRow * ROW_H + ROW_H / 2
            val elbow = maxOf(x1 + 10, minOf(x2 - 10, x1 + 10))
            val d =
                if (x2 - 10 >= x1 + 10) {
                    "M$x1,$y1 H${x2 - 10} V$y2 H${x2 - 1}"
                } else {
                    // Blocked task starts before the blocker ends: route around through the row gap.
                    val midY = y2 - ROW_H / 2
                    "M$x1,$y1 H$elbow V$midY H${x2 - 12} V$y2 H${x2 - 1}"
                }
            Path(d, {
                classes("tl-arrow")
                attr("data-testid", "timeline-arrow")
                attr("marker-end", "url(#tl-arrowhead)")
            })
        }
    }
}

@Composable
private fun UndatedList(undated: List<taskpilot.Task>) {
    if (undated.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    Section({
        classes("card", "undated")
        attr("data-testid", "timeline-undated")
    }) {
        Button({
            classes("undated-toggle")
            attr("type", "button")
            attr("aria-expanded", open.toString())
            onClick { open = !open }
        }) {
            IconView(if (open) Icon.ChevronDown else Icon.ChevronRight, 16)
            H2 { Text("No due date") }
            Span({ classes("col-count") }) { Text(undated.size.toString()) }
        }
        if (open) {
            Ul({ classes("undated-list") }) {
                undated.sortedBy { it.title.lowercase() }.forEach { t ->
                    Li {
                        Link("/tasks/${t.id}", "mini-item") {
                            Span({ classes("mini-title") }) { Text(t.title) }
                            PriorityBadge(t.priority)
                        }
                    }
                }
            }
        }
    }
}
