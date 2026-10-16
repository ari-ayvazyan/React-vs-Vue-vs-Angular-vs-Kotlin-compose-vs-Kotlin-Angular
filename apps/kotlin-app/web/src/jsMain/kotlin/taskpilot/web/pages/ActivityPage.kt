package taskpilot.web.pages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import org.jetbrains.compose.web.attributes.forId
import org.jetbrains.compose.web.dom.Button
import org.jetbrains.compose.web.dom.Div
import org.jetbrains.compose.web.dom.H1
import org.jetbrains.compose.web.dom.Label
import org.jetbrains.compose.web.dom.Nav
import org.jetbrains.compose.web.dom.Ol
import org.jetbrains.compose.web.dom.P
import org.jetbrains.compose.web.dom.Span
import org.jetbrains.compose.web.dom.Text
import taskpilot.ActivityQuery
import taskpilot.ActivityType
import taskpilot.UNASSIGNED
import taskpilot.filterActivity
import taskpilot.paginate
import taskpilot.web.Router
import taskpilot.web.Store
import taskpilot.web.ui.EmptyState
import taskpilot.web.ui.Icon
import taskpilot.web.ui.IconView
import taskpilot.web.ui.SelectField

private fun pushActivity(q: ActivityQuery) = Router.navigate(Router.buildUrl("/activity", q.toParams()))

/** `/activity`: every logged change, newest first, filterable by member and type, 50 per page. */
@Composable
fun ActivityPage() {
    val query = ActivityQuery.fromParams(Router.params())
    val log = Store.activity
    val filtered = remember(log, query.memberId, query.type) { filterActivity(log, query) }
    val page = paginate(filtered, query.page, ActivityQuery.PAGE_SIZE)

    Div({ classes("page-header") }) {
        Div {
            H1 { Text("Activity") }
            P({ classes("subtitle") }) {
                Text(if (filtered.size == log.size) "${log.size} recorded changes" else "${filtered.size} of ${log.size} changes match")
            }
        }
        Div({ classes("filter-selects") }) {
            Div({ classes("lsel") }) {
                Label(forId = "activity-member") { Text("Member") }
                SelectField(
                    query.memberId ?: "",
                    listOf("" to "All members") + Store.members.map { it.id to it.name } + (UNASSIGNED to "No user"),
                    { v -> pushActivity(query.copy(memberId = v.ifEmpty { null }, page = 1)) },
                ) {
                    id("activity-member")
                    attr("data-testid", "activity-member-filter")
                }
            }
            Div({ classes("lsel") }) {
                Label(forId = "activity-type") { Text("Type") }
                SelectField(
                    query.type?.key ?: "",
                    listOf("" to "All types") + ActivityType.entries.map { it.key to it.label },
                    { v -> pushActivity(query.copy(type = ActivityType.fromKey(v), page = 1)) },
                ) {
                    id("activity-type")
                    attr("data-testid", "activity-type-filter")
                }
            }
        }
    }
    if (page.items.isEmpty()) {
        EmptyState(
            if (log.isEmpty()) "No activity yet" else "No matching activity",
            if (log.isEmpty()) "Changes to tasks (edits, status changes, comments, …) will be listed here." else "Try other filters.",
        )
        return
    }
    Div({ classes("card") }) {
        Ol({
            classes("timeline")
            attr("data-testid", "activity-list")
        }) {
            val names = remember(log, Store.tasks) { activityNames(log) }
            page.items.forEach { ActivityItem(it, showTask = true, names) }
        }
    }
    Nav({
        classes("pagination")
        attr("aria-label", "Activity pagination")
    }) {
        Button({
            classes("btn", "btn-ghost")
            attr("type", "button")
            attr("data-testid", "activity-prev")
            if (page.page <= 1) attr("disabled", "")
            onClick { pushActivity(query.copy(page = page.page - 1)) }
        }) {
            IconView(Icon.ChevronLeft, 16)
            Text("Newer")
        }
        Span({ classes("page-info") }) {
            val from = (page.page - 1) * ActivityQuery.PAGE_SIZE + 1
            Text("Page ${page.page} of ${page.pageCount} · $from–${from + page.items.size - 1} of ${page.total}")
        }
        Button({
            classes("btn", "btn-ghost")
            attr("type", "button")
            attr("data-testid", "activity-next")
            if (page.page >= page.pageCount) attr("disabled", "")
            onClick { pushActivity(query.copy(page = page.page + 1)) }
        }) {
            Text("Older")
            IconView(Icon.ChevronRight, 16)
        }
    }
}
