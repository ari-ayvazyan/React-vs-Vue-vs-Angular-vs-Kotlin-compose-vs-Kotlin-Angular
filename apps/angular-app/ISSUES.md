# ISSUES – Angular maintenance log

## Request 1: team members, assignees, recurring tasks

START: 2026-10-16T09:10:56Z
END: 2026-10-16T09:24:27Z

### What was built
- `Member { id, name, color }` plus `Task.assigneeId` and `Task.recurrence`. `AppState.members` is now part of the undoable snapshot.
- Pure logic lives in `core/members.ts` (initials, WCAG-based avatar text colour, name validation), `core/recurrence.ts` (month-end clamping, next occurrence, spawning on a not-done→done transition) and `core/chart-scale.ts` (the "nice" axis step, extracted from the line chart so both charts share it). `filters.ts` gained `matchesAssignee` and `assignee` in `TaskQuery`/URL. `stats.ts` gained `openByAssignee`.
- Recurrence is handled centrally in `StoreService.mutate`, so every route to "done" spawns the copy inside the same history entry: row toggle, bulk "Mark done", board drag/keys, the detail status buttons and the form. One undo reverts both. An info toast tells the user the next due date.
- UI: `app-avatar` component; an assignee column on list rows; an avatar on board cards; avatar and name plus a "Repeats weekly" badge on the detail page; an Assignee and a Repeat select in the task form; Assignee filters on the list (`?assignee=`, counted in the filter badge, works with back/forward), the board and the calendar (both `?assignee=` and merged with `project`/`month`). New tasks created from a filtered board column or calendar cell start with that assignee. The dashboard has a new `app-hbar-chart` (hand-written SVG, `data-testid="chart-assignees"`). Settings has a "Team members" section: add, edit (rename and recolour in one step, Esc cancels, focus goes back to the Edit button), and remove with a confirmation that states how many tasks get unassigned, plus an Undo toast.
- Demo data: the original values are untouched. Members m1..m5 are added, and `mulberry32(7)` draws assignee then recurrence per task.
- Tests went from 31 to 50. One of them pins a timezone-independent FNV fingerprint of the generator output, which I took *before* changing the generator.

### Problems / friction
- "Hand-written SVG like the others": the existing project bar chart is actually HTML/CSS, and the line chart uses `preserveAspectRatio="none"`, which stretches its text. For a chart that is mostly labels I wanted 1 SVG unit = 1 CSS px. So the new chart measures its own width with a `ResizeObserver` (started in `afterNextRender`, so SSR-safe) and sets the viewBox from it.
- Under the wording "the generator output must stay exactly the same", Task objects necessarily gain two fields. I read it as "every pre-existing value is identical". I checked that two ways: a full JSON diff of the 300-task output before and after (only `members`/`assigneeId`/`recurrence` differ), and the fingerprint unit test.
- Avatar text contrast: several of the specified member colours (#a855f7, #ef4444, #f97316, #22c55e) are mid-luminance, so neither white nor dark text reaches 4.5:1 on some of them. I pick whichever of the two contrasts more (WCAG formula). Some avatars therefore get dark initials (e.g. purple), which is correct, but you might not expect it.
- Undo toasts: the existing pattern is "toast action = `store.undo()`", which undoes whatever comes last. If I had given the recurrence toast an Undo button too, the bulk-done toast and the recurrence toast would both have one, and clicking both would undo twice. So the recurrence toast is information only. Ctrl+Z, or the action's own toast, reverts both.

### Mistakes (what happened → how found → fix)
1. **Wrong expectation in my own contrast unit test.** I assumed white text on #a855f7. **Found:** `bun run test` failed. Working the formula by hand gives 4.3:1 with dark text versus 3.96:1 with white, so the code was right and the test was wrong. **Fix:** corrected the expectation and added a darker purple (#7c3aed → white) case.
2. **Unassigned avatar rendered as a 34×98 px dashed oval on mobile list cards.** I had used the host class `empty`, and the global `.empty` rule in `styles.css` (meant for empty-state cards: padding, centring) also matched the avatar. **Found:** 375px screenshot, then a Playwright probe of the computed box. **Fix:** renamed it to the namespaced `avatar-none`.
3. **Truncated chart labels at desktop width** ("Taylor Bro…", "Morgan Pat…"). The label column (32%) and the 7px/char estimate were too tight. **Found:** desktop dashboard screenshot. **Fix:** a 40% column (110–180px) and a 6.5px/char estimate. The full names still appear in the tooltip and the screen-reader table.
4. **Add-member colour swatches sat lower than the name input.** My `.swatch-set .swatches { min-height: 0 }` override (meant for the edit row) also applied to the add form. **Found:** settings screenshot. **Fix:** a `min-height: 38px` for the add form only.
5. **Two bugs in my Playwright script** (not the app): (a) I read SVG `<text>` with `innerText`, which is empty for SVG, so the label and value checks failed; switched to `textContent`. (b) I located the t1 row with `hasText: "Test landing page #1"`, which also matches "#13" etc., so I toggled a non-recurring task and the "copy created" check failed. Now it locates the row by `a[href="/tasks/t1"]`. **Found:** first e2e run (5 FAIL), confirmed by reading the output. After the fixes: 59/59 PASS.
6. Minor: I first added a `StoreService.assignTasks()` bulk method that nothing used. I removed it before the first build, so no dead API shipped.

### Deviations / notes
- If the user reopens a completed recurring task by hand (not via undo) and completes it again, another copy is created, because each not-done→done transition spawns one. Undo/redo never double-spawns. Creating a task that is already "done" does not spawn.
- Monthly recurrence clamps to the month end (Jan 31 → Feb 28/29). The new due date is exactly one interval after the old due date, even when that is still in the past, as the request specified.
- Member names must be unique (case-insensitive) and at most 60 characters, the same rule as project names.
- Dashboard layout: the project chart, assignee chart and streak card now share a three-column row (2 columns below 1280px, 1 below 1024px).
- I enabled router `anchorScrolling` so the dashboard's "Team" link (`/settings#team`) scrolls to the section.
- Verified in Chromium against the prod server on :4003 at 1440px and 375px (dark): 59 checks, no console errors or warnings, and no horizontal overflow on mobile.

## Request 2: dependencies, comments, activity log

START: 2026-10-16T09:31:01Z
END: 2026-10-16T09:43:05Z

### What was built
- **Model:** `Task.blockedBy: string[]` and `Task.comments: Comment[]` (`{ id, authorId, body, createdAt }`). `AppState.activity: ActivityEntry[]` (`{ id, taskId, taskTitle, actorId, type, field?, from?, to?, at }`). `Settings.currentUserId` (default `'m1'`). Older data loads with defaults (`[]`, `[]`, `[]`, `'m1'`).
- **Pure logic:**
  - `core/dependencies.ts`: open blockers, an `isBlocked` check, cycle detection that returns the path, a batch-aware completion check, and pruning of dangling ids.
  - `core/mentions.ts`: encode `@Full Name` → `<@id>` tokens, parse tokens back, detect the mention under the caret, list candidates, insert a completion.
  - `core/activity.ts`: diff two task lists into entries, a capped append, describe an entry in words, and filtered queries.
- **Store:**
  - `mutate` now also prunes blockers that point at deleted tasks and appends activity entries for every task change in the same undo step. The activity log is part of the undo snapshot, so undo removes an entry and redo restores it.
  - Every route to "done" is guarded: `setStatus` covers the list toggle, bulk action and detail buttons; `moveOnBoard` covers drag and keyboard; `updateTask` covers the form. A refused move shows an error toast naming the blockers.
  - A blocker completed in the same batch counts as done.
  - `addBlocker` refuses self-references, duplicates and cycles with a sentence that names the chain. Other methods: `removeBlocker`, `addComment` (current user, mention tokens), and the `blockedIds` and `currentUser` computeds.
- **UI:**
  - "Blocked" badges (lock icon; the tooltip lists the blockers) on list rows, board cards and the detail page.
  - The task form shows an inline "Blocked by …" error and won't submit `done`.
  - `app-dependency-picker`: an ARIA combobox (arrows/Enter/Esc, mouse) with a "Blocked by" list and remove buttons, plus a read-only "Blocking" list.
  - `app-comment-thread`: comments oldest first, highlighted mentions, a composer with `@` autocomplete (arrows, Enter/Tab, Esc; Ctrl+Enter sends) and a character counter. If no current user is set it shows a link to Settings.
  - `app-activity-list` is used for the detail timeline (newest first, 15 plus "Show all") and for the new `/activity` route: sidebar entry `nav-activity`, `g a` shortcut, URL-synced `?actor=`/`?type=`/`?page=` filters, 50 per page, newest first.
  - Settings has a "Current user" select.
- **Tests:** 50 → 68 unit tests. New e2e suite: 44 checks. The Request 1 e2e suite was rerun and still passes 59/59.

### Problems / friction
- **Where to put comments and the log.** Comments live on the task, so deleting a task and undoing it carries its comments along. The log lives in `AppState.activity` and sits inside the undo snapshot. That made "undo removes its entry" automatic rather than something a separate inverse operation has to get right.
- **Blocked "done" in a bulk action.** Rejecting the whole batch felt wrong, so allowed tasks are completed, blocked ones are skipped, and one error toast lists them. The "Marked N done" toast counts only the tasks that actually changed.
- **Form edits plus a blocked status.** `updateTask` still applies the other fields and drops only the status change. The form itself stops this earlier with an inline error.
- **Lint vs. the ARIA combobox pattern.** Focus stays on the input (`aria-activedescendant`), so the options don't need focus. But `click-events-have-key-events` and `interactive-supports-focus` flag `(click)` on the `<li role="option">`. I satisfied them with `tabindex="-1"` and a `(keydown.enter)` handler instead of disabling the rules.
- **Size of the log.** Each Pomodoro pause and each form field change produces an entry, so I capped the log at 5000 entries (oldest dropped) to keep localStorage bounded.

### Mistakes (what happened → how found → fix)
1. **Detail markup:** my scripted insertion of the Dependencies and Comments sections added a `</div>` before `<aside>`. The original `</div>` stayed, so the new sections ended up outside the left column. **Found:** I read the inserted region back before building. **Fix:** removed the stray close tag.
2. **Doubled spaces around mentions** ("Hi␣␣@Jordan Lee␣␣please"). A bare `{{ seg.text }}` inside `@if` keeps the surrounding template whitespace, and the comment body uses `white-space: pre-wrap`. **Found:** the detail screenshot. **Fix:** text segments are wrapped in `<span>`, so the whitespace-only nodes are stripped. Added an e2e assertion on the exact rendered text.
3. **Confusing cycle message:** "…so “X” cannot also block it" repeated a title and left "it" ambiguous. **Found:** reading the e2e output. **Fix:** "That would create a cycle: “A” waits for “B” already, so “B” can't also wait for “A”."
4. **Lint:** 4 a11y errors on the combobox options (see friction) and 2 `no-useless-escape` errors (`\[` inside a character class in mentions.ts). **Found:** `bun run lint`. **Fix:** as described; removed the escapes.
5. **Mistakes in my e2e script (not the app):**
   - I asserted that entry text `startsWith('Sam Rivera')`, but `innerText` starts with the avatar initials ("SR"). Changed to `includes`.
   - I pressed Shift+→ twice in a row on a board card. The card is re-rendered in its new column and refocused in a `setTimeout`, so the second press hit nothing. Added a wait between presses, the same thing a user's natural pause does.
   - **Found:** the first run had 4 FAILs; I read each one before changing anything.
6. When I first stopped the server, `ps` still listed the PID right after `kill`, because the process was still shutting down. A second check showed it gone and port 4003 refused connections. Nothing was left running.

### Deviations / notes
- Activity entries carry an extra `taskTitle` (title at the time of the change) so that entries for deleted tasks stay readable on `/activity`. All other fields match the requested shape. `from`/`to` hold serialised raw values (ids, enum keys, comma-joined arrays) and are turned into names when displayed, so renamed projects and members show their current names.
- Activity types: `created`, `deleted`, `status`, `assignee`, `dependency`, `comment`, and `field` for every other tracked field (title, description, priority, project, repeat, due date, estimate, time spent, tags, subtasks). `order` and `completedAt` are derived values and are not logged.
- The log starts empty for demo data (`?seed=N`, reset). The demo generator's output did not change, apart from the new empty fields.
- A change made with no current user selected is logged with `actorId: null` and shown as "Someone". The `/activity` member filter has a "No current user" option for these entries. Comments need a current user.
- Comments can be added but not edited or deleted (not requested). If a member is removed, their comments show "Former member".
- Deleting a task removes it from other tasks' `blockedBy`. This is logged as a dependency change on those tasks and is part of the same undo step.
- A recurring copy keeps `blockedBy` but starts with no comments.
- On import, `blockedBy` must reference existing tasks and must not form a cycle; otherwise the import is rejected with a message.

## Request 3: saved views, timeline

START: 2026-10-16T09:51:51Z
END: 2026-10-16T10:04:10Z

### What was built
- **Saved views:**
  - `SavedView { id, name, params, createdAt }` in `AppState.views`, stored as the list's URL query params minus `page`. Because they are params, views keep working when filters are added or changed: `normalizeParams` re-parses them and drops unknown or invalid values. Views are part of the undo snapshot, like projects and members, and are not in the activity log, which covers tasks only.
  - Task list: a "Save view" button opens a dialog. It suggests a name built from the active filters (e.g. "High · Website"), made unique, so Enter saves it. Names are validated (required, ≤60 characters, unique). When the URL matches a saved view, the header shows "Tasks · <name>" with "Open on board", "Rename" and "Delete view" (Undo toast).
  - Sidebar: a "Views" section. Links open `/tasks` with the view's params and are marked `aria-current` only on an exact match. It works in the collapsed sidebar (icon plus tooltip) and in the mobile drawer.
  - Board: now uses the shared `filterTasks` with the filters that make sense there: search, priority, project, assignee, tag, due. Status (the columns), sort (cards have their own order) and paging are dropped. A note shows the active view and any filters that have no select on the board, with "Clear these" and "Open in list".
- **Timeline (`/timeline`, `nav-timeline`, `g l`):**
  - `core/timeline.ts`:
    - Grouping by project in project order, then "No project"; empty groups are omitted.
    - Bars run from the creation day to the due day.
    - The date range is padded, aligned to the zoom unit and clamped to ±730 days around today.
    - Axis ticks: days (week zoom), Mondays (month zoom), month starts (quarter zoom).
    - Row flattening with collapsed groups.
    - Window calculation for virtualization, and drag-to-date math.
  - Page:
    - Virtualized rows: only the ~30 rows near the viewport are rendered.
    - Sticky header and label column; a "today" line; the view opens scrolled to today.
    - Week, Month and Quarter zoom (in the URL; keeps the centre date); "Hide completed" (in the URL).
    - Collapsible groups, plus "Collapse all" and "Expand all".
    - SVG dependency arrows from the blocker's bar end to the blocked task's bar start. Arrows are orange while the blocker is open. When the blocked bar starts before the blocker ends, the arrow routes between rows.
    - Dragging a bar's right end (pointer capture, live date tooltip) sets the due date as one undoable, logged edit, with an Undo toast.
    - Keyboard alternative: ←/→ moves the due date ±1 day, Shift for ±7.
    - Tasks without a due date are listed in a collapsible "No due date" section (first 100, then a link to `/tasks?due=none`).
- **Shared CSS moved to `styles.css`:** `.segmented` and `.modal-actions`.
- **Tests:** 68 → 81 unit tests.
- **Browser checks:** new e2e suite of 51 checks; the Request 1 (59) and Request 2 (44) suites were rerun and still pass.
- **`?seed=1000` results:**
  - First render: about 250ms.
  - DOM: 28 task rows and ~690 elements in total.
  - Scrolling 60 steps of 500px: median frame 16.5ms, p95 21ms.
  - Switching zoom takes about 180ms, and dragging still works.

### Problems / friction
- **Size with 1000 tasks.** About 850 dated rows, each with a label, bar and handle, plus arrows and gridlines, would have been several thousand nodes and slow to re-render while dragging. I virtualized from the start instead of waiting to measure a problem. Fixed row height (34px) makes the window maths trivial. Arrows are computed only when one of their ends is inside the rendered window.
- **Sticky label column over absolutely positioned rows.** Each row is absolutely positioned and spans the full canvas width, so a `position: sticky; left: 0` label inside it sticks against the scroller. The header is sticky to the top, and its "Task" corner is sticky to the left as well.
- **Tasks due before they were created** (the demo data has some). Their bar runs from the due day to the due day (`start = min(created, due)`). Dragging never moves the due date before the bar start.
- **Board vs. view matching.** A view that only sets status or sort maps to "no board filters". To avoid showing such a view as the active view on an unfiltered board, a view counts as active on the board only if it sets at least one board filter.

### Mistakes (what happened → how found → fix)
1. **Keyboard edits on a timeline bar dropped focus.** A new due date can change the bar start (when due < created) and so re-sort the row inside its group. Angular then moves the row's DOM node, and moving a node blurs it. **Found:** e2e check "handle keeps focus after keyboard change" failed. **Fix:** after a keyboard change, `refocusHandle` brings the row back into the rendered window if needed and refocuses its handle on the next frame.
2. **Unused `map` import in the timeline page** (copied from the board's imports). **Found:** `bun run lint`. **Fix:** removed it.
3. **Mistakes in my e2e script (not the app):**
   - It asserted ≥6 group rows at the top of the timeline. Groups are virtualized like task rows, so only the first was rendered. Moved the check to after "Collapse all", where all 7 are rendered.
   - It used `scrollIntoViewIfNeeded()` on a drag handle. That scrolls only until the handle is barely visible, which left it under the sticky 260px label column, so the press hit the label. That gave three drag failures at seed 300 and one at seed 1000. I confirmed with a probe (`elementFromPoint` and pointer-event logging) that drag itself worked. Fix: center the handle (`scrollIntoView({inline: 'center'})`) before dragging.
   - On mobile it pressed Enter before the "Save view" dialog's input was rendered and focused, so the dialog stayed open and the following click timed out against the backdrop. Fix: wait for `[data-testid="view-name-input"]:focus`.
   - **Found:** the first runs (1 crash, then 6 FAILs). I investigated each one before deciding whether it was the app or the script.

### Deviations / notes
- Views are managed (renamed, deleted, opened on the board) from the task-list header while the view is open. The sidebar holds plain links. No separate management screen.
- Board filters from a view: search, priority, project, assignee, tag, due. Status, sort and direction are not applied on the board, by design.
- The timeline shows done tasks dimmed (use "Hide completed" to remove them). Group collapse state is per visit and not persisted.
- Bars start on the creation day, as requested, so most demo bars are long. A due date can't be dragged before the bar start.
- Arrows are drawn only when both tasks are visible on the timeline: dated, and their groups are expanded.

## Request 4: notifications, reports

START: 2026-10-16T10:10:34Z
END: 2026-10-16T10:21:11Z

### What was built
- **Notifications:**
  - `AppNotification { id, type, recipientId, taskId, taskTitle, actorId, detail?, key?, at, read }` in `AppState.notifications`, persisted and capped at 500.
  - Notifications are created for whichever member is affected, so every member has their own feed. The bell shows the current user's.
  - Pure logic in `core/notifications.ts`:
    - `assigned`: the task's assignee changed to a member, or a task was created with one. Recurring copies are created silently.
    - `mentioned`: once per mentioned member in a new comment.
    - `unblocked`: a task was completed; the assignees of open tasks it was blocking are told.
    - `due`/`overdue`: the due day ends within 24h, or has passed. One per task, recipient and calendar day (key `due:<task>:<member>:<day>`).
  - Change-driven notifications are created in `StoreService.mutate`. Due reminders are synced on load, every minute, and after each change/undo/redo/import.
  - Bell (`notifications-bell`):
    - Unread badge and an `aria-label` with the count.
    - Panel (`role="dialog"`) with newest first, the latest 50.
    - Per-item "mark as read" (dot button) and "Mark all as read".
    - Clicking an item marks it read and opens the task.
    - Esc and outside clicks close the panel; Esc returns focus to the bell.
    - On phones the panel is pinned to the viewport.
    - With no current user, it says to choose one in Settings.
- **Reports (`/reports`, `nav-reports`, `g r`):**
  - Burndown for the last 30 days, with a project selector (all / each project / no project; `?project=`). It reconstructs open tasks per day from `createdAt`/`completedAt`.
  - Workload per assignee: open-task estimates in hours, plus an Unassigned row and a note on unestimated tasks.
  - Average cycle time by priority, with the sample size in the label.
  - All three are hand-written SVG. The existing `LineChart` and `HBarChart` were made reusable: a value-label input, rows without a badge, and display text.
- **Export CSV** on the task list exports exactly `filtered()`: every page, in the current sort order.
  - RFC 4180 quoting, CRLF line endings, UTF-8 BOM.
  - Cells that a spreadsheet would treat as formulas are prefixed with `'`.
  - Columns: ID, Title, Status, Priority, Project, Assignee, Tags, Due date, Estimate, Time spent, Subtasks done/total, Blocked by (titles), Repeats, Created, Completed, Description.
  - A small `utils/download.ts` helper is now shared with Settings' JSON export.
- **Tests:** 81 → 95 unit tests.
- **Browser checks:** new e2e suite of 34 checks. Request 1–3 suites rerun: 59 + 44 + 51, all pass. The CSV check compares the downloaded file's IDs against the list's order collected across every page (165 tasks, 7 pages).

### Problems / friction
- **Who gets notified.** A local, single-browser app with a "current user" switch. Creating notifications for whichever member is affected, and filtering by current user in the bell, keeps every member's feed correct when the user switches. Self-actions are not suppressed: the current user is the actor of nearly every change, so suppression would mean "assigned to the current user" could never fire. A self-assignment reads "You assigned yourself".
- **Undo semantics.** Notifications are kept out of the undo snapshot, like a mailbox. Undoing an assignment does not take back the notification, and marking things read is not undoable. Putting them into the snapshot would have made undo revert unrelated read states.
- **"Within 24 hours" with date-only due dates.** A task is due at the end of its due day (local time). A reminder fires when that moment is ≤24h away; past it, the reminder is "Overdue".

### Mistakes (what happened → how found → fix)
1. **Settings changes lost on a fast reload (pre-existing data-loss bug).** Saves are debounced by 150ms. In the e2e run I switched the current user and immediately navigated with a full page load. The pending save was dropped, so the mention was authored by the wrong member ("Alex Kim mentioned you"). Any real user closing or reloading the tab within 150ms of a change had the same problem. **Found:** e2e check "mention notifies the mentioned member" failed with the wrong actor. **Fix:** the store flushes a pending save on `pagehide`.
2. **Esc stopped closing the notification panel after "mark as read".** The dot button disappears once the item is read. It held focus, so focus fell to `<body>`, and the panel only listened for Esc inside itself. **Found:** e2e check. **Fix:** Esc is handled at document level while the panel is open, and marking read moves focus to the item.
3. **Notification panel off-screen on phones** (x = −82px). It is right-anchored to the bell, which isn't at the screen edge. **Found:** e2e check of the panel's bounding box. **Fix:** fixed positioning with 12px margins at ≤600px. While doing this I first used `!important` to override a rule declared later, then moved the media query below the base rule instead.
4. **Horizontal overflow on mobile `/reports` (pre-existing latent bug in both charts).** The screen-reader `<table class="sr-only">` inside the charts ignores `width: 1px` (tables size to their content) and stuck out of the card. It hadn't shown before only because the dashboard's grid cells happened to clip it. **Found:** e2e overflow check, then a probe listing the elements past the viewport edge. **Fix:** each table is wrapped in a `div.sr-only`. I didn't change the table's `display`, because that can strip table semantics for screen readers.
5. **Stretched axis text in the line chart.** It drew into a fixed 640-unit viewBox with `preserveAspectRatio="none"`, so on the full-width burndown the labels were pulled wide. The same, milder, on the dashboard. **Found:** reports screenshot. **Fix:** the viewBox now tracks the measured width (ResizeObserver), as in the bar chart.
6. **Wrong expectation in my burndown unit test** (4 instead of 3 open tasks; I had forgotten that task b was completed on Jun 13). I had also written a pointless `.map` around the expected array. **Found:** `bun run test`. **Fix:** corrected it to `[3, 3]` with a comment explaining why.
7. **A leftover no-op** (`const done …; void done;`) in the first draft of the "unblocked" logic. I spotted it on re-reading and removed it before the first build.

### Deviations / notes
- Notifications stay after undo (see above). Notifications of a deleted member are kept in storage but never shown.
- "Unblocked" fires once per completed blocker, even if the task still has other open blockers. The text names the completed blocker.
- The burndown is reconstructed from the current tasks. Deleted tasks and earlier reopen/complete cycles can't be shown, because only the latest `completedAt` is stored.
- Workload counts only estimated open tasks. The number left out because they have no estimate is shown under the chart.
- The CSV export is the full filtered result, not just the visible page. Formula-like cells get a leading `'`, so a title starting with `=`, `+`, `-` or `@` appears with that prefix.

## Request 5: sub-projects and custom workflows (change request)

START: 2026-10-16T10:29:37Z
END: 2026-10-16T10:52:22Z

### What was built
- **Schema v2** (`SCHEMA_VERSION = 2`, key `taskpilot:v2`):
  - `AppState.version`.
  - `Project.parentId` and `Project.workflow` (`WorkflowStatus[] | null`, where null means inherit).
  - `Task.statusId` (the workflow status).
  - `Task.status` is still there but is now the category of `statusId`. It is cached so that all category logic reads one field.
- **Migration:**
  - The store reads `taskpilot:v2`, falls back to `taskpilot:v1`, and validation upgrades v1: `statusId := status` (the default workflow's ids equal the category names), top-level projects, inherited workflow. The next save writes v2. The v1 entry is left untouched as a backup.
  - Import accepts v1 and v2 exports; the version is checked, and unknown versions are rejected with a message. Export writes v2.
  - A unit test checks that a v1 conversion of the demo data migrates to exactly the v2 demo data.
- **`reconcileTasks` (core/workflows.ts):** one pure normaliser that runs inside every undoable mutation, before recurrence, blocker pruning, activity and notifications.
  - It keeps `statusId` valid for the task's effective workflow, mapping by category when it isn't (project moved, status deleted, workflow reset).
  - It sets `status` to the status's category and maintains `completedAt`.
  - It maps category-only writes (list toggle, bulk "mark done", the existing category-based paths) to the first status of that category.
  - So "everything uses the category" holds by construction (filters, KPIs, completion, recurrence, the dependency done-guard, notifications, reports, calendar, undo), and the old code paths needed no rewrite.
- **Sub-projects (core/project-tree.ts):**
  - Tree order, subtree map, cycle check, ancestors/path, indented `<select>` options.
  - `matchesProject` includes descendants. It is used by the task list, board, burndown and dashboard/projects roll-ups (`projectProgress` with a subtree). The dashboard chart shows top-level projects with rolled-up numbers.
  - Every project select shows the tree. The timeline groups follow tree order with "Parent / Child" names. CSV exports the project path.
- **Projects page (rewritten as a tree):**
  - Create a project inside another; collapse/expand.
  - Rolled-up counts and progress, plus "N own tasks".
  - Workflow label (default / "Workflow of X" / custom).
  - "Move" dialog that excludes the project itself and its descendants. The store also refuses cycles.
  - Delete dialog: tasks unassigned or deleted, and, if there are sub-projects, "move them up one level" or "delete them too". Sub-projects moved up that inherited the deleted project's custom workflow get a copy of it, so their tasks keep their statuses.
- **Workflow editor (`app-workflow-editor`, in a modal per project):**
  - An inherited workflow is shown read-only with its source and a "Customize" button (copies the inherited statuses, keeping their ids).
  - Add, rename, recolour (native colour input), change category, reorder (up/down) and delete statuses. Delete asks where the tasks go, preselecting the same category.
  - "Use the parent's / default workflow again" resets the workflow.
  - Invariant: at least one status per category, unique non-empty names (≤30 characters), hex colours. Refused edits show an error and reset the control.
  - Each edit is one undoable mutation.
- **Board:**
  - With a project selected, the columns are that project's workflow statuses.
  - Tasks of sub-projects with another custom workflow appear in the first column of their category.
  - With "All projects" or "No project", the columns are the three categories.
  - Column keys of the default workflow are `todo`/`in_progress`/`done`, so `board-column-*` test ids are unchanged.
  - Drag/drop and Shift+arrows work across any number of columns, through the generic `moveTaskTo` and `ColumnTarget`. Columns now flow horizontally.
- **Other UI:**
  - Task form: the status select shows the selected project's workflow and remaps by category when the project changes.
  - Detail page: one button per workflow status.
  - Badges and CSV show the status name; CSV has an extra "Status category" column.
  - The activity log records status changes by status name.
- **Tests:** 95 → 112 unit tests. New tests cover the tree, workflows, reconcile, the board move, migration, import, and store operations.
- **Browser checks:** new e2e suite of 55 checks. The Request 1–4 suites (59/44/51/34) were rerun after the final build and all pass.

### Problems / friction
- **Where the truth lives.** I considered replacing `Task.status` with only a workflow status id. That would have touched every status-dependent module (filters, stats, recurrence, dependencies, notifications, reports, calendar, timeline, CSV) and multiplied the risk. Instead `statusId` is authoritative and `status` is a cached category kept in sync in one place, `reconcileTasks` in `mutate`. That one function is unit-tested on its own, and the regression suites passed after the change once they read the new storage key. The price is a denormalised field; `validateAppState` rejects data where `status` ≠ category(`statusId`).
- **Category-only writes vs status writes.** If both `status` and `statusId` can change, which one wins? Rule: if `statusId` changed (or is invalid), it wins. If only `status` changed, it is mapped to the first status of that category. Getting this right is what keeps the old toggle, bulk and recurrence paths correct.
- **Workflow ids are shared between a parent and a customised copy.** Customising copies the statuses with the same ids, so tasks keep their status. The cost is that status ids aren't globally unique. The activity log therefore stores status *names*.

### Mistakes (what happened → how found → fix)
1. **Done-guard bypass through `statusId` (caught in review, before any test).** In `updateTask`, when the blocker guard refused "done", I cleared `patch.status` but left `patch.statusId`. Since `statusId` is authoritative, a blocked task would still have been completed via the detail buttons or the form. **Found:** re-reading the code I had just written. **Fix:** a refused completion drops both fields.
2. **Board columns wrapped to a second row** with a fourth custom status (`grid-template-columns: repeat(3, …)` was hard-coded). The fourth column landed below the fold, and drag-and-drop into it failed (5 e2e failures). **Found:** e2e, then a probe showing the column at y=1056. **Fix:** `grid-auto-flow: column` with an auto column width (240px minimum so four fit at 1440px; more scroll sideways). I added an e2e check that all columns share one row.
3. **Fragile drop into an empty column.** After the layout fix, a single-step `dragTo` still didn't drop into the empty "Code review" column, while a stepped drag did. On the first `dragover`, the "No tasks" `<li>` under the pointer is replaced by the placeholder. A `dragover` targeting a removed node doesn't reach the list's handler, so Chrome cancels the drop. Real users usually keep moving, but the dependency is real. **Found:** event tracing (only one `dragover`, no `drop`), then a control test on the default board, which worked. **Fix:** `pointer-events: none` on the "No tasks" and placeholder items, so the drop target is always the list. The e2e suite keeps the single-step `dragTo` as a regression check.
4. **e2e2's "board drag refused" check could never have caught a broken drag.** It only asserts the status did *not* change. I noticed this while debugging item 3. The new suite now asserts successful drags (default and custom columns) explicitly.
5. **Lint: `role="treeitem"` requires `aria-selected`.** The tree isn't a selection widget. **Fix:** a plain list. The collapse button carries `aria-expanded`, and each sub-project shows its parent path visibly ("in Website / Frontend").
6. **Scripted edits that didn't apply:**
   - (a) A replacement in demo-data.ts and one for the burndown signature didn't match code Prettier had reformatted earlier. The first aborted, so nothing was written; the second produced a build error. Redone against the current text.
   - (b) A Python patch failed to parse because the CSV expectation contains `""` inside a triple-quoted string. Nothing was written; I redid it from a script file.
7. **Wrong expectation in my own store test** (reorder: I expected Review first; the correct order is To do, Review, Done). **Found:** `bun run test`. **Fix:** assert the full order.
8. **Earlier e2e suites read `taskpilot:v1` directly** and crashed on the new key. I pointed them at v2, so their "old data" checks now exercise v1-shaped data under the new key, which must still load. They did. The e2e4 CSV header check was updated for the new column.
9. **Meta line spacing** ("in Website ·Default workflow"): Angular drops whitespace between spans. **Found:** screenshot. **Fix:** flex with a gap.

### Deviations / notes
- `taskpilot:v1` is kept after migration as a one-step backup. It is never written again.
- Project names must be unique among siblings, not globally, so "Frontend" can exist under two parents. Before, names were globally unique.
- Moving a project that inherits a workflow under a new parent makes it use the new parent's workflow; tasks are mapped by category. Deleting with "move up" is the exception: there a copy is kept, because the user didn't ask for a workflow change.
- The dashboard's "Completion by project" chart shows top-level projects, with sub-projects rolled in.
- Activity entries logged before this change still read correctly (category labels). New status entries store the status name.
- The task-list "Status" filter stays category-based (To do / In progress / Done), as the request says.
