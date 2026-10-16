# DEVLOG

START: 2026-10-16T10:17:47Z

## Stack

- Kotlin 2.2.20 everywhere, Gradle 8.14.3 wrapper, version catalog.
- `shared` – Kotlin Multiplatform (JVM + JS) pure logic + kotlinx-serialization. Tests: kotlin.test on JVM and Node (mocha).
- `web` – Kotlin/JS IR + Compose HTML 1.7.3 (`html-core`, `html-svg`) + Compose runtime + kotlinx-coroutines. Plain CSS file.
- `server` – Ktor 3.3.3 (CIO, Compression, ConditionalHeaders, CachingHeaders, AutoHeadResponse).
- Lint: ktlint 1.7.1 via `org.jlleitschuh.gradle.ktlint` 13.1.0 (`ktlint_official` style, Composable function naming allowed).
- `package.json` scripts call `./gradlew`; run them with bun.

## What went smoothly

- Kotlin 2.2.20 plugin, kotlinx-serialization and Ktor resolved from the Google Maven Central mirror on the first try.
- Sharing the pure logic as a KMP module worked well: the same 29 tests run on the JVM (fast) and on Node.
  The mulberry32 port matched the JS reference on the first try: Kotlin `Int` arithmetic wraps exactly like `| 0` / `Math.imul`.
- Compose HTML's model (state in `mutableStateOf`, recomposition) handled 1000 board cards without trouble
  (the board with `?seed=1000` renders in about 1.9 s, including navigation, in headless Chromium).
- Native HTML5 DnD through `onDragStart/onDragOver/onDrop` on Compose HTML elements worked fine with Playwright's `dragTo`.
- Ktor made SPA fallback and gzip easy. Serving the bundle from the classpath keeps the server self-contained.
- Playwright: every route loaded with zero console errors or warnings. All key flows passed: create, validation, search,
  global search, pagination and back button, filters, shortcuts, DnD, keyboard moves, undo/redo, toast undo,
  focus trap/restore, import/export, reset, projects CRUD, calendar, `?seed=1000`, theme persistence, no-flash check, and 375px layouts.

## Friction / problems

- **Compose Multiplatform vs. this sandbox:** CMP 1.8+ (and 1.10.x) publish their JS runtime as thin
  `org.jetbrains.compose.*` artifacts that depend on `androidx.*` artifacts, which are only on Google Maven
  (`dl.google.com`, blocked here, and the JetBrains Space mirrors are blocked too). I read the `.module` metadata
  to find the newest release that resolves entirely from Maven Central: **1.7.3**. It works with Kotlin 2.2.20's
  compose compiler plugin without problems, but it is older than "latest".
- Compose HTML API gaps and quirks: no `Kbd`, `Strong` or `Time` elements (I used `TagElement("kbd")` and `B`).
  There is no controlled `<select>`, so I wrote a `SelectField` that syncs the DOM value in a `SideEffect`.
  There is no `prop()` helper. Some classes live in unexpected packages in 1.7.3 (`androidx.compose.web.events.SyntheticDragEvent`,
  `androidx.compose.web.attributes.SelectAttrsScope`). SVG needs the separate `html-svg` artifact and an opt-in annotation.
- Kotlin/JS testing: a `browser()` target makes `allTests` try Karma + ChromeHeadless (no `CHROME_BIN`). I switched
  the shared module's JS tests to `nodejs()`. Adding a target changes the npm lock file, which then needs `kotlinUpgradePackageLock`.
- Bundle size: the production `app.js` is about 1.04 MB minified (about 295 KB gzipped). It includes the Compose runtime,
  coroutines and kotlinx-serialization, which is heavy compared with typical JS frameworks.
- Recomposition is async (next animation frame). Playwright assertions made right after a click sometimes saw stale DOM,
  so I added short waits.
- The Ktor server logs SLF4J "no providers" warnings at startup. I did not add a logging backend (logback) because it is
  outside the allowed dependency list.

## Deviations / decisions

- Undo history (50 steps) covers task and project mutations, including pomodoro time logging. It is in-memory only, so it is lost on reload.
  Settings changes and bulk data replacement (seed, import, reset) are not undoable. Data replacement clears the history.
- "This week" due filter = Monday–Sunday of the current week. Upcoming deadlines = open tasks due today through today+7.
- Demo data: `createdAt = now − k days` (keeps the time of day), `completedAt = createdAt + j days`, capped at now.
  Ids are deterministic (`task-N`, `proj-N`). Column `order` is assigned per status in generation order.
- Theme toggle in the top bar flips light/dark. "System" is available in Settings.
- Extra shortcuts `g p` (projects) and `g s` (settings).

## Mistakes I made

1. **Assumed the latest Compose Multiplatform would resolve from Maven Central.** The first build failed on
   `androidx.compose.runtime:runtime` (403 from dl.google.com). Next I guessed 1.8.2, which failed on `androidx.annotation`
   and `androidx.collection`. Fix: I inspected the published `.module` files for 1.6–1.9 and pinned 1.7.3.
2. **Wrong unit-test expectation:** I asserted that the June 2024 Monday-first grid ends on 2024-07-07, but June 30, 2024 is a Sunday.
   The failing JVM test showed this, and I corrected the expectation to 06-30.
3. **Used a JVM-only API (`toSortedSet`) in common code.** The JS compilation failed; I replaced it with `distinct().sorted()`.
4. **Guessed Compose HTML imports and element names wrong:** `SelectAttrsScope` and `SyntheticDragEvent` packages,
   plus non-existent `Kbd`/`Strong` elements. Also, my `TaskForm` parameter `onSubmit` shadowed the form's
   `onSubmit` event extension, and a fully-qualified `org.jetbrains.compose.web.svg.Circle(...)` resolved to a private
   builder `val`. The compiler errors showed all of these. I fixed them by reading the 1.7.3 sources jar, adding the right imports
   and renaming the parameter to `onSave`.
5. **Forgot `minimumSize` needs an explicit import** in Ktor's Compression config. The compile error showed it.
6. **Karma/ChromeHeadless failure** when running `allTests` with a JS `browser()` target, followed by a `kotlinStorePackageLock`
   failure after adding `nodejs()`. I disabled the browser test task and ran `kotlinUpgradePackageLock`.
7. **CSS class collision:** I used `col-done` both for the narrow table checkbox column (`width: 40px`) and the board's
   "Done" column, which squeezed the Done column to 40px. Found it in a Playwright screenshot and renamed the board classes to `column-*`.
8. **CSS specificity/order bugs:** the generic `input[type=search]` rule came later and reset the search inputs' left padding,
   so the icon overlapped the placeholder. `.icon-btn { display: inline-grid }` overrode `.menu-btn { display: none }`, so the
   hamburger and drawer-close buttons showed on desktop. The `.cal-task` border shorthand wiped the priority accent colours.
   All found in screenshots and fixed with more specific selectors.
9. **ktlint violations** (lines over 140 chars in an icon path and a data class, chain-wrapping in the server). I simplified the
   settings icon and ran `ktlintFormat`.
10. **Stale edit after auto-format:** a scripted string replacement in `Server.kt` silently did not apply because
    `ktlintFormat` had re-wrapped the code. I noticed it via grep and redid it with an exact edit.
11. **Flawed Playwright assertions** (my test script, not the app): I counted validation errors before recomposition and tested
    Ctrl+Z after a full page reload (undo history is in-memory). I also clicked a visually hidden radio input and reused a project id
    that an earlier step had deleted. I fixed the script (waits, in-app navigation, clicking the label, a different id). The app code was correct.
12. Ran a stray `sed` against `/dev/null` (harmless error) while editing the check script.
13. Killing the `bun run start:prod` PID also stopped the Java child, which I hadn't anticipated. After that I ran the server's start
    script directly for my own checks, so the PID I stop is the Java process.

END: 2026-10-16T10:56:40Z
