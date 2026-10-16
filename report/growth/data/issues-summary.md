# Maintenance-log issues, classified (requests 1-5)

Source: `apps/*/ISSUES.md`, sections "Mistakes" and "Problems / friction". Per-entry data: `issues-classified.json`.

Counting rules:
- Every bullet in both sections is one entry. Sub-bullets that describe separate problems (for example three distinct e2e script bugs under one heading) are split into separate entries.
- Nuxt request 4's friction line "None with tooling this time" reports no problem and is skipped.
- Some friction bullets are design decisions, not problems (Angular has many of these). They are still classified, into the closest category, and flagged `"design_note": true`. Those about app behaviour went to `app_bug` (with `found_by: self_review`), those about data-model structure went to `regression_from_data_model`, and those about CSS or framework layout technique went to `framework_gotcha`.
- Leftover or junk code with no effect on behaviour (unused methods, pointless re-exports, no-ops) counts as `compile_lint`. Junk code that would change behaviour or performance counts as `app_bug`.
- When a defect was visible to users but the log puts the blame on the framework (Angular template whitespace, Vue hook registration, Angular not re-rendering an unchanged state), it is classified as `framework_gotcha`.
- Three friction bullets repeat a bug that is also listed under Mistakes: nuxt R3 (slow drag), angular-kotlin R5 (board grid wrap) and kotlin R4 (recurring copy notified). Each is counted twice, once in each section.

## Counts per app per category (requests 1-5)

| app | app_bug | test_bug | compile_lint | tooling_env | framework_gotcha | regression_from_data_model | total | of which design notes |
|---|---|---|---|---|---|---|---|---|
| nuxt | 11 | 9 | 5 | 3 | 2 | 5 | 35 | 1 |
| next | 13 | 11 | 6 | 5 | 5 | 4 | 44 | 1 |
| angular | 26 | 11 | 9 | 1 | 3 | 5 | 55 | 18 |
| angular-kotlin | 14 | 9 | 5 | 1 | 8 | 3 | 40 | 4 |
| kotlin | 14 | 8 | 3 | 3 | 9 | 5 | 42 | 4 |
| **all** | **78** | **48** | **28** | **13** | **27** | **22** | **216** | **28** |

## app_bug per app per request

The first number is all `app_bug` entries. The number in brackets leaves out design notes, so it counts only real defects.

| app | R1 | R2 | R3 | R4 | R5 | total | pre-existing | found by (real defects) |
|---|---|---|---|---|---|---|---|---|
| nuxt | 1 (1) | 1 (1) | 4 (4) | 2 (2) | 3 (3) | 11 (11) | 0 | screenshot 6, e2e 3, self_review 2 |
| next | 3 (3) | 2 (2) | 4 (4) | 2 (2) | 2 (2) | 13 (13) | 0 | screenshot 5, self_review 4, e2e 3, unit_test 1 |
| angular | 6 (3) | 4 (1) | 4 (1) | 8 (5) | 4 (3) | 26 (13) | 3 | e2e 8, screenshot 4, self_review 1 |
| angular-kotlin | 3 (3) | 1 (1) | 3 (2) | 3 (2) | 4 (4) | 14 (12) | 0 | screenshot 4, e2e 3, self_review 3, unit_test 2 |
| kotlin | 2 (2) | 4 (3) | 3 (2) | 2 (2) | 3 (3) | 14 (12) | 0 | screenshot 6, self_review 3, e2e 2, unit_test 1 |

No `app_bug` was found by `lint`. The only pre-existing bugs are three in Angular request 4: settings lost when the page reloads within the 150 ms save debounce, `sr-only` chart tables overflowing on mobile, and line-chart axis text stretched by `preserveAspectRatio="none"`.

## Per-app characteristics

**Nuxt (Vue).** The most frequent problem was test fixtures written by hand: the store tests build `AppState` literals, so adding `blockedBy`/`comments`, then `views`, then `notifications`, then `statusId` broke them in requests 2, 3, 4 and 5. In request 4 the log calls it "the same fixture mistake… again". App bugs were mostly visual: awkward activity sentences, a wrapped workload value, a board overflowing with four statuses, a cramped workflow editor on mobile. The one performance bug (drag re-rendering ~850 rows at ~130 ms per frame) was found by timing the drag in the e2e script. Vue-specific surprises were small: `onBeforeUnmount` registered inside `onMounted`, and router URL changes landing before the re-render.

**Next (React).** It has the most e2e and unit-test script mistakes (11), several of them repeated: CSS uppercase vs `innerText`, avatar initials at the start of `innerText`, `[role="alert"]` matching Next's route announcer "again", and the `no-unused-vars` placeholder lint warning in requests 1 and 2. First drafts often contained junk code that self-review caught: a nonsensical drop-date expression, stray exports, a meaningless ternary. CSS layering caused real layout bugs: `content-visibility` stacking contexts put arrows over sticky labels, sticky positioning failed inside `overflow:hidden`, and a `::before` clash with `overflow:hidden` hid the sub-project connector. The two subtle runtime bugs were the mention caret race on fast typing and Escape dying after focus fell to `<body>`.

**Angular.** Its log is the longest and contains the most friction bullets that are design notes (18): undo semantics, who gets notified, `statusId` vs `status` precedence. Without those it has 13 real app bugs. It is the only app where e2e found most of the defects (8). It is also the only app with pre-existing bugs, all three found in request 4. Several problems were layout or interaction bugs that only e2e probes exposed: an off-screen notification panel, sr-only table overflow, a hard-coded 3-column board grid, a fragile drop into an empty column, focus lost when a timeline bar re-sorts. Angular template whitespace caused two framework surprises (doubled spaces around mentions, missing spaces between spans), and scripted edits failed three times (a stray `</div>`, a Prettier mismatch, a Python quoting error).

**Angular-Kotlin.** It has the second-highest number of framework gotchas (8), almost all Kotlin/JS differences from the JVM: there is no `RegexOption.DOT_MATCHES_ALL`, `2.0.toString()` prints `"2"`, `kotlin.math.pow` is an extension, and a naming clash with `Math`. Gradle output hid compiler errors from `grep "^e:"`. Unit tests in Kotlin caught real logic bugs (non-canonical `activeView` matching, source-column renumbering), and self-review caught an O(n²) blocker cleanup. Test-script mistakes were mostly timing (synchronous DOM reads, `nth(5)` during a re-render, which was misdiagnosed for about 10 minutes) and substring title matches.

**Kotlin (Compose HTML + Ktor).** It has the most framework gotchas (9), from Compose HTML gaps and naming: no SVG text helpers, no pointer-event listeners, `svg.Title` resolving to a private builder, a manual element ref and `setTimeout` for the caret. Kotlin semantics added more: `copy()` leaves a default-derived `statusId` stale, and an unqualified call could recurse. Environment slips repeated: the wrong relative path to `styles.css` happened three times before the developer switched to absolute paths. Scripted edits broke code three times: an extra brace, a deleted `updateProject`, and a stale patch after `ktlintFormat`. App bugs were mostly found in screenshots (6 of 12): a misleading bulk toast, a "deleted task" label in the log, truncated group labels, "1 tasks".

## Problems that recur across apps (AI habits, not framework issues)

- **Substring title matching in e2e scripts** ("Test landing page #1" also matches #10-#199). Seen in nuxt R1, next R1, angular R1, angular-kotlin R2 and kotlin R1/R2: 5 of 5 apps.
- **Wrong expectations in the developer's own unit tests while the code was right.** The same WCAG contrast error on `#a855f7` appears in nuxt R1 and angular R1. Off-by-one date or count reasoning appears in nuxt R4, angular R4, kotlin R3 and kotlin R4. A reversed cycle path appears in kotlin R2. Wrong workflow-order expectations appear in angular R5 and angular-kotlin R5. All 5 apps.
- **Fixtures and literals breaking whenever the data model grows,** with no shared fixture factory added. Seen in nuxt R2-R5, next R2/R3 (where the log notes "third request in a row"), angular R5, angular-kotlin R1/R5 and kotlin R1/R5. In request 5 all five apps had to repoint old browser scripts from `taskpilot:v1` to v2.
- **Escape stopping working after focus falls to `<body>`** when a "Mark all as read" or "mark read" button is disabled or unmounts. The same bug appears in next R4, angular R4 and angular-kotlin R4.
- **Notification panel anchored to the bell sticks out off-screen on phones:** angular R4 (x = -82px) and angular-kotlin R4 (86px).
- **Board with a hard-coded 3-column grid breaks when custom workflows add statuses:** nuxt R5, angular R5 and angular-kotlin R5.
- **The timeline label-column width is hard-coded in two places and drifts on mobile:** next R3, angular-kotlin R3, and the kotlin R3 design note. The same `--label-w` CSS-variable fix was used in each.
- **Reading SVG text with `innerText`, or reading the DOM before the re-render finishes:** angular R1, angular-kotlin R1/R3, next R2 and nuxt R2.
- **Avatar initials at the start of `innerText` break a `startsWith(name)` assertion:** next R2 and angular R2.
- **Scripted Python or sed edits that corrupt code or patch stale text** (after Prettier or ktlint reformatting): nuxt R1, angular R2/R5 and kotlin R4/R5.
- **Leftover junk or unused code in first drafts, caught on review or by lint:** next R1/R2/R3/R5, angular R1/R3/R4, nuxt R5 and angular-kotlin R5.
- **Process and environment handling:** the Chromium symlink path (nuxt and next) and a PID still listed right after `kill` (next and angular).
- **Confusing generated wording, especially cycle-error messages:** next R2 and angular R2. Nuxt R2 had awkward activity sentences.
