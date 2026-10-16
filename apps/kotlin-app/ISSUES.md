# ISSUES

## Request 1: team members, assignees, recurring tasks

START: 2026-10-16T11:04:14Z

### What was built

- `shared`: `Member` entity, `Task.assigneeId` / `Task.recurrence` (with defaults, so data saved before this change still decodes),
  `AppState.members`. New logic in `Members.kt` (initials, contrast colour for avatars, name validation, removeMember) and
  `Recurrence.kt` (`nextDueDate`, `nextOccurrence`, `spawnRecurrences`). Also: an assignee filter in `TaskQuery` (URL param `assignee`,
  `none` = unassigned), `openPerAssignee` stats, import validation for members, assigneeId and recurrence, and the demo members plus
  the second PRNG (`mulberry32(7)`), applied after the base generator so the original output is untouched.
- `web`: the store keeps members in the undoable data. Every task mutation goes through one `updateTasks` that calls
  `spawnRecurrences`, so completing a recurring task anywhere (list toggle, bulk "mark done", board drag or keyboard move, form,
  detail "Mark done") creates the copy in the same history step, and one undo reverts both. A toast with "Open" links to the new copy.
  UI additions: `Avatar` and `RecurrenceIcon` components; Assignee and Repeat fields in the task form; an assignee column and filter on the
  list; an assignee filter (URL) and avatars on the board; an assignee filter (URL) on the calendar; avatar and recurrence in the task
  detail header; the "Open tasks per assignee" SVG bar chart (`data-testid="chart-assignees"`); and a "Team members" card in Settings
  (add, rename, recolour, delete with undo toast). Export includes members.
- 10 new unit tests (39 shared tests on JVM and Node, plus 2 server tests).

### Decisions

- A spawned copy keeps title, description, priority, project, tags, assignee, estimate and recurrence. It gets a new id, `todo`,
  `completedAt = null`, `createdAt = now`, fresh subtask ids (all not done) and time 0. The completed original keeps its
  recurrence, so reopening and completing it again creates another copy (each transition into `done` counts).
- Monthly recurrence clamps to the end of the month (Jan 31 becomes Feb 29 in 2024).
- A task created directly with status `done` does not spawn a copy (only a transition into `done` does).
- Member mutations are undoable like task and project mutations. Deleting a member shows an Undo toast instead of a confirm dialog.
- The dashboard chart lists every member (including those with 0 open tasks), plus an "Unassigned" bar when there are any.

### Problems / friction

- Compose HTML has no SVG text-centering helpers, so avatar initials inside the SVG chart are positioned by hand (`text-anchor`
  via CSS and a manual y offset).
- Recomposition is async, and in-memory undo is lost on reload. Both shaped how the Playwright checks had to be written
  (in-app navigation only before testing undo).
- The new feature changed existing behaviour that an old browser check relied on: the first "To do" card in the demo data (task #1) is
  now weekly, so dragging it to Done spawns a copy and the To-do count no longer drops. I updated that check to drag a non-recurring card.

### Mistakes

1. **Wrong relative path to `styles.css` (twice).** I appended CSS with `../../../../../resources/styles.css` from the `pages`
   directory, which is one level too many. The shell reported "No such file or directory" (the first time, the Kotlin edit in the
   same command had already succeeded). I re-ran the append and the `sed` with paths relative to the app root.
2. **Used `kotlin.math.pow(a, b)` as a function call.** It is an extension (`a.pow(b)`). I spotted it in a grep right after writing
   the file, before compiling, and fixed it with an import and `.pow`.
3. **Put a `<p>` error after an `<li>` inside the `<ul>` member list (invalid HTML).** I caught it on review and moved the error into
   the row as a `role="alert"` span.
4. **Flawed browser check: tested undo after `page.goto`.** A full reload drops the in-memory undo history, so "undo removes copy"
   failed. This is the same trap as in the initial build. I rewrote that part to use the global search and in-app links only.
5. **Flawed browser check: substring search.** "Test landing page #1" also matches #10–#199, so the status assertion saw three rows.
   I filtered by the exact link name.
6. **Didn't anticipate that the old drag check would change** (see friction above). The old check reported 109→109; I picked a
   non-recurring card instead.
7. **Layout issue on mobile:** the add-member name input was squeezed to about 90px at 375px, which I found in a screenshot. I made the
   growing field of `.inline-form` take a full row on small screens (this also improves the projects form).

All of `bun run lint`, `bun run test` and `bun run build` pass. The three Playwright scripts (old and new flows) pass with 0
console errors or warnings, and no page scrolls sideways at 375px. The server on :4005 was stopped by PID.

END: 2026-10-16T11:16:41Z

## Request 2: dependencies, comments, activity log

START: 2026-10-16T11:22:49Z

### What was built

- `shared`:
  - `Task.blockedBy`, `Task.comments` (`Comment { id, authorId, body, createdAt }`), `Settings.currentUserId` (default `m1`) and
    `AppState.activity`. All have defaults, so older saved data loads.
  - `Dependencies.kt`: open blockers, blocked ids, cycle detection with the offending chain (BFS) and readable errors.
    `enforceBlockers` rejects every transition into done of a task with open blockers. It iterates to a fixpoint (cascading),
    lets blockers completed in the same change count as done, and keeps the rejected task's other edits.
  - `Comments.kt`: mention parsing (longest member name wins, word boundaries), `@` query detection at the caret, candidates,
    mention insertion and comment validation.
  - `Activity.kt`: `ActivityEntry` / `ActivityType`, a pure `diffActivity(before, after)` that emits an entry for create, delete
    and every changed field, a 5000-entry cap, plain-language `describeActivity`, `ActivityQuery` (URL params) and filtering.
  - Import validates and accepts the new fields (unknown blocker ids are dropped).
- `web`:
  - **Activity log:** the activity log is part of the undoable `Data`. `Store.mutate` diffs tasks on every change and appends
    entries in the same history step, so undo removes them and redo restores them.
  - **Blocker enforcement:** `Store.updateTasks` runs `enforceBlockers` before recurrence spawning, so every path to done is
    covered (list toggle, bulk, board drag and keyboard, form, detail button) and an error toast names the blockers. The board
    also pre-checks so the card does not jump. The form shows an inline status error.
  - **Detail page:** a Dependencies card with an accessible combobox picker (search, arrow keys, Enter, Escape), remove buttons,
    a "Blocks" list and the cycle error. Also a Comments card (newest last, highlighted mentions, `@` autocomplete with keyboard
    support, Ctrl+Enter to send) and an Activity timeline with "show more".
  - **Blocked indicators:** a "Blocked" badge (`data-testid="blocked-indicator"`) on rows, cards and the detail header.
  - **Activity page:** new `/activity` route (sidebar `nav-activity`, shortcut `g a`) with member and type filters in the URL and 50 per page.
  - **Settings:** a "Current user" select.
- 9 new unit tests (48 shared tests on JVM and Node, plus 2 server tests).

### Decisions

- Board reordering within a column (`order` only) is not logged, because it is not a task "field" from the user's point of view.
  Every other field is logged, including time logged by the pomodoro and subtask changes.
- The log belongs to the undo history, so it also holds entries for deleted tasks. Blocker titles of deleted tasks are recovered
  from the log's "deleted" entries.
- Activity types for filtering: created, deleted, status, assignee, dependencies, comment and updated (other fields). Deleted
  blocker ids are kept on tasks, but missing blockers count as resolved.
- Seeding, importing or resetting replaces the whole log (seeded data starts with an empty log).
- Without a current user (or if that member was deleted) the composer is replaced by a hint linking to Settings.
  Changes made without one are logged with actor "Someone".

### Problems / friction

- The new `enforceBlockers` partially rejects a mutation, which interacts with board `order` renumbering. I avoided odd orders
  by pre-checking board moves before calling `moveTask`; the store-level guard is the safety net for every other path.
- A caret-aware autocomplete in Compose HTML needs a manual element ref for `selectionStart` and a `setTimeout` to restore the
  caret after the controlled `value` update.

### Mistakes

1. **Wrong relative path to `styles.css` again** (third time across requests): `../../../../resources/styles.css` from
   `web/src/jsMain/kotlin/taskpilot/web`. The shell said "No such file", and the lint step in the same command still passed, so it
   would have been easy to miss. I re-appended with an absolute path, and from now on I use absolute paths for that file.
2. **Wrong test expectation for the cycle path:** I reversed the path in the test although `dependencyCycle` documents
   `blocker → … → task`. The JVM test failed and I fixed the test, not the function.
3. **Misleading bulk toast:** "Marked 1 as done" appeared even when the store rejected the completion. I spotted it in a
   Playwright screenshot. `Store.setStatus` now returns how many tasks actually changed, the toast only shows when that is > 0,
   and a browser check asserts there is no such toast.
4. **Deleted blockers showed as "deleted task" in the log.** I saw it in the activity screenshot and now recover the title from
   the log's own delete entries ("Fix onboarding #5 (deleted)").
5. **Browser-check selector mistakes (again substring matching):** `hasText: 'Deploy landing page #3'` also matched #32, which
   crashed Playwright's strict mode. I switched to `[data-card-id=task-3]`. The pagination check also assumed one bulk delete
   produced more than 50 entries; it didn't, so I made it delete two pages first.
6. **Mention dropdown placement:** it was anchored to the bottom of the whole composer (below the buttons). I caught it while
   reviewing the CSS and wrapped the textarea and list in their own positioned anchor.

`bun run lint`, `bun run test` and `bun run build` pass. All four Playwright scripts (requests 0–2) pass with 0 console
errors or warnings, including 375px checks for `/activity` and the task detail. The server on :4005 was stopped by PID.

END: 2026-10-16T11:37:42Z

## Request 3: saved views, timeline

START: 2026-10-16T11:42:10Z

### What was built

- `shared`:
  - `SavedView { id, name, params, createdAt }` stored in `AppState.views` (defaults to empty, so older data loads).
    Helpers: `viewParams` (filters, search and sort, never the page), list and board URL params, the board's derived query
    (`boardQuery` drops status, sort and page), `boardIgnoredParts`, `matchingView`, name validation. Import validates views.
  - `Timeline.kt`: `Zoom` (week 36 px/day, month 12, quarter 4), bars from the created day to the due day (start clamped when the
    due date is before creation), the visible range padded to whole Monday-start weeks, project-grouped rows with collapse,
    axis ticks per zoom, `dueAfterDrag` (snap to days, never before the start), `visibleRows` for virtualisation and
    `dependencyLinks`.
  - 8 new tests (56 shared tests on JVM and Node, plus 2 server tests).
- `web`:
  - **List:** a "Save view" button and dialog (validation, duplicate names rejected). An `?view=<id>` marker shows the active-view
    bar (rename inline, delete with undo toast, "Open on board").
  - **Sidebar:** a "Views" section; each view opens the list, and a hover/focus button opens it on the board. The active view
    is highlighted.
  - **Undo:** views are part of the undoable data.
  - **Board:** now applies every list filter except status (search, priority, project, assignee, tag, due) and says what it does
    not apply (status filter, sort).
  - **Timeline:** new `/timeline` route (`nav-timeline`, shortcut `g l`).
    - **Layout:** a sticky header with ticks, a sticky task-name column, a today line, grid lines, project groups with collapse
      toggles, avatars and priority accents. Overdue bars are outlined and done bars faded. A "Hide done" filter and the zoom
      level are kept in the URL, and the chart scrolls to today on open and on zoom change.
    - **Dependencies and due dates:** dependency arrows from the end of the blocker to the start of the blocked task, routed
      around when they overlap. Dragging the right edge changes the due date: a live preview with a date tooltip, one undoable
      change on release (with an Undo toast), touch supported. The handle is a focusable slider (arrow keys ±1 day,
      Shift ±1 week).
    - **No due date:** tasks without a due date are listed separately in a collapsible section.
    - **Performance:** rows are virtualised: only about 30 rows are in the DOM. With `?seed=1000` it loads in about 280 ms and
      scrolling costs about 26 ms per frame in headless Chromium.

### Decisions

- A view stores filters, search and sort, not the page. Opening a view adds `view=<id>` to the URL. Any filter change drops it,
  because the list no longer shows exactly that view. A view is not updated automatically; save a new one instead.
- "Filters that make sense on the board": everything except the status filter (the columns are statuses) and the sort (cards
  keep their manual board order). The board says so in the view bar.
- The timeline bar starts at the local creation day. If the due date is before the creation date, the bar is a single day at the
  due date. Dragging cannot end a bar before its start.

### Problems / friction

- Compose HTML 1.7.3 has no pointer-event listeners in its DSL, so dragging uses `onMouseDown`/`onTouchStart` on the handle plus
  window listeners registered in a `DisposableEffect` while a drag is active.
- With 1000 tasks, rendering every row would be slow, so I wrote manual virtualisation: one absolutely positioned row per
  visible index, scroll-driven state updated only when the window can change, and `key()` per task so DOM nodes are reused.
- The timeline needs the task-name column width both in CSS (sticky column) and in Kotlin (x-coordinates). I pass it as a CSS
  custom property (`--label-w`) set from Kotlin, so phones get a narrower column without the two drifting apart.

### Mistakes

1. **Wrong arithmetic in two unit-test expectations** for `visibleRows` (400/32 = 12.5 rounds up to 13; 31900/32 floors to
   996). The JVM test run showed both; the function was right, so I fixed the expectations.
2. **Browser check assumed every group and arrow is in the DOM.** Because of virtualisation, only the first group was rendered
   and the dependency arrow was outside the window. I changed the check to scroll until the blocked row renders, then assert
   the arrow.
3. **`boardIgnoredParts` was written and tested but not used in the UI.** I noticed it while reviewing the board screenshot
   (the status filter of the "Alex todo" view was silently ignored). It is now shown in the board's view bar, with a browser check.
4. **Group labels were truncated to "W…" on phones** because group rows reused the 132px name column. I spotted it in the 375px
   screenshot and let group labels grow (`width: max-content`, capped at 360px).

`bun run lint`, `bun run test` and `bun run build` pass. All five Playwright scripts (initial build plus requests 1–3) pass with
0 console errors or warnings, including the 375px timeline. The server on :4005 was stopped by PID.

END: 2026-10-16T11:54:06Z

## Request 4: notifications, reports

START: 2026-10-16T11:59:07Z

**Interruption:** work stopped at about 12:00–12:19 UTC because the account hit a usage limit. When I resumed, the code
for both features was in place and lint, tests and build had passed. The first run of the new browser check had shown 3
failures, all related to blocker notifications, which I had not yet investigated. The server I had started on :4005 was no
longer running.

### What was built

- `shared`:
  - **Model:** `Notification { id, userId, type, taskId, message, at, read, key }` stored in `AppState.notifications`
    (default empty, so older data loads).
  - **Notification rules (`Notifications.kt`):**
    - `notificationsForChange` covers assignment to a member, mentions in new comments, and a completed blocker. A blocker
      notification goes to the assignee of each open task it blocks.
    - `dueNotifications`: overdue, or due today or tomorrow. The key `due:<user>:<task>:<day>` makes it once per task per day.
    - Read and mark-all helpers, and a 300-entry cap that drops the oldest read notifications first.
  - **Reports (`Reports.kt`):**
    - `burndown`: open tasks per day, where open means created on or before the day and not completed by it.
    - `workloadPerAssignee`: estimated hours of open tasks, plus a count of open tasks without an estimate.
    - `cycleTimeByPriority`: average days from created to completed.
    - `tasksToCsv`: RFC 4180 quoting with CRLF line endings, and protection against formula injection (`=`, `+`, `-`, `@`).
  - 9 new tests (64 shared tests on JVM and Node, plus 2 server tests).
- `web`:
  - **Store:** notifications are kept outside undo history and persisted. Event notifications are created inside `Store.mutate`.
    Due reminders are checked at startup, every minute, after the current user changes, and after the data is replaced.
  - **Bell:** a top-bar bell (`notifications-bell`) with an unread badge and a dropdown panel. Each item has an icon for its
    type and a time. Clicking an item marks it read and opens the task. Each item has its own "mark as read" button, and the panel
    has "Mark all as read". The panel closes on Esc or an outside click.
  - **`/reports` page:** new route (`nav-reports`, shortcut `g r`) with:
    - a burndown line chart with a project selector kept in the URL, sharing the hover/keyboard tooltip of the dashboard chart (now a generic `LineChart`);
    - a workload horizontal-bar chart in SVG;
    - an average cycle-time bar chart in SVG with sample counts.
  - **Task list:** "Export CSV" (`export-csv`) downloads every filtered task in the current sort order, across all pages.

### Decisions

- Notifications are stored per recipient member. The bell shows those of the current user. Switching the current user in
  Settings simulates other people, e.g. Sam mentions Alex, then Alex sees it.
- Self-actions also notify. For example, Alex assigning a task to Alex creates "Alex Kim assigned you …". In a
  single-browser app the current user is the only actor, so otherwise "assigned to the current user" could never fire.
- "Due within 24 hours" uses the app's day-based due dates: due today or tomorrow counts as due soon, and earlier counts as overdue.
- Undo does not remove notifications that were already delivered.
- Imports and `?seed=N` start with an empty notification list. Due reminders are then regenerated for the current user.

### Problems / friction

- The usage-limit interruption (see above).
- Recurring tasks interacted with notifications: completing a recurring blocker creates its next occurrence, and that new
  task looked like a fresh assignment.

### Mistakes

1. **A spurious "assigned you" notification for recurring copies.** Completing a recurring blocker created the next
   occurrence, assigned to the same person, and `notificationsForChange` treated the new task as an assignment. The browser
   check found it: 14 notifications instead of 13, and clicking the newest notification opened the copy instead of the
   blocked task. I printed the newest notifications to confirm. Fix: `notificationsForChange` takes `generatedTaskIds`, and the
   store passes the ids of spawned copies. A unit test covers it.
2. **Wrong unit-test expectation for next-day reminders.** On the next day, tasks due today become overdue and tasks due the
   day after become due tomorrow, so 4 reminders fire, not 3. The test failed, I re-checked the rule (it is correct) and fixed
   the expectation.
3. **Same SVG mistake as in the initial build:** a fully qualified `org.jetbrains.compose.web.svg.Title { … }` resolved to the
   file's private builder `val`. The compile error showed it, and I fixed it by importing `Title(text)`.
4. **My first edit after resuming failed:** I tried to patch the `Store.mutate` notification call with text from before
   `ktlintFormat` had re-wrapped it. The Python script stopped with an assertion after already patching
   `Notifications.kt`, which left the call broken for a moment. I re-read the formatted code and applied the rest of the edits
   to it.

`bun run lint`, `bun run test` and `bun run build` pass. All six Playwright scripts (initial build plus requests 1–4) pass with 0
console errors or warnings, including 375px checks of `/reports` and the notifications panel. The server on :4005 was stopped by PID.

END: 2026-10-16T12:25:50Z

## Request 5: sub-projects and custom workflows

START: 2026-10-16T12:30:58Z

### What was built

- **Model / schema 2.**
  - `Project.parentId` and `Project.workflow` (null means inherit) are new.
  - New `WorkflowStatus { id, name, color, category }`.
  - `Task.statusId` was added; it defaults to the category key, so v1 JSON decodes unchanged.
  - `Task.status` is kept as the status **category**, so every category-based feature (filters, KPIs, completion, `completedAt`,
    recurrence, dependencies, notifications, reports, calendar, timeline) keeps working unchanged.
  - The invariant "statusId exists in the task's effective workflow and has the task's category" is restored by
    `normalizeTasks` after every store mutation, on load, on import and after project deletion. If the two disagree, the
    category wins and the id becomes the first status of that category.
  - `withStatus` (category actions such as "mark done") and `withWorkflowStatus` (concrete status) handle `completedAt`.
- **Migration.**
  - Storage moved to `taskpilot:v2` (`schemaVersion: 2`). On load, v2 is read; if absent, `taskpilot:v1` is decoded and
    migrated, then written to v2. The v1 entry is kept as a backup.
  - The inline theme script reads v2 first, then v1.
  - Export writes v2. Import accepts v1 and v2 files and validates parents (unknown parent, cycles), workflows (unique
    ids/names, valid colours/categories, every category present) and rejects newer schema versions.
- **Sub-projects.**
  - Shared helpers: tree (`projectTree`, `descendantIds`, `ancestors`, `projectPath`, `canSetParent`).
  - The projects page is now a tree: indented cards with `aria-level`, a parent select per project (descendants excluded),
    an "add sub-project" button, and counts and progress including descendants.
  - Filtering by a project includes its descendants on the list, the board, saved views, CSV export and the reports burndown.
  - The dashboard's project chart shows top-level projects including their sub-projects. Timeline groups use the
    "Parent › Child" path. Project selects show the tree.
  - The delete dialog asks whether sub-projects move up one level or are deleted too. A child that moves up keeps the
    workflow it inherited from the deleted project.
- **Workflows.**
  - Effective workflow: own, else nearest ancestor's, else the default (`todo`/`in_progress`/`done`).
  - The editor (per project card): "Customize workflow" (copies the inherited one), add status (name, category, colour;
    inserted after its category), rename, recolour, change category, reorder up/down, delete with a target-status dialog,
    and "Use the parent's / default workflow". It is validated so that every category keeps at least one status.
  - **Board:**
    - **Columns:** a selected project's statuses are the columns, so the default workflow keeps
      `board-column-todo/in_progress/done`. "All projects" shows the three categories as before.
    - **Generic movement:** board movement logic is now generic (`moveTaskTo`, `moveTaskByKeyboardIn`). The category board
      wraps it with the old functions, so the old tests still pass.
    - **Mixed workflows:** a card whose sub-project has a different workflow is shown in the first column of its category.
      Dropping it uses the same status if its workflow has it, otherwise the first status of that category.
  - **Task form, badges and activity:** the task form offers the project's statuses and remaps them by category when the
    project changes. Status badges show the workflow name and colour. The activity log records status-id changes and shows
    status names.
- 9 new tests (73 shared tests on JVM and Node, plus 2 server tests). A new browser script covers migration, the tree,
  descendant filtering, customisation and inheritance, workflow board columns, drag and keyboard moves into custom
  statuses, KPIs by category, undo, rename/reorder/delete of statuses, project re-assignment, both sub-project delete
  options, v2 export, v1 and v2 import, `?seed=1000` and 375px.

### Decisions

- `Task.status` keeps its name and meaning as the category (instead of turning into the id), with `statusId` alongside. This
  keeps the persisted JSON readable, keeps old exports importable, and keeps every category-based feature untouched.
- The status filter on the task list stays per category, as the spec asks everything to use the category.
- Deleting a workflow status moves its tasks in one undoable step. This is treated as a structural change, so blocker
  enforcement and recurrence spawning (which react to user completions) do not run. `completedAt` is still set or cleared
  by category.
- Status ids are slugs of the name, unique within a workflow. Renaming keeps the id.
- Customising a workflow copies the inherited statuses (same ids), so existing tasks keep their status. Reverting to
  inherit maps tasks by id when the inherited workflow has it, otherwise by category.

### Problems / friction

- The biggest risk was the many places that assumed three fixed statuses. Keeping the category in `status` and adding one
  normalisation choke point (`Store.mutate`) avoided touching most of them.
- Kotlin `copy(status = …)` does not update a field whose default derives from `status`, so `statusId` can go stale. Every
  category change goes through `withStatus` (which sets the id hint), the activity diff tolerates a stale id, and
  normalisation fixes the rest.

### Mistakes

1. **Brace mismatch while turning `filterTasks` into a block body.** My scripted edit left an extra `}`. I saw it by
   printing the function and fixed it before compiling.
2. **Import cycle detection didn't work at first.** I checked `pr.id in ancestors(pr.id)`, but `ancestors` stops at the
   first repeated id, so the project itself never appears in its own list. The new unit test (cyclic export must be
   rejected) failed. Fix: walk up from the parent and look for the project.
3. **The activity diff logged "todo → todo"** when a test changed only `status` via `copy()`, because `statusId` was stale.
   The existing activity test failed. The diff now logs by category when the id did not change; the store also normalises
   before diffing.
4. **I deleted `Store.updateProject` by accident.** I replaced a code range by slicing up to `fun deleteProject(`, which also
   removed `updateProject` sitting in between (I had first written a two-step `updateTasksAndProjects` helper that would
   have broken "one undo", and then replaced it). The compile errors showed it and I restored the function.
5. **Unqualified call inside `Store.deleteWorkflowStatus` to the shared function of the same name.** It could resolve to the
   member and recurse. I imported the shared one under an alias (`removeWorkflowStatus`).
6. **Workflow name inputs could keep stale text after reordering.** The rows were unkeyed with uncontrolled inputs. I caught
   it in review and wrapped each row in `key(status.id)`. A browser check now asserts the renamed value stays with its row
   after "move up".
7. **The existing browser scripts read `taskpilot:v1`** and the legacy-data check wrote v1 while v2 existed, so it would no
   longer test anything. I switched them to v2 and made the legacy check clear v2 first, so it now exercises the migration.
8. Minor: "1 tasks" on project cards (seen in a screenshot). Fixed with pluralisation.

`bun run lint`, `bun run test` and `bun run build` pass. All seven Playwright scripts (initial build plus requests 1–5) pass with 0
console errors or warnings. The server on :4005 was stopped by PID.

END: 2026-10-16T12:49:03Z
