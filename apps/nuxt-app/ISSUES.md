# ISSUES – maintenance log

## Request 1: team members, assignees, recurring tasks

START: 2026-10-16T09:10:56Z
END: 2026-10-16T09:24:07Z

### What changed (short)
- Model: `Member { id, name, color }`, `Task.assigneeId`, `Task.recurrence`, `AppState.members`.
- `app/lib/members.ts` (initials, WCAG-based avatar text colour, name validation, unassign),
  `app/lib/recurrence.ts` (`advanceDate`, `nextOccurrence`, `spawnRecurrences`), `addMonthsISO` in `dates.ts`
  (clamps month ends: Jan 31 + 1 month = Feb 28/29).
- Store: members are part of the undo snapshot. Every task mutation that can complete a task (toggle, bulk done,
  status edit, drag & drop, Shift+arrow) goes through `commitTasks()`, which appends the next occurrence in the
  *same* commit, so one undo reverts both. A toast ("Next … scheduled for …", with Undo) announces it.
- UI: `MemberAvatar`, `RecurrenceIcon`, `TeamSettings` (Settings → Team members, `#team`), assignee + repeat in
  the task form, avatar column / icons on list rows, board cards, detail page, calendar day agenda. Assignee filter
  on list (`?assignee=`), board (`?assignee=`, kept together with `?project=`) and calendar (kept across month
  navigation). Dashboard "Open tasks per assignee" bar chart (`data-testid="chart-assignees"`), reusing the
  hand-written SVG `BarChart` (extended with optional `valueText` / `ariaText`).
- Import/persistence: `members`, `assigneeId`, `recurrence` are optional on input and default to `[]` / `null` /
  `'none'`; invalid member objects, dangling `assigneeId` and unknown `recurrence` values are rejected with clear
  errors.
- Demo data: the seed-42 loop is untouched; a separate `mulberry32(7)` pass sets assignee then recurrence.
  A unit test pins a SHA-256 fingerprint of all pre-existing fields of `generateDemoData(1000)` taken *before*
  the change, so the "output must stay exactly the same" requirement is enforced, not just claimed.

### Decisions / deviations
- Completing a recurring task that was **created** already done does not spawn a copy (there is no "before"
  state; "marked as done" was read as a transition). Copies also keep assignee, project, tags, priority,
  estimate and recurrence; subtasks get new ids (done = false).
- If a completed recurring task is reopened and completed again, another copy is created (no hidden
  bookkeeping field was added). Undo is the intended way to revert an accidental completion.
- Member names must be unique (case-insensitive) so the assignee dropdowns are unambiguous; max 60 chars.
- The dashboard chart also shows an "Unassigned" bar (only when there are unassigned open tasks); bar length is
  relative to the busiest row, the label shows the count and share of all open tasks. Rows link to the filtered
  task list.
- The dashboard grid now has 7 cards, so the "Overdue" card spans the full width (list in columns) to avoid an
  empty grid hole at 3 and 2 columns.

### Problems / friction
- Tests are not covered by `nuxt typecheck` (the generated tsconfig only includes `tests/nuxt/**`). I type-checked
  `tests/*.ts` with an ad-hoc tsconfig in the scratchpad that extends `.nuxt/tsconfig.app.json` (verified it
  really reports errors by adding a deliberately wrong file, then removing it). Not changed in the repo.
- The generator works in local time, so the "unchanged output" fingerprint depends on the time zone; the test
  file pins `process.env.TZ = 'UTC'`.
- `/opt/pw-browsers/chromium` is a symlink to the chrome binary itself, not a directory.

### Mistakes
1. **Member changes were not persisted.** The client plugin's save watcher listed `tasks`, `projects` and
   `settings` explicitly; I added `members` to the store but not to that list, so adding/renaming/recolouring a
   member only reached localStorage when something else changed. Found by the Playwright run ("recolored member"
   failed: the store had the new colour, localStorage did not). Fixed by watching `store.serialize()` – exactly
   what is persisted – so future top-level state cannot be forgotten the same way.
2. **Wrong expectation in a unit test.** I assumed white text is more readable on `#a855f7`; the WCAG contrast
   maths (which the function implements) says near-black wins. The test failed; I checked the numbers and
   replaced the sample with `#6366f1`, which is a real white-text case.
3. **Broken markup from a scripted re-indent.** A Python slice re-indenting the calendar header produced
   `</div      </div>`. Caught by reading the result right after the edit; fixed by hand before building.
4. **Lint error**: used `delete query[k]` with a computed key in the board filter (`no-dynamic-delete`). Rewrote
   with `Object.fromEntries(... .filter(...))`.
5. **E2E script bug**: searching for a task by its full title matched 3 rows because "#1" is a substring of
   "#10…#199". Fixed the script to pick a task with a 3-digit number.

## Request 2: dependencies, comments, activity log

START: 2026-10-16T09:31:08Z
END: 2026-10-16T09:45:42Z

### What changed (short)
- Model: `Task.blockedBy: string[]`, `Task.comments: TaskComment[]` (`{ id, authorId, body, createdAt }`),
  `AppState.activity: ActivityEntry[]` (`{ id, taskId, actorId, type, field?, from?, to?, at }`),
  `settings.currentUserId` (default `'m1'`). All optional on import/load, so older data still loads.
- `lib/dependencies.ts`: open blockers, blocked ids, cycle-safe `validateDependency`, `partitionCompletable`
  (tasks completed together may unblock each other), cleanup of references to deleted tasks, error message text.
- `lib/mentions.ts`: `@Full Name` is typed, stored as `@[memberId]` (renames show up in old comments), parsed back
  into highlighted segments; caret-aware mention detection, matching and insertion.
- `lib/activity.ts`: `diffTasks(prev, next)` turns any task-list change into entries (created / deleted / one per
  changed field; comments one per added/removed comment), formatting and filtering helpers.
- Store: `commit()` diffs the task list on every recorded change and appends the entries; `activity` is part of the
  undo snapshot, so undo removes exactly the entries of the change it reverts and redo restores them. Every path to
  "done" (`setStatus` → list toggle/bulk, `updateTask` → modal/detail form/detail status select, `moveTask` → drag,
  `moveTaskByKey` → Shift+arrows) goes through one guard that refuses blocked completions and shows an error toast
  naming the blockers.
- UI: Dependencies card (searchable ARIA combobox picker, "would create a cycle" hint, clear error on selection,
  "Blocking" list), Comments card (author = current user, `@` autocomplete with keyboard support, highlighted
  mentions, delete with undo), Activity timeline on the detail page, `/activity` page (filters member/type in the URL,
  pages of 50, grouped by day), sidebar entry `nav-activity`, `g a` shortcut, "Current user" select in Settings →
  Team members, "Blocked" badge on list rows, board cards and the detail header.

### Decisions / deviations
- Logged fields: title, description, status, priority, project, tags, due date, estimate, assignee, repeat,
  dependencies, subtasks, comments, plus create/delete. **Not logged:** `order` (pure reordering), `completedAt`
  (follows status) and `timeSpentMinutes` – Pomodoro tracking is deliberately outside undo history, and logging it
  would make the log disagree with undo (an undo would drop a tracking entry that is not being undone).
- Activity types for the filter: created, deleted, status, assignee, dependencies, comment, updated (= any other
  field; `field` says which).
- Import and "Reset demo data" replace the whole log (with the imported one / an empty one) instead of logging
  hundreds of create/delete entries. The log keeps the newest 5000 entries, and long text values (descriptions,
  comment bodies) are clipped to 500 characters in the log, so localStorage cannot fill up.
- Bulk "Mark done" completes the unblocked tasks and reports the blocked ones (one toast). Single-task paths
  refuse the whole change; in the edit modal the form stays open so the status can be fixed.
- Recurring copies keep `blockedBy` (all blockers are done at that point) but start with no comments.
- Comments are added and deleted, not edited. Without a current user (or if that member was deleted) commenting
  is disabled with a link to Settings; entries record `actorId: null` and show as "Someone".
- Identical error toasts replace each other instead of stacking (seen when retrying a blocked drag).
- The demo-data fingerprint test from request 1 now strips the new empty fields and `settings.currentUserId`;
  every pre-existing value is still byte-identical.

### Problems / friction
- Playwright vs. Vue router timing: the URL changes before the re-render, so reading a select/list right after
  `waitForURL` was flaky. Switched those assertions to polling (`waitForFunction`).

### Mistakes
1. **Forgot the new fields in existing test fixtures.** After adding `blockedBy`/`comments` the store test from
   request 1 crashed in `diffTasks` (`t.blockedBy is not iterable`) because its hand-built tasks lacked them. Found by
   `bun run test`; fixed the fixtures (production data always goes through `validateImport`, which adds defaults).
2. **Duplicate type import** in `lib/activity.ts` (`import/no-duplicates`), caught by lint, merged.
3. **Awkward activity sentences** ("Sam created the task on Fix …"). Seen in the `/activity` screenshot; the description
   now has a separate phrasing for when the task title follows ("created …", "changed the status of …",
   "added blocker “A” to …").
4. **E2E script: drag target off-screen.** `dragTo(done column header)` silently did nothing because the header was
   thousands of pixels above a card deep in the todo column. Dropped into the done column at the card's height
   with explicit mouse moves instead.
5. **E2E script: racing two filter changes.** I changed the type filter and then the member filter without waiting
   for the first navigation, so the second `push` still carried `type=comment` and the list was legitimately empty.
   Waited for the first URL change. (Not an app bug: a person can't change two selects within milliseconds.)
6. **Request-1 E2E broke on a new duplicate text**: the new "Current user" select contains every member name, so
   `getByText('Riley Chan')` matched two elements. Scoped the locator to `member-row`.

## Request 3: saved views, timeline

START: 2026-10-16T09:51:51Z
END: 2026-10-16T10:03:56Z

### What changed (short)
- Model: `SavedView { id, name, query, createdAt }` in `AppState.views` (optional on import, part of undo
  history; views are not task changes, so they are not in the activity log). `query` is the serialized task-list
  query without the page, re-validated on import so unknown values are dropped.
- `lib/views.ts`: query of a view, matching the current query (order-insensitive), board mapping, summary text,
  suggested name, name validation. `lib/timeline.ts`: grouping/layout, date range, bar geometry, drag → date,
  axis ticks per zoom, dependency links and elbow paths. `daysBetween` in `dates.ts` (UTC-based, DST-safe).
- Task list: a view bar on top of the toolbar. With no matching view it shows a summary and "Save view" (name
  dialog with a suggested name). When the current query matches a view it shows the view's name with "Open on
  board", "Rename" and "Delete" (undo toast). Sidebar: "Views" section (active view highlighted, a board icon per
  view on hover/focus), and Views + Projects now share one scrollable area so a long list can't push the footer away.
- Board: reads the same query parameters as the list (search, priority, project, assignee, tag, due) and ignores
  status, sort and page. Project/assignee selects keep any view filters, and a bar names the active view, lists the
  extra filters and offers "Clear view filters".
- `/timeline` (`nav-timeline`, shortcut `g l`): sticky task-name column and date header, project groups that
  collapse (plus Collapse/Expand all), Week/Month/Quarter zoom (`?zoom=`), "Hide done" (`?open=1`), today
  line, weekend shading in week zoom, the current month stays labelled while scrolling, hatched bars for tasks
  whose due date is before their creation date, overdue outline, arrows from blocker to blocked task (dashed once
  the blocker is done), separate "Without due date" list. The due handle can be dragged (pointer capture, Esc
  cancels) or used as a slider with ArrowLeft/Right (±1 day) and PageUp/Down (±7). Each change is one undoable,
  logged `updateTask` with an Undo toast.

### Decisions / deviations
- Saved views store filters, search and sort (not the page). Opening a view on the board drops status and sort,
  since the board has status columns and manual order. The "Open on board" link has a tooltip saying what is
  ignored.
- Renaming/deleting is done from the task list while the view is active (and from the toast's Undo). The sidebar
  stays a plain navigation list.
- View names are unique (case-insensitive) and at most 60 characters.
- Timeline bars are drawn from the creation day to the due day (both inclusive). Demo data contains tasks due
  *before* they were created. These are drawn hatched, from due to created, and their handle sits on the due
  (left) side.
- Arrows are drawn only when both tasks are visible (dated, not hidden, group expanded). An arrow whose target
  starts left of the source takes a detour between the rows.
- Performance with `?seed=1000` (847 bars): about 0.9 s to load the route including generating the data, about
  0.35 s to switch zoom, and about 18 ms per pointer move while dragging (Playwright timings, including its
  overhead). No row virtualization was needed at this size.

### Problems / friction
- Recording the drag timing showed the first implementation was too slow (see mistake 1). Measuring it in the
  E2E script is what made that visible. A screenshot would not have shown it.
- In week zoom the month label disappears once you scroll past the 1st. Spotted in the mobile screenshot and fixed
  with a sticky month label driven by `scrollLeft` (rAF-throttled).

### Mistakes
1. **Dragging re-rendered the whole chart.** The drag preview lived in the page component, so each pointer move
   re-rendered all ~850 rows: 6 moves took 781 ms (~130 ms per frame). Found by timing the drag in the E2E run.
   Moved each bar plus its drag state into a `TimelineBar` child component that emits only the final date. Now
   6 moves take ~106 ms.
2. **Registered `onBeforeUnmount` inside `onMounted`** (for the media-query listener), which Vue rejects because
   there's no active instance then. Lint and type check passed with it. I caught it while re-reading the code before
   the first build, and moved the hook registration to setup level.
3. **Lost the hatch-pattern styles while moving bar styles into the new component.** My cut ran from `.bar` to
   `.link` and also took `.hatch-bg`/`.hatch-line`, which belong to the page (the pattern lives in the page's
   `<defs>`). Noticed when reviewing the diff, and restored them.
4. **Old test fixtures missing `views`.** The two earlier store tests call `replaceAll` with a hand-written
   `AppState`. Vitest passed (no type checking), but the ad-hoc `tsc` run over `tests/` flagged it. Added
   `views: []`.
5. **E2E script: `getBBox()` results don't serialize** through `page.evaluate` (came back as `{}`), so the arrow
   geometry check failed. I copied the fields into a plain object.

## Request 4: notifications, reports

START: 2026-10-16T10:10:25Z
END: 2026-10-16T10:19:53Z

### What changed (short)
- Model: `AppNotification { id, recipientId, type: assigned | mentioned | due | unblocked, taskId, actorId,
  activityId?, day?, dueDate?, blockerId?, remaining?, at, read }` in `AppState.notifications` (optional on
  import, persisted, capped at 500).
- `lib/notifications.ts`:
  - `notificationsForChange` derives event notifications from the activity entries of each commit:
    - assignment, including creating a task with an assignee;
    - @mention in a new comment, using the full comment body rather than the clipped log text;
    - completion of a blocker, notifying the assignee of the blocked open task with the number of blockers still
      open.
  - Nobody is notified about their own actions.
  - `dueReminders`: open tasks of the current user due today/tomorrow or overdue, once per task per day.
  - Visibility, pruning and text.
- Store: notifications are **not** in the undo snapshot. Event notifications reference their activity entry and
  are hidden while that entry is undone (shown again on redo). Read state survives undo/redo. Reminders are
  checked by the client plugin whenever tasks, the current user or the day change. `markNotificationRead`,
  `markAllNotificationsRead`, `myNotifications` and `unreadCount` back the UI.
- Top bar: `NotificationBell` (`notifications-bell`) with an unread badge. The panel is a non-modal dialog:
  - focus moves to the first notification; ↑/↓ move between notifications;
  - Esc closes and returns focus to the bell; clicking outside or navigating also closes it;
  - each notification has its own "mark as read" control, and there is a "Mark all as read" button;
  - clicking a notification opens the task (or says it was deleted);
  - on phones the panel is full width.
- `/reports` (`nav-reports`):
  - burndown (open tasks at the end of each day, last 30 days; project select in `?project=`), reusing the
    hand-written line chart, which now takes a value label and summary text;
  - workload per assignee (estimated hours of open tasks, plus how many open tasks have no estimate), using the
    bar chart;
  - average cycle time by priority, in a new hand-written `ColumnChart` SVG with axis, value labels and tooltips.
  - Stats in `lib/stats.ts`: `burndown` (difference-array over the window), `workloadByAssignee`,
    `cycleTimeByPriority`.
- Task list: "Export CSV" (`export-csv`) exports exactly the filtered and sorted list (all pages, not just the
  current one). It's RFC 4180 with a UTF-8 BOM, readable values (names and labels instead of ids), and protection
  against spreadsheet formulas in text fields.

### Decisions / deviations
- Notifications are per member (recipient). The bell shows the current user's. Switching the current user in
  Settings shows that member's notifications. Notifications about your own actions are not created, so
  assigning a task to yourself does not notify you.
- "Due within 24 hours" is implemented on calendar days: due **today or tomorrow** (due dates have no time), or
  overdue. One reminder per task per day. Reminders are only generated for the current user while the app is open
  as them.
- Undo hides the notification created by the undone change instead of deleting it, so redo brings it back with
  its read state.
- Import keeps the existing notifications next to the imported ones (undoing the import needs them). Load and
  "Reset demo data" replace them, dropping notifications whose activity entry no longer exists.
- Burndown counts a task as open at the end of day *d* when it was created on or before *d* and not completed by
  *d*. Tasks that were reopened can't be reconstructed (there's no status history before the activity log), so
  the curve uses `createdAt`/`completedAt` only.
- CSV columns: ID, Title, Status, Priority, Project, Assignee, Tags, Due date, Estimate, Time spent, Subtasks
  done/total, Blocked by (titles), Repeat, Created, Completed, Description.

### Problems / friction
- None with tooling this time. The main design question was how to keep notifications consistent with
  undo/redo without putting read state into history. Linking event notifications to activity entries solved it
  without new bookkeeping.

### Mistakes
1. **Same fixture mistake as in request 3, again.** The two older store tests build `AppState` by hand and lacked
   the new `notifications` field, so 8 tests crashed (`Cannot read properties of undefined (reading 'filter')`).
   Found by `bun run test`; added `notifications: []`. I should have grepped for `replaceAll({` in `tests/` when
   adding the field. Next time I'll do that whenever `AppState` grows.
2. **Wrong expectation in a new unit test**: I forgot that on the 16th "tomorrow" is the 17th, so the "later" task
   also gets a reminder that day. The function was right; fixed the test.
3. **Panel focused the wrong element.** `querySelector('.item, .mark-all, h2')` returns the first match in *document*
   order, which is the "Mark all as read" button in the header, not the first notification. Seen in the panel
   screenshot (focus ring on the header button). The code now looks for `.item` first and falls back to the heading.
4. **Workload values wrapped** ("50.5" / "h" on two lines) because the bar chart's value column was a fixed 40px,
   made for "57%". Seen in the reports screenshot; now `min-width` + `nowrap`.

## Request 5: sub-projects and custom workflows (change request)

START: 2026-10-16T10:30:05Z
END: 2026-10-16T10:50:03Z

### What changed (short)
- **Model (schema v2).**
  - `Project.parentId` (any depth, no cycles).
  - `Project.workflow: WorkflowStatus[] | null`, where `WorkflowStatus { id, name, color, category }` and null
    means "inherit".
  - `Task.statusId` (workflow status). `Task.status` is now the status's **category**. It's kept as a field (a
    cache) so everything that depended on status keeps working unchanged: filters, KPIs, completion, completedAt,
    recurrence, dependencies, notifications, reports, calendar.
- **Single invariant point.** `normalizeTasks` (lib/workflows) runs inside every store commit. It ensures that
  `statusId` exists in the task's effective workflow (otherwise it maps to the first status of the same category),
  that `status` equals that status's category, and that `completedAt` is set exactly for done tasks.
  - Moving a task to another project, re-parenting a project, editing a workflow or deleting a status therefore
    re-maps tasks in the **same** undoable commit, and the activity log records the status changes.
- **`lib/workflows.ts`.** Default workflow (ids `todo`/`in_progress`/`done`); resolver for effective workflows
  (own → nearest ancestor → default, memoised); validation (1–12 statuses, unique names/ids, hex colours, at least
  one To do and one Done); `withWorkflowStatus`.
- **`lib/projects.ts`.** Tree order with paths, indented select options, descendants, parent validation, cycle
  check, project filter scope, and a delete plan:
  - sub-projects either move up one level or are deleted with the project;
  - tasks are unassigned or deleted;
  - a lifted sub-project that inherited the deleted project's own workflow gets a copy, so its tasks keep their
    statuses.
- **`lib/board.ts`.** Board columns:
  - the selected project's workflow, or the three categories for All projects / No project;
  - tasks from a sub-project with another workflow sit in the column of their category;
  - a dropped task gets the column's status if its own workflow has it, otherwise the first status of that category.
  - `taskOps` now only holds `placeInColumn`, `sortByOrder`, `nextOrder` and `uid`.
- **Store.**
  - `setStatus(ids, category)` uses each task's workflow.
  - `updateTask` accepts `statusId` (or a category).
  - `moveTask(id, statusId, destIds, index)` replaces both board operations.
  - `setWorkflow(projectId, workflow|null, remap)` covers customise/reset/add/rename/recolour/recategorise/reorder/
    delete with task remapping and the blocker rule. If a change would complete blocked tasks it is refused with the
    blocker message.
  - `updateProject` validates parents; `deleteProject(id, taskMode, subprojectMode)`.
- **UI.**
  - Projects page as an indented tree with connectors and rolled-up counts/progress, a parent select when creating,
    a "Move" dialog (own sub-projects excluded) and a Workflow editor modal.
  - The delete dialog asks about sub-projects and tasks.
  - Project selects everywhere are tree-ordered and indented. The sidebar shows the tree. Timeline groups use paths.
  - The task form and detail page offer the project's statuses (switching project maps the status). List rows show
    custom statuses.
  - Board columns follow the selected project's workflow (scrolls horizontally if there are many). The All-projects
    board shows a task's custom status on its card.
  - Activity entries name workflow statuses. The CSV export has Status (name) and Category.
- **Migration.**
  - `STORAGE_KEY = 'taskpilot:v2'`. `load()` reads v2, else `taskpilot:v1`; v1 data goes through `validateImport`
    (which upgrades the shape), is written as v2, and the v1 key is removed.
  - Import accepts v1 and v2 files and rejects newer schemas.
  - Export writes `schemaVersion: 2`.
  - The theme boot script reads v2, falling back to v1.
  - `?seed=N` and every existing `data-testid` keep working. The default workflow's ids equal the category names,
    so `board-column-todo/in_progress/done` are unchanged.

### Decisions / deviations
- Kept `Task.status` as the cached category next to the new `statusId` rather than making callers look up the
  category every time. This avoided threading projects/workflows through ~15 pure functions and every component.
  The cost is a denormalised field; the risk is contained by `normalizeTasks` running in every commit, on load and
  on import.
- The status filter on the task list (and in saved views) stays category-based (To do / In progress / Done), as
  the request says. A view therefore works across projects with different workflows.
- Notifications "blocker completed" fire when a task's **category** becomes done. A status edit that recategorises
  a status to "Done" completes its tasks (completedAt set, recurring copies spawned), but tasks whose status *id* did
  not change are not logged as status changes and do not trigger that notification.
- Recurring copies start in the first "To do" status of their own workflow. Blockers apply to every way of reaching
  "Done", including deleting/recategorising a status.
- The order of cards is a sort key per column. Appends use the global max + 1, so columns stay stable in both board
  modes.
- Performance with `?seed=5000`: the first status toggle after load takes ~0.5 s (first normalisation pass and
  resolver warm-up); later toggles take ~0.15 s, as before.

### Problems / friction
- This change touched the type of the most-used field, so the type checker was the main tool. I removed the old
  board helpers (`moveTask`/`keyboardMove`/`columnTasks`/`withStatus`) instead of keeping them around, and the
  compiler listed every place to update.
- The browser tests from requests 1–4 read `localStorage['taskpilot:v1']`. After the key change I pointed them at
  v2. Their "legacy data" steps still check that missing fields get defaults, and the new E2E covers the real v1 → v2
  migration.

### Mistakes
1. **First `setWorkflow` draft committed the task change and then mutated `projects` outside the commit.** Undo
   would have worked, but status remaps caused by the project change would not have been logged or guarded. I
   caught it re-reading the code right after writing it, before any test, and rewrote it as one
   `commitTasks(normalized, nextProjects)` call.
2. **Left two unused imports** (`copyWorkflow`, `moveStatus`) in the store after that rewrite. Caught by lint.
3. **Test fixtures again.**
   - Several older tests built tasks with `status: 'done'` only. With `statusId` as the source of truth those
     no longer describe a status change, so the activity/notification tests failed. I made the shared `task()`
     helpers derive `statusId` from `status` and set both in the tests that change status.
   - My new v1-migration tests also first used a "v1" fixture that still contained `assigneeId` (which v1 never
     had), so import failed on the unknown members. Fixed the fixtures to be genuine v1 shapes.
4. **E2E search too broad.** "docs landing" matched demo tasks tagged `docs` with "landing page" titles. I switched
   to a unique phrase.
5. **Board with four statuses overflowed at 1360 px** (the last column was cut off). Seen in the screenshot;
   column min width is now 230 px (the board still scrolls horizontally when there are more columns).
6. **Workflow editor on phones** put the task count and actions on stray rows. Seen in the mobile screenshot;
   it's now a two-row grid per status.
