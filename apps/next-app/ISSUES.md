# ISSUES – maintenance log

## Request 1: team members, assignees, recurring tasks

START: 2026-10-16T09:10:56Z
END: 2026-10-16T09:23:13Z

### What was built
- `lib/members.ts`: initials, WCAG-based avatar text colour (white or near-black, whichever contrasts more), member name validation, assignee matching (`NO_ASSIGNEE = 'none'`).
- `lib/recurrence.ts`: due-date advance (daily +1, weekly +7, monthly = same day next month, clamped to month end), next-occurrence builder, `spawnRecurrences` (runs inside the reducer), and the completion toast text.
- `lib/dates.ts`: `addMonths`.
- Reducer: `member/create|update|delete` (delete unassigns tasks). `task/update`, `task/bulkUpdate` and `task/move` append the next occurrence in the same state transition when a repeating task goes from not-done to done, so one undo entry covers both.
- `Data` (the undoable state) now includes `members`, so member CRUD is undoable too.
- Demo: members `m1`..`m5`, plus a second `mulberry32(7)` drawing the assignee and then the recurrence for each task. The original fields are unchanged; a test pins a sha256 of the old fields for 1000 tasks, captured before the change.
- Import/storage: `members` is optional (defaults to `[]`), `assigneeId` to `null` and `recurrence` to `'none'`. Unknown assignee ids or invalid recurrence values are rejected with a clear message, the same way unknown projects already were.
- UI:
  - Task form: Assignee and Repeat selects.
  - Avatars on list rows (new "Who" column; on mobile it sits next to the project), board cards and the detail page header and activity panel.
  - Repeat icon on rows and cards, and a "Monthly"/… badge on the detail page.
  - Assignee filter: on the list it is synced to the URL as `?assignee=<id|none>`; the board and calendar have local filters, like the board's project filter. Those filters also preset the assignee in the "add task" buttons.
  - Settings: a "Team members" section to add, rename and delete members; clicking an avatar recolours the member. Deleting shows an undo toast saying how many tasks were unassigned.
  - Dashboard: SVG `AssigneeBars` chart (`data-testid="chart-assignees"`), busiest member first with "Unassigned" last. Each row links to that person's open tasks, and hover or focus shows the share of all open tasks.
- Refactor: the debounced colour swatch and the palette picker moved from `ProjectsView` into the shared `components/ColorSwatch.tsx`, and Projects and Members both use it.
- Tests: 26 → 44 (`tests/members-recurrence.test.ts`). The `task()` fixture moved to `tests/fixtures.ts`.

### Decisions / deviations
- **A copy of a copy** gets id `t12-r2`, not `t12-r1-r1`. It is the next free number on the base id.
- **Reopening and completing again** spawns another occurrence. Each completion is treated as finishing an occurrence. I did not add tracking to prevent this, because the request did not ask for it.
- **The completed original keeps its recurrence.** Demo data also has done tasks marked weekly, so done tasks can show the repeat icon.
- **Monthly drift:** Jan 31 → Feb 28 → Mar 28, because each step clamps from the previous due date.
- **Member names must be unique** (case-insensitive) so the filter dropdowns are not ambiguous. Projects already work this way.
- **Board and calendar assignee filters are not in the URL.** That matches the board's existing project filter. Only the list filter was asked to be URL-synced.
- **"Today" for a task without a due date** is the local date of the completion timestamp, so the reducer stays pure.

### Problems / friction
- The repo has no existing E2E harness, so I wrote a standalone Playwright script in the scratchpad (37 checks).
- `/opt/pw-browsers/chromium` is a symlink straight to the `chrome` binary, not a directory. My first launch path guessed `.../chromium/chrome-linux/chrome`. I found this with `ls -la` and used the symlink directly.
- After `kill <pid>`, `ps -p` briefly still reported the process. A second check a moment later showed it gone and port 4002 free.

### Mistakes
1. **E2E: the search for the recurring task matched the wrong row.** Searching "Test landing page #1" also matched `#114`, so the script toggled an already-done task. That failed the "copy created" check, and the toast said "Reopened … #114". Fixed the script to pick the row whose link text exactly matches the title. This was a script bug, not an app bug.
2. **E2E: the legacy-data check was invalid.** I rewrote localStorage in the live page and then navigated. The app's `pagehide` flush wrote the in-memory state back over my edit, so I was not testing old-format data at all. The check failed because the data still had members. Fixed by seeding the old format through `addInitScript` in a fresh browser context, before any app code runs.
3. **Dashboard chart: bars overlapped their value labels on mobile.** Bars had a CSS `width` transition. The first render uses a guessed width (420px) before ResizeObserver measures the real one, so the bars animated down while the labels jumped into place immediately. Found in the 375px screenshot. Fixed by removing the transition.
4. **Settings UX:** the first version showed a colour square next to an avatar of the same colour, which was redundant. Found in the screenshot. Fixed by making the avatar itself the colour picker (`ColorSwatch` gained `round` and a render-prop child).
5. **Lint warnings in my new test.** Destructuring with `_a`/`_r` placeholders triggered `no-unused-vars`. Fixed by copying the task and deleting the two keys.
6. **Leftover code in `MembersSection`:** an odd `maxLength={MEMBER_NAME_MAX + 20}` on the rename input. I caught it on review and removed it, so the validation message handles over-long names.
7. **`completedMessage` was first exported from `TasksView.tsx`.** That is the wrong layer, and the detail view needed it too. I moved it into `lib/recurrence.ts` as `completionMessage` and added a test.

### Verification
- `bun run lint`, `bunx tsc --noEmit`, `bun run test` (44 passed) and `bun run build` all pass.
- Production server on port 4002 with Playwright: 37/37 checks, no console errors or warnings. Checked desktop, a 375px viewport and dark mode. The legacy-data load was checked in a fresh context. The server was stopped by its PID.

## Request 2: dependencies, comments, activity log

START: 2026-10-16T09:31:31Z
END: 2026-10-16T09:44:11Z

### What was built
- **Dependencies** (`lib/dependencies.ts`):
  - `Task.blockedBy`, with open-blocker lookup, cycle detection that returns the offending chain (`findCycle`), a whole-graph cycle check for import, and error message builders.
  - Detail page "Dependencies" panel: a searchable combobox picker (keyboard and mouse, `role="combobox"`/`listbox`), a "Blocked by" list with remove buttons, and a read-only "Blocking" list.
  - A cycle is rejected with an inline `role="alert"` message, e.g. `Can’t add “A”: it already waits on “B” (“A” → “B”), so this would create a cycle.`
  - Completion rule enforced in two layers:
    1. The reducer never lets a task with open blockers become done, whether through `task/update`, `task/bulkUpdate` or `task/move`. A form save that also sets status keeps its other field changes.
    2. A shared `useCompletionGuard()` hook is called from the list toggle, bulk "Mark done", board drag, board keyboard move, the detail "Mark done" button, the detail form and the edit modal. It shows the error toast naming the blockers.
  - Bulk completion finishes the unblocked tasks and leaves the blocked ones selected.
  - "Blocked" badge (lock icon, tooltip names the blockers) on list rows, board cards and the detail header.
  - Deleting a task, directly or with its project, removes it from other tasks' `blockedBy`.
- **Comments** (`lib/mentions.ts`): `Task.comments`, oldest first, shown on the detail page.
  - The author is the new `settings.currentUserId` setting (Settings → Team members → "Current user", default `m1`). With no valid user, a hint replaces the form.
  - Typing `@` opens a member autocomplete (arrow keys, Enter/Tab, Escape); Ctrl/⌘+Enter sends.
  - Mentions are stored as `@{memberId}` tokens, so renames carry through. Typed `@Full Name` text is converted on submit (longest name wins; `mail@x.com` is left alone).
  - Mentions render as highlighted pills; a mention of a deleted member renders struck through.
- **Activity log** (`lib/activity.ts`): `ActivityEntry { id, taskId, actorId, type, field?, from?, to?, at }`, with types create/update/comment/delete.
  - Recording happens in `TaskStore.dispatch`. It diffs the task lists before and after the action and appends the entries to the same history snapshot. That makes undo/redo consistent by construction, and changes like member deletion (unassign), project deletion and recurrence copies are logged automatically.
  - Tracked fields: title, description, status, priority, project, tags, due date, estimate, time spent, subtasks, assignee, repeat and blockers, plus added comments.
  - Detail page "History" timeline: newest first, the first 12 with "Show all".
  - `/activity` route with a sidebar entry (`data-testid="nav-activity"`) and a `g a` shortcut. Newest first, filterable by member (plus "No author") and by type, URL-synced (`?actor=&type=&page=`), 50 per page.
- **Import and storage:** all new fields default when missing. Imports reject:
  - self, unknown or cyclic dependencies;
  - invalid comments;
  - invalid activity entries.
- **Tests:** 44 → 64 (`tests/collab.test.ts`). They cover dependencies and the reducer guard, mentions, activity diff, filter, description and URL parsing, and store undo/redo consistency.

### Decisions / deviations
- **Ignored fields:** `order` and `completedAt` are not logged. `order` changes on every sibling during a board reorder, and `completedAt` follows from status. A move between columns is logged as a status change.
- **Size limits:** the log is capped at the newest 5000 entries to keep localStorage bounded. Long values are stored truncated to 280 characters; subtasks are stored as `[x] title` lines.
- **No log entries:**
  - import, reset and `?seed=N` replace the data without writing entries;
  - an imported file's own `activity` is kept;
  - project-only and member-only changes are not task changes, so they are not logged, except where they change tasks.
- **Actor:** stored as an id, and the current name is shown. An unset or deleted current user is stored as `null` and shown as "Someone".
- **New occurrences:** a recurring task's next occurrence starts with no blockers and no comments.
- **Bulk "done":** blockers are judged on the state before the action. Selecting both a task and its blocker completes the blocker and refuses the task, matching what the toast says.
- **Comment editing:** comments cannot be edited or deleted, because the request did not ask for it. The log can still record a removed comment, for example one dropped by an import.
- **Panel name:** the detail-page timeline is titled "History", because the page already had a panel called "Activity" (due, time spent, created).

### Problems / friction
- Picking a combobox option with the mouse needs `onMouseDown` + `preventDefault`. Otherwise the input's blur closes the list before the click lands.
- The earlier lesson about the Activity component keeping hidden routes mounted still applied: I used `:visible` selectors throughout.
- `ss` is not installed in the container. My first port check used it and printed "PORT_FREE" only because the `grep` failed. I re-checked with curl (no response on 4002) and `ps -p <pid>`.

### Mistakes
1. **Real bug: mention insertion broke for fast typing.** After choosing a mention, I restored the caret inside `requestAnimationFrame`. Keystrokes typed before that frame landed at the end, and the frame then moved the caret back in front of them. The text became `…@Sam Rivera ease review, cc @Sam Rivera pl`. Found by the Playwright run, which types quickly. Fixed by applying a pending caret position in a `useLayoutEffect` right after React commits the new value.
2. **Repeated mistake from request 1:** I again used an unused `_ignored` destructuring placeholder in a test, which raised the same `no-unused-vars` warning. Fixed by building the object explicitly. I should have remembered the earlier fix.
3. **The fingerprint test failed after adding `settings.currentUserId`.** It hashes `settings`, which now has a new key. The old fields were unchanged. Fixed the test to hash only the fields that existed before, and noted why in a comment.
4. **Leftover code:** I wrote pointless re-exports (`taskMap`, `commentText`) at the bottom of `TaskCollab.tsx` and removed them on review before linting.
5. **E2E script bugs, not app bugs:**
   - Asserted "Blocking" with `includes`, but CSS uppercases the sub-heading, so `innerText` is "BLOCKING". Changed to a case-insensitive check.
   - Asserted activity rows `startsWith('Sam Rivera')`, but the avatar initials ("SR") come first in `innerText`.
   - Read the page-2 row count before the re-render, which made it fail intermittently. Now it waits for the count.
6. **First cycle-message wording was confusing** ("…is blocked by…" twice). I rewrote it before writing the tests, and the tests pin the final text.

### Verification
- `bun run lint`, `bunx tsc --noEmit`, `bun run test` (64 passed) and `bun run build` all pass.
- Production server on port 4002 with Playwright:
  - The request 2 script: 46/46 checks, run twice.
  - The request 1 script re-run: 37/37.
  - No console errors or warnings.
  - Checked a 375px viewport and the old pre-request-1 data shape in a fresh context.
- The server was stopped by its PID; port 4002 no longer responds.

## Request 3: saved views, timeline

START: 2026-10-16T09:52:00Z
END: 2026-10-16T10:02:09Z

### What was built
- **Saved views** (`lib/views.ts`): `SavedView { id, name, search, createdAt }`. `search` is the normalised task-list query string without the page. Views are part of the undoable state, so create, rename and delete can be undone; they are not task changes, so they write no activity entries.
  - **Task list:** a "Save view" button opens a name dialog (required, at most 40 characters, unique) that shows a summary of the filters being saved.
  - **Active view banner:** shown when the current filters equal a saved view (the page is ignored). It offers Open on board / Rename / Delete (with an undo toast). "Save view" is disabled in that state.
  - **Sidebar "Views" section:** links to `/tasks<search>`, highlighted when active, plus a board icon per view ("Open on board"). It shows a hint when there are no views and stays compact when the sidebar is collapsed.
  - **Board:** filters now live in the URL. The project and assignee selects write `?project=&assignee=`. A view opened on the board keeps search, priority, project, assignee, tag and due; status, sort and page do not apply to a board (`boardQuery`). Search/priority/tag/due are shown in an "Also filtered by …" banner with a Clear button.
- **Timeline** (`/timeline`, `data-testid="nav-timeline"`, `g l` shortcut; layout logic in `lib/timeline.ts`):
  - Gantt chart with a sticky header (month bands plus day, week or month ticks), a sticky task-name column (avatar and link), and a today line.
  - Tasks are grouped by project with collapsible groups. Each group header shows its overall span. Tasks without a due date are listed separately below the chart.
  - Zoom: week (44 px/day), month (16 px/day) and quarter (6 px/day). The chart scrolls so today is in view on first load and on every zoom change, and a "Today" button does the same.
  - Dependency arrows run from the blocker's bar end to the blocked task's bar start, with an elbow route when the blocked task starts earlier. They are dashed once the blocker is done, and hidden when either end is collapsed.
  - **Changing the due date:** drag the right end of a bar (pointer capture, whole days, a live date label, never before the bar start). Each commit is one undoable `task/update`, logged in the activity log, with an undo toast. The bar end is also a focusable `role="slider"`: ← → move it a day, Shift moves it a week.
  - **Performance with `?seed=1000`:** 847 rows render in about 240 ms. Switching to week zoom takes about 80 ms; 20 scroll frames take about 340 ms. Rows use `content-visibility: auto`; drag previews re-render only the dragged (memoised) row; layout is memoised.
- **Tests:** 64 → 80 (`tests/views-timeline.test.ts`). They cover view serialisation and normalisation, matching, name validation, board query, the reducer, undo, import, and the timeline span, range, ticks, bands, grouping, pixel mapping, drag clamping, edges and a 1000-task timing check.

### Decisions / deviations
- **Which view is active** is worked out by comparing the current URL query with each saved query; no view id is kept in the URL. If two views have identical filters, the first one counts as active. Changing any filter leaves the view, which then shows as not active. There is no "update view": save a new one and delete the old.
- **Renaming and deleting happen on the task list** (the active-view banner), not in the sidebar. The sidebar has open-in-list and open-on-board.
- **Board filters now use the URL** (with `replaceState`, so they don't add history entries) instead of local state. As a result, the board page needs a Suspense boundary.
- **Due before creation:** if a task's due date is before its creation day, its bar collapses to the due day (hatched) and cannot be dragged earlier than that day.
- **Arrows to collapsed groups or undated tasks are not drawn.**
- **Arrows pass under the bars:** they are painted below the rows, so a bar covers any segment that crosses it (see mistake 2).

### Problems / friction
- Rows with `content-visibility: auto` each become their own stacking context. That decides what can be layered over the sticky label column (see mistake 2).
- Sticky elements inside an `overflow: hidden` box don't stick, because that box becomes the scroll container (see mistake 3).
- Chromium's background requests to Google hosts are refused by the sandbox proxy, which prints warnings after Playwright runs. They are not app traffic.

### Mistakes
1. **Junk code in the first draft of `TimelineView`:**
   - a nonsensical expression in the drag-finish handler (`draggedDue(span, e.clientX - (e.clientX - …)) && preview`);
   - a stray `export { NO_GROUP }`;
   - an O(n) `tasks.find` per arrow.

   I caught all three on review before the first build and fixed them: the drop date is now computed from the pointer event, the export is gone, and arrows use a map.
2. **Arrows drawn over the sticky task names.** The SVG overlay had `z-index: 2`. Because every row is its own stacking context, the labels' `z-index: 3` could not lift them above it, and a dependency line crossed the name column. The today line had the same problem. Found in the arrow screenshot. Fixed by painting the grid and arrow layers before and under the rows (`z-index: 0`; rows `z-index: 1`; labels are opaque), and making group rows translucent. I also moved the arrow's horizontal leg off the row border, where it was hard to see.
3. **Month label in the header cut off** ("ctober 2026"). The band used `overflow: hidden`, so its sticky label never stuck. Found in the mobile screenshot. Fixed with `overflow: clip`.
4. **Label column width hard-coded twice.** I first set the mobile label width with CSS `!important` while the arrow overlay, grid and canvas still used the 260 px constant inline, so they would have been misaligned on mobile. I caught it on review before the browser run and switched to a single CSS variable `--label-w`. The "scroll to today" code now measures the column instead.
5. **Test data literals needed `views: []` again.** This is the third request in a row where adding a field to `Data` broke every hand-written `Data` literal in the tests. I fixed them with `sed`. A shared `emptyData()` fixture would prevent this; noted for next time.

### Verification
- `bun run lint`, `bunx tsc --noEmit`, `bun run test` (80 passed) and `bun run build` all pass.
- Production server on port 4002 with Playwright:
  - The request 3 suite: 37/37 checks, covering saved views end to end (sidebar, list, board, rename, delete, undo, reload) and the timeline with `?seed=1000`.
  - The timeline checks covered rows, groups, undated tasks, zoom, collapse, drag plus undo, keyboard moves, dependency arrows, scroll timing and mobile.
  - Regression runs: request 1 suite 37/37, request 2 suite 46/46.
  - No console errors or warnings. The server was stopped by its PID.

## Request 4: notifications, reports

START: 2026-10-16T10:10:27Z
END: 2026-10-16T10:22:06Z

### What was built
- **Housekeeping first:** added a shared `emptyData()` test fixture, as noted after request 3. Adding a field to the undoable state no longer breaks every hand-written `Data` object in the tests (5 places replaced).
- **Notifications** (`lib/notifications.ts`): `Notification { id, userId, type, taskId, taskTitle, actorId, at, read, key, detail? }`.
  - **Storage:** persisted in the saved state, but kept outside undo history, so reading one is not undoable.
  - **Event notifications** are created in `TaskStore.dispatch` from the same activity entries as the log:
    - an assignee is set → `assigned`;
    - a comment with `@{id}` mentions → `mentioned` for each person, with a snippet;
    - a task becomes done → `unblocked` for the assignee of every open task it blocks.
  - **Reminders:** `due` (due today or tomorrow) or `overdue`, for the current user's open tasks, keyed `due:<task>:<day>`, so each task gets at most one per day. The bell re-checks when the day, the tasks or the current user change.
  - **Bell** (`data-testid="notifications-bell"`): shows the unread count (99+ cap) and an accessible label ("Notifications, 3 unread"). It opens a panel with type icons, actor names, mention snippets and times.
  - **Panel:** "Mark all as read" and a per-item "Mark as read" dot. Clicking an item marks it read and opens the task; items whose task was deleted say so and don't navigate. It closes on Escape or an outside click, returning focus to the bell, and becomes full width on phones.
  - **Per-user inboxes:** switching "Current user" shows that member's inbox; with no current user, the panel explains how to pick one.
  - At most 1000 notifications are kept.
- **Reports** (`/reports`, `data-testid="nav-reports"`, `g r` shortcut; logic in `lib/reports.ts`). All charts are hand-written SVG:
  - Burndown: open tasks at the end of each of the last 30 days, with a project selector (all projects, each project, or no project) and a hover/keyboard tooltip. I generalised the dashboard's area chart into `AreaChart`; `CompletedAreaChart` is now a thin wrapper.
  - Workload: estimated hours of open tasks per assignee, plus "Unassigned". Open tasks without an estimate are counted and named in the subtitle. I generalised the dashboard's assignee bars into `MemberBars`; `AssigneeBars` is now a wrapper.
  - Average cycle time (created → completed, in days) by priority: vertical bars with value labels and the number of tasks under each bar.
- **Export CSV** (`lib/csv.ts`): a button on the task list exports exactly the filtered and sorted list the user sees, across all pages.
  - Format: RFC 4180 quoting, CRLF line endings, a UTF-8 BOM so spreadsheet apps detect the encoding, and the filename `taskpilot-tasks-YYYY-MM-DD.csv`.
  - Project and member names are resolved, and free-text cells starting with `= + - @` are prefixed with `'` to prevent CSV formula injection.
- **Import and storage:** `notifications` is optional (defaults to `[]`) and validated. `?seed=N` and "Reset demo data" clear notifications; an import brings its own.
- **Tests:** 80 → 94 (`tests/notify-reports.test.ts`).

### Decisions / deviations
- **Self-caused events notify too:** assigning yourself, mentioning yourself, or completing your own blocker. The "current user" is a role you switch between in one browser, and the request says to notify whenever these things happen to the current user. A multi-user product would usually skip your own actions; that is a one-line filter in `eventNotifications`.
- **Undo does not take back a notification.** Notifications sit outside history, just as messages that have been sent can't be recalled. Redo does not create duplicates (no new dispatch).
- **"Due within 24 hours" works at day granularity**, since due dates have no time: due today or tomorrow. Overdue tasks get one reminder per day while they stay open; reminders are only created for the current user.
- **Burndown history is rebuilt from `createdAt`/`completedAt`.** A task that was completed, reopened and completed again only shows its last completion, because the model does not keep earlier ones. The activity log could provide them, but it is capped and only starts with request 2.
- **Cycle time** only counts tasks that are done and have `completedAt`. Tasks whose completion is before their creation (possible in imports) are skipped.

### Problems / friction
- The demo data is generated relative to the real "now", so a test seeded with a few tasks has no guaranteed due dates for a given member (see mistake 2).

### Mistakes
1. **Real bug: Escape stopped working after "Mark all as read".** The button became disabled while it had focus, so focus dropped to `<body>` and the panel's own key handler no longer received Escape. "Mark as read" on one item had the same problem, because its button unmounts. Found by the Playwright check "Escape closes panel, focus back on bell". Fixed by moving focus back to the panel after either action, and by listening for Escape at document level while the panel is open.
2. **Two broken tests on the first run:**
   - I passed the whole demo state instead of `.tasks` to `burndown()`. I hadn't run `tsc` on the new test file before `vitest`, which does not type-check.
   - The due-reminder store test seeded only 30 tasks, so `m1` had nothing due in the window. Now it seeds 300, with a comment explaining why.
3. **Regression caught by the request 1 suite:** adding "Export CSV" to the task list header made it 12px wider than a 375px screen, because that action row did not wrap. Fixed with a wrapping `headerActions` row that stretches its buttons on small screens. The regression suite found it, which is why I re-run all four suites every time.

### Verification
- `bun run lint`, `bunx tsc --noEmit`, `bun run test` (94 passed) and `bun run build` all pass.
- Production server on port 4002 with Playwright:
  - The request 4 suite: 31/31 checks, covering all four notification triggers, once-per-day de-duplication across reload, mark one/all, persistence, click-through, per-user inboxes, the no-current-user state, the reports (data checked against the stored state, project switch, tooltip) and the CSV (BOM, filename, row count across all pages, order, filters, quoting round trip).
  - Regression suites: request 1 37/37, request 2 46/46, request 3 37/37.
  - No console errors or warnings. Mobile screenshots checked. The server was stopped by its PID.

## Request 5: sub-projects and custom workflows (change request)

START: 2026-10-16T10:29:21Z
END: 2026-10-16T10:50:45Z

### Approach
- I renamed the field: `Task.status` became **`statusId`** (a status of the project's effective workflow) plus a derived **`category`** (`todo | in_progress | done`). I did not change the meaning of `status` in place, because `t.status === 'done'` would still have type-checked after a silent change of meaning. With the rename, `tsc` listed every place that depended on status (about 110 sites in lib, components and tests). Each one now reads `category` or resolves the workflow.
- All workflow and tree logic lives in `lib/workflow.ts`:
  - `effectiveWorkflow` / `workflowOwner`, i.e. inheritance;
  - `statusForCategory` and `reconcileTasks`, which map unknown statuses by category, sync the category, set or clear `completedAt`, and append the task to its new category column;
  - `validateWorkflow`: at least one status per category, unique non-empty names, hex colours;
  - `descendantIds`, `wouldCreateCycle`, `projectTree`, `projectPath`.
- **Reducer:** every task or project mutation ends in one `settle()` step: reconcile with the workflows, then enforce blockers (a blocked task never ends up done, even through a workflow edit), then spawn recurrences.
  - New actions: `task/setCategory` (mark done / reopen in the task's own workflow), `workflow/deleteStatus`, `project/update` with `parentId` / `workflow`, and `project/delete` with `children: 'lift' | 'delete'`.
  - `task/move` takes a `statusId`, and its index is within the category's ordering, so `order` stays one global ordering per category.
- **Migration:** the storage key is now `taskpilot:v2` and the state is saved tagged `schema: 2`.
  - On load: read v2, else read v1 and migrate it through `validateImport`, which accepts v1 `status` and missing `parentId`/`workflow`.
  - `category` is always derived from the workflow, never trusted from a file.
  - Imports refuse files from a newer schema; v1 and v2 imports both work.
  - The pre-paint theme script reads v2, falling back to v1.

### What was built (UI)
- **Projects page:**
  - The projects are shown as a tree: sub-projects are indented with a connector line, and task counts and progress include all descendants.
  - Projects can be created with a parent, and each card has a "Parent" select that leaves out the project itself and its descendants.
  - A delete dialog asks about sub-projects (move up one level / delete them too) as well as tasks.
  - Each project has a workflow section: inherited workflows are read-only with "Customize"; custom ones can add, rename (inline), recolour, recategorise, reorder (up/down) and delete statuses. Deleting a status opens a dialog to pick where its tasks move. "Use the parent's workflow" resets to inherited.
- **Board:** with a project selected, the columns are that project's workflow statuses (`data-testid="board-column-<statusId>"`); with "All projects" or "No project", the three category columns keep their original ids.
  - A task from a sub-project with a different workflow appears in the first column of its category, and moving it picks the matching status in its own workflow.
  - Drag and keyboard moves both work.
- **Project filter includes descendants everywhere:** task list (and CSV export), board, reports burndown and the dashboard's project bars (tree order, indented). The timeline groups in tree order with path names ("Website › Landing").
- **Everything else uses the category or the task's own workflow:**
  - Task form: status options come from the selected project's workflow and are remapped by category when the project changes.
  - List rows and the detail badge show the status name.
  - Mark done / reopen, bulk done, and the edit-dialog and detail-form completion guards.
  - KPIs, calendar, timeline, notifications (a blocker counts as "completed" when its category becomes done), reports, CSV (new `category` column; `status` is now the status name), and activity-log status names (resolved per project).
- **Tests:** 94 → 114 (`tests/workflow.test.ts`: tree, inheritance, reconcile, validation, descendant filters and rollups, all reducer paths, blockers vs. workflow edits, notifications with custom done statuses, v1 import, v2 round trip, newer-schema refusal, store migration). Existing tests updated to the new fields. The demo-data fingerprint still matches the original generator output, rebuilt in the v1 shape.

### Decisions / deviations
- **Order:** `order` is one ordering per category across all projects, as before. A project board's status columns show that ordering filtered to each status.
- **Category changes in a workflow edit:** changing a status's category (e.g. "Review" from in progress to done) moves its tasks to that category. Their `completedAt` is set, but no recurrence copies are created, because the tasks were not "marked done". Blocked tasks are kept out of done.
- **Moving sub-projects up keeps their workflow:** if a lifted sub-project inherited the deleted project's custom workflow, it gets a copy of it, so its tasks keep their statuses. A deliberate re-parent instead adopts the new parent's workflow (statuses mapped by category).
- **Unassigning tasks of a deleted project** moves them to the default workflow, mapped by category.
- **The v1 storage entry is kept** after migration as a backup; only v2 is written from then on.
- **CSV:** the `status` column changed from the category id to the status name, and a `category` column was added.
- **Board test ids:** the board keeps `board-column-todo/in_progress/done` for "All projects" and for any project whose workflow still has those ids (the default and freshly customised workflows). Custom statuses use their own ids.

### Problems / friction
- **Size:** the change touched almost every module. The rename turned it into a compiler-guided checklist instead of a grep hunt, and that was worth it.
- **Old browser scripts:** my four earlier Playwright suites read `localStorage['taskpilot:v1']` and `task.status`. I adapted them to v2/`category` and made their "legacy data" checks seed a real v1 payload under the v1 key, so they now exercise the migration in the browser.

### Mistakes
1. **Real regression, caught by a unit test before any UI work:** in my first reducer rewrite, refusing to complete a blocked task still returned a new state object. The safety-net revert produced new task objects, so the no-op would have pushed an empty undo step and activity diff. Found by "the reducer refuses every path to done" (`toBe(s)`). Fixed with an up-front check in `task/update` and `task/setCategory`, like `task/move`, keeping `enforceBlockers` only as the safety net for workflow and project edits.
2. **Junk in first drafts, caught on review before linting:**
   - a convoluted "was the move refused?" comparison in `task/move`, replaced by a plain pre-check;
   - an inline `import('@/lib/types').Task` type in `ProjectsView`;
   - a meaningless `{tasks.length ? '' : ''}` in `WorkflowEditor`.
3. **Real layout bug, found in the desktop screenshot:** my tree connector used `.child::before`, but project cards already use `::before` for the coloured top stripe. Sub-project cards lost their stripe and the connector was invisible. I moved it to `::after`, and it was still invisible because `.card { overflow: hidden }` comes later in the file with equal specificity and clipped it. I confirmed that by reading the computed style in the browser rather than guessing. Fixed with `.card.child { overflow: visible }` and a rounded stripe.
4. **Test bugs on the first run of the new suite:**
   - comparing `toEqual(base())`, where my fixture numbers task titles, so two calls never compare equal;
   - expecting a curly apostrophe where the code uses a straight one;
   - in the browser script, expecting 4 statuses after a redo that had legitimately left 3;
   - using `[role="alert"]`, which also matches Next's route announcer. The original build hit the same clash (DEVLOG item 14), and I repeated it.
5. **Planned, not a bug:** the request 4 CSV check failed because I changed the `status` column to hold the status name. I updated the check to read the new `category` column and listed the format change above.

### Verification
- `bun run lint`, `bunx tsc --noEmit`, `bun run test` (114 passed) and `bun run build` all pass.
- Production server on port 4002 with Playwright:
  - The new request 5 suite: 35/35 checks. It covers default board ids, schema v2 storage, sub-project creation and tree order, the cycle-free parent select, roll-up counts, descendant filters (list, board), re-parenting, customising a workflow (add / duplicate rejection / reorder / rename / last-done protection / inheritance), deleting a status with task re-targeting plus undo/redo, project-board columns and a keyboard move into a custom status, status names, mark done, category filter, KPI, export schema 2, import of a v1 file and of the v2 export, newer-schema rejection, project delete with lift (workflow kept) and with delete-all, undo, and mobile.
  - Regression suites, with their legacy checks now migrating real v1 data in the browser: request 1 37/37, request 2 46/46, request 3 37/37, request 4 31/31.
  - No console errors or warnings. The server was stopped by its PID.
