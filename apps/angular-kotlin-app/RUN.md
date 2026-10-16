# TaskPilot (Angular + Kotlin/JS) – build & run

## Prerequisites
- **bun** 1.4.x (package manager + script runner)
- **JDK 21** (for Gradle / the Kotlin compiler). Gradle itself comes via the wrapper in `core/`
  (`core/gradlew`, Gradle 8.14.3).
- **Node.js** for the SSR server (`start:prod`). Angular CLI 22 needs Node ≥ 22.22.3 for *building*;
  a pinned Node 24 is installed as a devDependency (npm package `node`) and `scripts/ng.sh` puts it on
  `PATH` for every Angular CLI call, so the system Node version does not matter for the build.

Maven Central is reached through Google's mirror (`core/settings.gradle.kts`).

## Commands
```bash
bun install                      # JS dependencies (also installs the pinned Node 24)
bun run build                    # Kotlin/JS library (Gradle) -> src/generated/core, then ng build (SSR)
PORT=3004 bun run start:prod     # serve the production build (Express + Angular SSR) on :3004
bun run lint                     # ktlint (Kotlin) + tsc --noEmit + angular-eslint (TS + templates)
bun run test                     # kotlin.test suite on Node (Mocha) via Gradle `jsTest`
bun run start                    # dev server (ng serve) after compiling the Kotlin library
```

Individual Kotlin tasks: `bun run core:build`, `bun run core:test`, `bun run core:lint`
(or `cd core && ./gradlew ktlintFormat` to auto-format).

## Layout
- `core/` – Kotlin Multiplatform project (`js` target, ES modules, `binaries.library()`,
  `generateTypeScriptDefinitions()`). All business logic: model, store + undo/redo, filtering/sorting/search,
  stats, chart geometry, calendar/date math, demo data, validation, import/export, pomodoro and shortcut
  state machines. Task `buildForAngular` syncs the compiled `.mjs` + `.d.mts` into `src/generated/core`
  (git-ignored), which the app imports as `@taskpilot/core` (tsconfig path).
- `src/app/core/` – thin Angular services wrapping the Kotlin store/timer in signals.
- `src/app/pages`, `layout`, `shared`, `charts` – standalone components (templates + binding code).

## Notes
- Data lives in `localStorage` under `taskpilot:v2` (schema 2). Older `taskpilot:v1` data is migrated on load
  and the old key removed; JSON exports carry `"schema": 2` and old exports (no schema field) still import. On the server the store is empty; data is loaded
  right after hydration, so SSR markup and the first client render match (no hydration mismatch).
- Older saved data (before team members / recurrence) loads with defaults: no members, tasks unassigned,
  recurrence `none`.
- Every task change is recorded in the activity log (`/activity`) by the "Current user" chosen in Settings;
  undo/redo restores the log together with the data.
- Saved views live in the same localStorage document; the board accepts the task-list query parameters
  (`/board?priority=urgent&assignee=m1`), which is how "open view on board" works.
- Notifications are stored per member in the same document; the bell shows those of the "Current user".
- `?seed=N` on any route replaces all data with `generateDemoData(N)` and removes the param.
- Allowed SSR hosts are `localhost`, `127.0.0.1` and `[::1]` (`angular.json` → `security.allowedHosts`).
