# DEVLOG – angular-kotlin-app

START: 2026-10-16T10:17:48Z

## Stack
- Angular 22.2 (CLI 22.2.3, `ng new --ssr`, standalone components, signals, zoneless, hydration + event replay),
  Express SSR server, angular-eslint 22.6.
- Kotlin 2.2.20 Multiplatform, `js(IR)` target, ES modules, `binaries.library()`, `generateTypeScriptDefinitions()`,
  ktlint (jlleitschuh plugin 13.1.0, ktlint 1.7.1), kotlin.test on Node/Mocha. No other Kotlin libraries
  (no kotlinx-serialization: JSON goes through the JS `JSON` object from Kotlin, schema validation is hand-written).
- bun 1.4.2 as package manager / script runner.

## Split
- Kotlin (`core/src/jsMain`, ~2.5k lines): data model, store with undo/redo (depth 50) and persistence
  (through injected load/save callbacks), filter/sort/search/pagination + URL query (de)serialization,
  dashboard KPIs/streak, chart geometry (line/area paths, axis ticks, donut arcs, hover hit-testing),
  calendar month grid + all date math (civil-day algorithms, no date lib), demo-data generator (mulberry32),
  task/project validation, JSON import schema validation + export, pomodoro state machine, keyboard
  shortcut/sequence interpreter, theme resolution.
- TypeScript: component classes binding Kotlin state/actions to templates, an Angular `StoreService`
  that wraps the Kotlin `TaskStore` in signals, small UI services (dialogs/toasts, timer interval, theme DOM
  application, keydown listener), DOM-only bits (HTML5 DnD event plumbing, focus trap, file download/upload).
- Tests: 40 kotlin.test tests (`bun run test`).

## What went smoothly
- Kotlin/JS → ES module library + `.d.mts` worked on the first Gradle run; Node + Mocha test runner via
  KGP (with `kotlin.js.yarn=false`, i.e. npm) downloaded fine through the proxy.
- `@JsExport` classes map nicely onto Angular templates (Kotlin `val`s become getters, `Array<T>` is a
  plain JS array, so `@for` works directly). Immutable Kotlin state + one `signal` per store version made
  change detection trivial.
- Signals + SSR: rendering an empty "not ready" state on the server and loading localStorage in
  `afterNextRender` gave zero hydration warnings without any special casing.
- Most of the 40 Kotlin tests passed on the first run; the Playwright flows (DnD, keyboard moves,
  seed, search, undo/redo, import errors) all passed against the production build.

## Friction / problems
- **Angular CLI 22 requires Node ≥ 22.22.3**, sandbox has 22.22.0. `bunx --bun` (Bun posing as Node 26)
  works for `ng new`, but `ng build` then fails during SSR route extraction (`Cannot find package 'memory:'`
  – Bun lacks Node's ESM loader hooks). Fix: pin Node 24 as the npm devDependency `node` (binary from the npm
  registry, needs `trustedDependencies`) and run the CLI through `scripts/ng.sh`, which puts it on PATH.
  Bun did not link `node_modules/.bin/node`, hence the wrapper instead of relying on `.bin`.
- `ng add angular-eslint` under bun: first run failed with "Collection cannot be resolved" (package was
  installed but schematic not found in the same run); re-running succeeded.
- A package.json script named `ng` that calls `bun --bun ng` recursively calls itself (bun resolves scripts
  before binaries) → E2BIG crash. Removed/renamed.
- Kotlin/JS TypeScript definitions: `object`s are `X.getInstance()`, top-level `val`s are `{ get() }`, and
  companions are typed as abstract classes although the runtime value is the instance – needed a typed cast
  helper in `kt.ts`. TS path mapping to the `.mjs` file did not pick up the sibling `.d.mts`; pointing the
  path at the directory (with the Kotlin-generated `package.json` having `"types"`) fixed it.
- KGP task names changed (`jsNodeProductionLibraryDistribution`, not `jsProductionLibraryDistribution`).
- ktlint picked up the Angular `.editorconfig` (indent 2) for `.kts` files → added a `root=true`
  `.editorconfig` in `core/`.
- Angular SSR's new host allow-list (`security.allowedHosts: []`) rejects `localhost` by default (400) →
  configured localhost/127.0.0.1/[::1].
- The Kotlin stdlib adds ~190 kB raw to the initial bundle, so the 500 kB budget warning fired; raised the
  warning threshold to 650 kB (78 kB transfer for main).
- TS 6 deprecates `baseUrl`; paths work without it.
- Chrome logs "Failed to load resource: 404" for the 404 route because the server correctly answers
  with HTTP 404 – this is the only console message across all routes; no app errors or hydration warnings.

## Mistakes I made
1. Assumed `ng build` would run fine under `bun --bun` because `ng new` did → route extraction crashed;
   found in the first build, fixed with the pinned Node 24 + `scripts/ng.sh`.
2. Created a `"ng": "bun --bun ng"` script → infinite recursion (E2BIG). Found on first `bun run build`;
   removed the script, later re-added `ng` pointing to the wrapper.
3. Used the wrong Gradle task name for the library distribution → "task not found"; listed tasks and fixed.
4. Wrong expectation in a pomodoro unit test (expected 1 credited minute, correct is 2: 4.5 min rounds to 5,
   minus 3 already credited). Found by the failing test, fixed the test.
5. tsconfig path pointed at `taskpilot-core.mjs` → typings not found (implicit any errors); fixed by pointing
   at the directory and syncing the generated `package.json`.
6. Called `Companion.getInstance()` based on the `object` pattern; companions don't have it → build error;
   fixed with a typed cast of `X.Companion`.
7. Used `[maxlength]` binding (not a DOM property in Angular's schema) → NG8002; switched to `[attr.maxlength]`.
8. Used `new Set()` inside a template → replaced with a component method.
9. The theme toggle first cycled light → dark → system; from "system" (resolving to light) the first click
   went to "light", i.e. no visible change. Caught by the Playwright check; changed the Kotlin logic to
   toggle against the *resolved* theme (system stays selectable in Settings) and added a test.
10. `?seed=N` removal used `router.navigate([], …)` without `relativeTo`, which navigated to `/` → redirected
   to `/dashboard` (only noticed when seeding on `/tasks`). Then tried `router.url`, which is still "/" in
   `afterNextRender` before the initial navigation finishes. Fixed by deriving the URL from `window.location`.
11. Line chart: last x-axis label overlapped the previous one and y ticks were uneven (2, 5, 7); fixed in
   Kotlin (ticks anchored on the last day, "nice" step-based y ticks) and extended the test.
12. Calendar task chips overflowed their cells on 375 px (grid items with `min-width: auto`); fixed with a
   `minmax(0, 1fr)` column. Form fields stretched vertically in the edit grid; fixed with `align-content: start`.
13. Several of my own Playwright assertions checked `isVisible()` immediately after a click (zoneless
   rendering is async) and failed spuriously; switched those to `waitFor`.

END: 2026-10-16T10:53:35Z
