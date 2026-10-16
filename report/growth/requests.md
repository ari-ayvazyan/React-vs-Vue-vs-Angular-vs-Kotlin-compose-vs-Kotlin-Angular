# Feature requests sent to the three maintainers (identical text for all three)

## Request 1: team members, assignees, recurring tasks

1. **Team members.** New entity `Member { id, name, color }` (initials derived from the name). Manage members in Settings (add, rename, recolor, delete; deleting unassigns their tasks).
2. **Assignees.** `Task.assigneeId: string | null`. Show an avatar (initials on the member color) on list rows, board cards and the task detail; assignee selectable in the task form. Add an "Assignee" filter to the task list (synced to the URL like the other filters), the board and the calendar. Add a "Open tasks per assignee" horizontal bar chart to the dashboard (hand-written SVG like the others, with `data-testid="chart-assignees"`).
3. **Recurring tasks.** `Task.recurrence: 'none' | 'daily' | 'weekly' | 'monthly'` (default 'none'), selectable in the task form, shown as an icon on rows/cards. When a recurring task is marked done, a new copy is created with status `todo`, the due date advanced by the interval (from the old due date, or today if none), subtasks reset to not done, and timeSpentMinutes 0. One undo must revert both the completion and the created copy.
4. **Demo data.** The existing generator output must stay exactly the same. Add members `Alex Kim #0ea5e9, Sam Rivera #f97316, Jordan Lee #22c55e, Taylor Brooks #a855f7, Morgan Patel #ef4444` (ids `m1`..`m5`). Assign them with a second PRNG `mulberry32(7)`, iterating tasks in order: `k = floor(r()*6)`, `k === 5` means unassigned, otherwise member `k`. Recurrence for demo tasks: with the same second PRNG, right after the assignee draw, `r() < 0.1` means 'weekly', otherwise 'none'.
5. Persisted data from before this change must still load (missing fields get defaults).

## Request 2: dependencies, comments, activity log

1. **Dependencies.** `Task.blockedBy: string[]` (task ids). Manage them on the task detail page with a searchable picker. Reject cycles with a clear message. A task with open blockers cannot be moved to done (from any place: list toggle, bulk action, board drag, keyboard move, detail page); show an error toast naming the blockers. Blocked tasks show a "blocked" indicator on rows and cards.
2. **Comments.** Tasks get comments `{ id, authorId (member), body, createdAt }`, shown on the detail page, newest last. The author is chosen from a "Current user" setting (Settings, defaults to `m1`). Typing `@` in a comment opens an autocomplete of members; mentions render highlighted.
3. **Activity log.** Every change to a task (create, delete, each field change including status, assignee, dependencies, comments) is recorded as `{ id, taskId, actorId, type, field?, from?, to?, at }`. Show it as a timeline on the task detail page. Add a new route `/activity` (sidebar entry, `data-testid="nav-activity"`) listing all entries newest first, filterable by member and by type, paginated by 50. Undo/redo must keep the log consistent (undoing a change removes its entry).

## Request 3: saved views, timeline

1. **Saved views.** From the task list, "Save view" stores the current filters, search and sort under a name. Saved views appear in the sidebar under "Views"; clicking one opens the list with those settings. Views can be renamed and deleted. A view can also be opened on the board (applying the filters that make sense there).
2. **Timeline.** New route `/timeline` (sidebar entry, `data-testid="nav-timeline"`): a Gantt-style chart, one row per task, bar from `createdAt` to `dueDate` (tasks without a due date are listed separately), grouped by project with collapsible groups. Zoom levels week / month / quarter. Draw dependency arrows from blocker to blocked task. Dragging the right end of a bar changes the due date (undoable). Must stay usable with `?seed=1000`.

## Request 4: notifications, reports

1. **Notifications.** A bell in the top bar with an unread count (`data-testid="notifications-bell"`) opening a panel. Notify on: a task assigned to the current user, the current user mentioned in a comment, a task of the current user due within 24 hours or overdue (once per task per day), a blocker of one of the current user's tasks being completed. Mark one / all as read. Persist notifications. Clicking a notification opens the task.
2. **Reports.** New route `/reports` (sidebar entry, `data-testid="nav-reports"`): a burndown chart per project for the last 30 days (open tasks per day, project selectable), workload per assignee (sum of estimates of open tasks, in hours), average cycle time (created to completed) by priority, all hand-written SVG. "Export CSV" on the task list exports exactly the currently filtered and sorted tasks.

## Request 5: sub-projects and custom workflows (change request)

1. **Sub-projects.** A project can have a parent project (any depth, no cycles). The projects page shows a tree; progress and counts include descendants. Filtering by a project anywhere includes its descendants. Deleting a project asks what to do with its sub-projects (move up one level or delete them too).
2. **Custom workflows.** Each project has an ordered list of statuses, each with a name, a color and a category (`todo`, `in_progress` or `done`). Default workflow for every project: To do / In progress / Done (ids `todo`, `in_progress`, `done`). Projects page: add, rename, recolor, reorder and delete statuses (deleting asks which status to move tasks to). Sub-projects inherit their parent's workflow unless customized. The board shows the selected project's statuses as columns; with "All projects" it shows the three categories as today. Everything that depended on status (filters, KPIs, completion, completedAt, recurrence, dependencies, notifications, reports, calendar, undo) uses the status's category from now on.
3. **Migration.** Bump the storage schema to `taskpilot:v2` and migrate existing `taskpilot:v1` data on load. Export/import uses the new schema and still accepts old exports. `?seed=N` keeps working and the existing `data-testid`s keep working for the default workflow.
