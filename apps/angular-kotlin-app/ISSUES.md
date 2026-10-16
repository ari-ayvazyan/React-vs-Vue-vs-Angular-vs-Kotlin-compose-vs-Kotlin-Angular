# ISSUES – change log per feature request

## Request 1: team members, assignees, recurring tasks

START: 2026-10-16T11:04:21Z

### What was built
- Kotlin: `Member` (initials + contrast text colour computed in Kotlin), `Task.assigneeId` / `Task.recurrence`,
  `AppState.members`; member CRUD in the store (undoable, delete unassigns tasks), bulk `assignTasks`;
  `Recurrence` rules (daily/weekly/monthly with month-end clamping); assignee filter in `TaskQuery`
  (URL param `assignee`, `none` = unassigned), `boardColumn` and `buildMonthGrid`; `openByAssignee` stats and
  `buildAssigneeBars` SVG geometry; second-pass demo assignment with `mulberry32(7)`; import/export of the new
  fields with defaults for older data (`members` → `[]`, `assigneeId` → null, `recurrence` → `none`).
- Recurrence is handled centrally in the store's `mutate`: any mutation in which a recurring task goes from
  not-done to done (row toggle, bulk "mark done", board drop, keyboard move, edit form status) appends the next
  occurrence in the same history entry, so one undo reverts both. Import is excluded.
- UI: avatar component, assignee + "Repeats" fields in the task form (with a "next one is due …" hint),
  assignee filter on list (URL-synced), board and calendar, avatars + repeat icon on rows/cards/detail,
  bulk "Assign to…", Settings → Team members (add/rename/recolor/delete with confirm dialog + undo toast),
  dashboard "Open tasks per assignee" SVG chart (`data-testid="chart-assignees"`), toast announcing the next
  occurrence.
- Tests: 51 Kotlin tests (11 new), incl. an FNV hash of the original seed-42 generator stream checked against
  a JS reference implementation of the spec, to prove the existing demo output did not change.

### Problems / friction
- Kotlin/JS: an `internal object Math` helper in my own code shadowed the name `kotlin.js.Math` conceptually;
  renamed to `IntMath` before it caused trouble when reusing it from a second file.
- Playwright's `innerText` is empty for SVG `<text>`; needed `textContent` in the browser check.
- Recurrence changes the meaning of an existing browser check: dragging the first To-do card (demo task #1,
  which is now weekly) to Done spawns a new To-do copy, so the "To-do count decreased" assertion failed.
  The app was right; the check now drags a non-recurring card.

### Mistakes I made
1. First version of the store set `lastSpawned` only inside `mutate`, so a later settings change (which also
   calls `commit`) would have re-announced the same spawned task through the Angular toast. Noticed while
   wiring the toast into `StoreService.sync`; fixed by passing `spawned` into `commit`, which resets it on
   every commit.
2. Used `kotlin.math.pow(a, b)` (doesn't exist; it is the extension `a.pow(b)`); fixed before compiling.
3. Adding the repeat badge (with an `.sr-only` label) to board cards made the 375 px page 393 px wider:
   `.sr-only` is `position:absolute` and the cards had no positioned ancestor, so the hidden spans escaped
   the horizontally scrolling board. Found by the overflow assertion in the mobile Playwright pass, located by
   measuring `scrollWidth` of each container; fixed with `position: relative` on `.board-card`.
4. The new assignee chart rendered with tiny text in a 1-column card and left the dashboard's last row half
   empty; seen in the screenshot. Fixed by widening the viewBox, enlarging the fonts and making the chart and
   the Overdue card span two columns (Overdue only in the 3-column layout).
5. My browser-check assertion for the chart labels used `allInnerTexts()` on SVG and failed spuriously;
   switched to `allTextContents()`.

END: 2026-10-16T11:15:58Z

## Request 2: dependencies, comments, activity log

START: 2026-10-16T11:22:37Z

### What was built
- Kotlin model: `Task.blockedBy`, `Task.comments` (`Comment { id, authorId, body, createdAt }`),
  `Settings.currentUserId` (default `m1`), `AppState.activity` (`ActivityEntry { id, taskId, actorId, type, field?,
  from?, to?, at, taskTitle }`). All new fields are optional on import, so request-1 data keeps loading.
- Dependencies (`Dependencies.kt`): cycle detection (DFS over `blockedBy`), `validateBlocker` with clear messages,
  cycle-free `blockerCandidates` for the picker, `openBlockers` / `isBlocked`. The store enforces the rule in one
  place (`mutate`): any mutation that would move a task with open blockers to done is rejected (single-task
  actions are rejected entirely, bulk actions complete only the unblocked tasks) and `lastError` names the blockers,
  which the Angular service shows as an error toast. Covers list toggle, bulk, board drag, keyboard move, detail
  page button and the edit form. Deleting a task removes it from other tasks' `blockedBy`.
- Comments (`Comments.kt`): validation, `@mention` parsing (longest member name, case-insensitive, word boundary),
  caret-based mention query, suggestions and insertion. UI: composer with an ARIA combobox autocomplete
  (arrow keys / Enter / Tab / Esc, Ctrl+Enter to send), highlighted mentions, "Current user" select in Settings.
- Activity log (`Activity.kt`): `mutate` diffs the before/after task lists (skipping unchanged tasks by reference)
  and appends entries for create, delete, every field (title, description, status, priority, project, tags, due,
  estimate, time spent, subtasks, assignee, recurrence, blockers) and new comments, storing readable from/to values.
  The log is part of the undo snapshot, so undo removes exactly the entries of the undone step and redo restores
  them. Capped at 5000 entries. Timeline on the task detail page; new `/activity` route (sidebar
  `nav-activity`, shortcut `g a`) with URL-synced member/type filters and 50-per-page pagination, newest first.
- Tests: 60 Kotlin tests (9 new: cycles, gating on every completion path, cleanup on delete, comments/current user,
  mentions, field-by-field activity, undo/redo consistency incl. recurring completion, activity query, import
  validation of dangling blockers and cycles).

### Problems / friction
- Kotlin/JS has no `RegexOption.DOT_MATCHES_ALL`; I built the malformed-import fixtures by editing parsed JSON
  through the JS `JSON` object instead of regex surgery on the exported text.
- angular-eslint's template a11y rules flag `(click)` on listbox options; for an `aria-activedescendant`
  combobox the keyboard lives on the input, so options use `(mousedown)` (which also keeps focus in the input).
- `grep -E "^e:"` on Gradle output hid compiler errors once more because of the console prefix; I now grep
  for `e: ` without the anchor.

### Mistakes I made
1. First draft of `dropDanglingBlockers` checked for deleted tasks with a nested `all { any { … } }` loop (O(n²) on
   every mutation, 1M comparisons with 1000 tasks). Caught on review before testing; replaced with a hash set.
2. Used `RegexOption.DOT_MATCHES_ALL` in a test → compile error; rewrote the fixture with `JSON.parse`.
3. Lint failed on the blocker picker (`click-events-have-key-events`, `interactive-supports-focus`); fixed with
   `mousedown` + a comment explaining the combobox keyboard model.
4. My Playwright check picked demo task #4 as the blocker, which happens to be done already, so the task was not
   blocked and five assertions failed. Then several assertions matched titles by substring ("… #1" also matches
   "… #119"). Both were test bugs; fixed by using two open tasks (t1, t2) and exact-title regex locators.

END: 2026-10-16T11:33:30Z

## Request 3: saved views, timeline

START: 2026-10-16T11:36:38Z

### What was built
- Saved views (Kotlin `Views.kt`, store actions `saveView` / `renameView` / `deleteView`): a view stores the
  canonical list query string (filters, search, sort; never the page). Names are validated (required, ≤ 40,
  unique ignoring case). View changes are part of the undo snapshot (delete shows an Undo toast), persisted and
  included in import/export. `activeView` matches the current URL against views in canonical form.
  UI: "Save view" dialog on the task list, an active-view chip, "Open on board"; sidebar section "Views" with
  links (active one highlighted), and per-view board link, inline rename and delete.
- Board now reads its filters from the URL using the task-list parameters (`boardColumnFor` in Kotlin): project,
  assignee, search, priority, tag and due apply; status is ignored (columns are statuses), sort is ignored (manual
  order). Extra filters coming from a view are shown in a "Also filtered by …" bar with Clear. Keyboard moves
  use the same filtered columns.
- Timeline (`/timeline`, sidebar `nav-timeline`, shortcut `g l`): Kotlin `buildTimeline` lays out project groups
  (collapsible), one row per dated task, bars from local creation day to due day, ticks for week / month /
  quarter zoom, today marker, dependency arrows (elbow paths, dashed when the blocker is already done), and a
  separate "No due date" list; `timelineDayAt` / `timelinePreview` / `shiftDate` drive resizing. Dragging a bar's
  right end previews live and commits one undoable `setDueDate` (logged in the activity log, Undo toast);
  the handle is also a keyboard slider (←/→ one day, Shift one week). "Hide completed", "Today", collapse/expand
  all; zoom is remembered per browser. With `?seed=1000`: ~850 bars render in < 1 s including the seed, zoom
  switches take ~100 ms, a drag round-trip ~200 ms.
- Tests: 68 Kotlin tests (8 new: view CRUD + undo, board/list query mapping, active view matching, keyboard moves
  with a filtered board, `setDueDate`, timeline layout/arrows/inverted bars, collapse/hide-done/zoom, 1000-task
  layout, views in export/import).

### Problems / friction
- Demo data contains tasks whose due date is before their creation date. The spec says "bar from createdAt to
  dueDate"; I draw those bars from due to created with a dashed warning outline and say so in the tooltip.
- Two-axis scrolling with a sticky label column and a sticky date header needed one scroll container with
  `position: sticky` on both; the grid width has to include the label column, which differs on mobile
  (solved with a `--tl-label` CSS variable).

### Mistakes I made
1. `activeView` first compared raw query strings, so a view whose stored query was not in canonical form
   (e.g. "sort=title" without "dir=asc") never matched. Caught by a unit test; both sides are now canonicalised.
2. The timeline grid width was hard-coded as `260 + width` while the mobile label column is 150 px, leaving
   110 px of dead space on phones; seen in the 375 px screenshot, fixed with a shared CSS variable (scroll-to-today
   now measures the label column).
3. Misdiagnosis: my Playwright check reported "undo does not restore the due date". I first suspected lost
   pointer events and moved drag tracking from pointer capture to window listeners (a reasonable robustness
   change that I kept), but the failure persisted. Tracing `localStorage.setItem` showed the real cause: the test
   read the task id from `nth(5)` while the timeline was still re-rendering after expanding a group, then dragged
   a different bar. Fixed in the test by waiting for all bars and locating the handle by task id. The app's
   undo was correct throughout; this cost about 10 minutes.
4. Several first-run assertions in my check (view deleted, group collapsed) read the DOM synchronously right
   after a click; changed them to wait for the expected state.

END: 2026-10-16T11:52:46Z

## Request 4: notifications, reports

START: 2026-10-16T11:59:07Z

**Interruption:** work was stopped by an account usage limit at about 12:05 UTC (after the browser checks had
just passed, before this log entry was written) and resumed at 12:19 UTC; about 12:00–12:19 UTC is lost to the
interruption. On resuming, the port-4004 server I had started was no longer running (the environment had been
reset), so I re-ran lint, tests, build and every browser check from scratch before writing this section.

### What was built
- Notifications (`Notifications.kt`): `AppNotification { id, userId, type, taskId, text, at, read, key }`, stored in
  the persisted state (not in undo history: undoing an assignment does not "un-send" its notification).
  Generated centrally in the store's `mutate`: assignment (to any member, including self-assignment, since every
  local action is performed by the current user), @mentions in new comments (one per comment per mentioned member),
  completion of a blocker (to the assignee of each still-open blocked task). Due reminders for the current user's
  open tasks that are overdue or due today/tomorrow, at most once per task per day (dedupe key
  `due:<task>:<day>`), created on start-up, after changes, when the current user changes and when the date changes.
  Mark one / mark all read; list capped at the newest 500. UI: bell with unread badge (`notifications-bell`),
  dropdown panel (Esc / outside click close, full-width on phones); clicking an item opens the task and marks it read.
- Reports (`/reports`, sidebar `nav-reports`, shortcut `g r`; `Reports.kt`): 30-day burndown per project (open tasks
  at the end of each day, ideal line, hover/keyboard tooltip, project selector incl. "All projects"), workload per
  assignee (sum of open estimates in hours), average cycle time by priority (with sample counts); all SVG, geometry in
  Kotlin (`buildBurndown`, generic `buildHBars`).
- CSV export on the task list (`export-csv-button`): `exportTasksCsv` in Kotlin exports exactly the filtered and sorted
  tasks across all pages, RFC 4180 quoting, CRLF, UTF-8 BOM, and neutralises spreadsheet formula injection
  (cells starting with = + - @ are prefixed with ').
- Tests: 75 Kotlin tests (7 new: assignment/mention notifications, blocker-completed notification, daily due dedupe
  and user switch, read state + persistence + undo independence, burndown series, workload/cycle time/bars, CSV).

### Problems / friction
- Kotlin/JS prints whole `Double`s without a fraction (`2.0.toString() == "2"`), unlike the JVM; labels like
  "2.0 h" needed an explicit one-decimal formatter.
- Self-notification is a product decision: notifying users about their own actions is unusual, but in a
  single-browser app the actor is always the current user, so without it the "assigned to the current user"
  rule could never fire. Documented above.

### Mistakes I made
1. Expected `round1(2.0).toString()` to print "2.0" → failing unit test on Kotlin/JS; added `oneDecimal`.
2. The panel's Escape handler was bound on the host element; after "Mark all read" disables itself, focus falls to
   `<body>` and Escape never reached it. Found by the browser check; now a document-level listener.
3. The notification panel was positioned relative to the bell and stuck out 86 px to the left on a 375 px screen
   (the bell is not at the right edge). Found by the mobile assertion; on phones the panel is now fixed full-width
   under the top bar.
4. A first screenshot of the panel looked semi-transparent; it was captured mid fade-in. Verified the computed
   opacity is 1 after the animation instead of "fixing" it.

END: 2026-10-16T12:23:46Z

## Request 5: sub-projects and custom workflows

START: 2026-10-16T12:31:23Z

### What was built
- Sub-projects (`Workflow.kt`): `Project.parentId` (any depth, cycles rejected by `validateParent`, also on import),
  tree helpers (`projectTree`, `projectPath`, indented `projectOptions` for every project select), and a
  `ProjectMatcher` used by every project filter (list, board, saved views, CSV, burndown, KPIs), so filtering by a
  project includes its descendants; project progress/counts include descendants. Deleting a project asks what to do
  with its sub-projects (move up one level or delete them too) and with the tasks; moved sub-projects that inherited
  a custom workflow from the deleted project keep it. Re-parenting likewise keeps a project's statuses.
- Custom workflows: `Project.workflow` (ordered `WorkflowStatus { id, name, color, category }`, null = inherit;
  default To do / In progress / Done with ids `todo`, `in_progress`, `done`). Store actions add / rename / recolour /
  recategorise / reorder / delete (with a target status for affected tasks, including inheriting sub-projects),
  customise and reset; validation keeps names unique and at least one status per category. Editing an inherited
  workflow gives the project its own copy.
- Category everywhere: `Task.category` is a cached derived field recomputed (together with `completedAt`) by
  `normalizeTasks` in one place after every mutation, import and load; unknown statuses (e.g. after moving a task to
  a project with another workflow, deleting or recategorising a status) are mapped by category. Filters, KPIs,
  completion, completedAt, recurrence, dependency gate, notifications, reports, calendar, timeline and undo now read
  the category; status names/colours come from a Kotlin `StatusLookup` (status pill, CSV adds a `category` column).
- Board: `boardColumns` returns the selected project's workflow as columns (sub-project tasks with other statuses
  are placed by category) or the three categories for "All projects"; drag & drop and Shift+arrows use
  `moveTaskToColumn`, which picks the right status in the task's own workflow. `board-column-todo/in_progress/done`
  are unchanged for the default workflow; columns now flow horizontally for longer workflows.
- Migration: storage key `taskpilot:v2`, schema 2 in exports (`"schema": 2`, project `parentId` + `workflow`).
  On load, v2 is read; otherwise `taskpilot:v1` is parsed, migrated, saved as v2 and removed (a toast says so).
  Import accepts old exports (reported as upgraded) and validates v2 (unknown statuses, parent cycles, unsupported
  schema versions). The theme pre-paint script reads v2 then v1. `?seed=N` unchanged.
- UI: projects page as an indented tree with parent selection, sub-project count, workflow source and an inline
  workflow editor; task form status options follow the selected project's workflow (remapped by category when the
  project changes).
- Tests: 87 Kotlin tests (12 new: tree/cycles, descendant filters/progress, delete options, inheritance and
  validation, category-driven done logic incl. recurrence and blockers, status deletion + undo, project boards and
  moves, moving tasks between workflows, legacy-key migration, v2 import validation, activity names). All earlier
  tests pass unchanged apart from signature updates (`queryTasks`/`boardColumn` take the state now) and the CSV
  column order.

### Problems / friction
- Status was compared to the three constants in ~60 places across 14 Kotlin files. Instead of threading the
  workflow lookup into each, I made `category` a derived field normalised centrally after each mutation; the cost
  is a cached value that must never be set outside the store pipeline (documented on the field).
- Changing exported signatures (`queryTasks`, `boardColumn`, `TaskStore` constructor with key-aware storage
  callbacks) rippled into tests and the Angular services; the compiler found every call site.
- The board's fixed `repeat(3, …)` grid wrapped custom workflows into a second row.

### Mistakes I made
1. My first `moveTaskToColumnIn` rewrite only renumbered the target column; the existing unit test
   `boardMovesUpdateStatusAndOrder` failed on the source column's orders. Restored renumbering of the source column.
2. Two of my new tests encoded wrong expectations: one assumed a sub-project customised *after* its parent gained a
   status would not have it (customising copies it), one moved a card right from the last column. Both were test
   bugs found by the failing runs; fixed the tests, not the code.
3. Left a duplicate KDoc above `createProject` (ktlint error); removed.
4. First version of the workflow editor counted status usage in TypeScript by comparing workflow array references,
   which over-counted for projects on the default workflow; caught while reviewing my own code, moved to a Kotlin
   `workflowUsage` (with a test).
5. Used `role="tree"` / `treeitem` on the projects list without implementing tree keyboard semantics; angular-eslint
   flagged the missing `aria-selected`. Switched to a plain list with screen-reader path text.
6. A rejected rename (duplicate status name) left the typed text in the input, because the state did not change so
   Angular had nothing to re-render; the browser check showed it. The editor now restores the input on error.
7. The board laid out 5 columns as 3 + 2 rows (screenshot); switched to an auto-flowing column grid.
8. Regression scripts needed updating for intended changes (v1 storage key in two scripts, new CSV `category`
   column). In check3 the "legacy data loads" step initially failed because v2 data already existed, which is the
   designed precedence; the test now removes v2 first and also asserts the v1 → v2 migration in the browser.

END: 2026-10-16T12:51:45Z
