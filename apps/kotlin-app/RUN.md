# TaskPilot – Kotlin (Compose HTML + Ktor)

Kotlin-only implementation of the TaskPilot spec:

| Module    | What it is                                                                                   |
|-----------|----------------------------------------------------------------------------------------------|
| `shared/` | Kotlin Multiplatform (JVM + JS) pure logic: model, demo-data generator, filters/sort/search, stats, validation, import/export, undo history, board moves, calendar grid. Unit tests (kotlin.test) run on JVM **and** Node. |
| `web/`    | Kotlin/JS browser app written with Compose HTML (`org.jetbrains.compose.html:html-core` + `html-svg`). Own History-API router, state in Compose `mutableStateOf`, plain CSS (`web/src/jsMain/resources/styles.css`). |
| `server/` | Ktor (CIO) server that serves the production web bundle from its classpath, with SPA fallback for deep links (`/tasks/abc` → `index.html`), gzip and ETags. |

## Requirements

- JDK 21 (Gradle toolchain), network access to Maven Central (or the Google mirror configured in `settings.gradle.kts`) and the npm registry (Kotlin/JS downloads webpack/mocha).
- [bun](https://bun.sh) to run the `package.json` scripts (they just call the Gradle wrapper).

## Commands

```bash
bun run build                 # ./gradlew :server:installDist  (builds the JS bundle, embeds it in the server)
PORT=3005 bun run start:prod  # serves the production build on :3005 (default port 8080, HOST default 0.0.0.0)
bun run lint                  # ktlint (via org.jlleitschuh.gradle.ktlint) on all Kotlin sources + build scripts
bun run lint:fix              # ktlint auto-format
bun run test                  # shared logic tests on JVM + Node, plus Ktor server tests
```

Without bun, use the Gradle wrapper directly, e.g. `./gradlew :server:installDist` and
`PORT=3005 ./server/build/install/server/bin/server`.

Build outputs:

- `web/build/dist/js/productionExecutable/` – static bundle (`index.html`, `app.js`, `styles.css`, `favicon.svg`)
- `server/build/install/server/` – runnable server distribution (start script + jars, bundle embedded under `/static`)

## Notes

- Data persists in `localStorage` under `taskpilot:v2` (schema 2: sub-projects + workflows). Data found under the old
  `taskpilot:v1` key is migrated on first load (the v1 entry is left as a backup). First visit seeds 300 demo tasks.
  `?seed=N` on any route replaces the data with `generateDemoData(N)` and strips the parameter.
- A tiny inline script in `index.html` applies the persisted theme before first paint (no theme flash);
  everything else is Kotlin.
- Compose Multiplatform is pinned to **1.7.3**: newer releases (1.8+) depend on `androidx.*` artifacts that
  only exist on Google's Maven (`dl.google.com`), which is not reachable from this sandbox.
