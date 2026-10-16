# DEVLOG – Angular

START: 2026-10-15T21:10:23Z

## Log
- 21:10 Node friction: system Node is v22.22.0 but Angular CLI 22.2.3 (latest) requires >=22.22.3. Installed `node@24` from npm into /tmp to run `ng new`, then added `node@24` as a devDependency so the app's scripts run on Node 24.22.0.
- 21:12 Coordinator switched package manager to **bun 1.4.2**. Deleted node_modules + package-lock.json, `bun install` -> bun.lock, angular.json `cli.packageManager: "bun"`.
  - Friction: bun blocks lifecycle scripts by default (esbuild, lmdb, msgpackr-extract, @parcel/watcher, node) -> listed in `trustedDependencies`.
  - Friction: bun does not link a `node` bin into node_modules/.bin (npm did), so the PATH-shadowing trick failed. Scripts now call `node_modules/node/bin/node node_modules/@angular/cli/bin/ng.js` explicitly via an `ng` script; all other scripts are `bun run ng ...`. `bun run` itself works fine as the script runner.
- 21:15–21:28 Wrote the framework-agnostic core (`src/app/core`: models, dates, demo-data, filters, stats, validation, history, task-ops), the services (signals) and all pages/components. Hand-built SVG charts, native HTML5 DnD, a focus-trapping modal, toasts and a Pomodoro timer.
- 21:29 The first `ng build` passed with strict TS + strictTemplates. Lint had 1 error (`no-useless-assignment`).
- 21:30 Wrote 24 unit tests, which passed on the first run (Vitest via `ng test`, jsdom, no browser needed). Later added TestBed tests for StoreService/ToastService/TaskForm, for 31 in total.
- 21:31–21:37 Ran Playwright (global install + /opt/pw-browsers, scripts in the scratchpad) against the prod server on :3003 and fixed the bugs listed below.

## What went smoothly
- Angular 22 defaults fit this spec well: standalone, zoneless, signals, `@if/@for`, `input()/output()`, `linkedSignal`, `withComponentInputBinding`. The SSR scaffold (`--ssr`) worked out of the box.
- No hydration warnings. The pattern that worked: a `ready` signal that is false on the server and during hydration, and storage loaded in `afterNextRender`. Calendar/dashboard content depends on the clock, so it is also gated behind `ready` to avoid structural mismatches.
- `ServerRoute` config gives a real 302 for `/` and a real 404 status for unknown routes with almost no code.
- The Vitest-based `ng test` is fast (~2 s) and needs no browser.

## Friction
- The Node engine requirement of the latest CLI (>=22.22.3) blocked `ng new` on this machine's Node 22.22.0. Worked around it with the `node@24` npm package.
- bun: lifecycle scripts are blocked by default, and bun does not link the `node` bin, so scripts call the bundled Node explicitly (details above).
- `@angular/ssr` host allowlist: the production server answers **400 "Header host ... is not allowed"** until `security.allowedHosts` is configured. This is new in recent versions and was not obvious.
- Zoneless change detection is async. In Playwright, a `count()` right after a click can see stale DOM, so the scripts need small waits (this was a test-script issue, not an app bug).
- The default `anyComponentStyle` budget (4 kB warning) is tight for a real component. Raised it to 10/16 kB.
- No CDK allowed, so focus trapping, DnD and overlays are hand-built. They are not hard, but they are boilerplate the CDK would normally provide.

## Mistakes I made
1. **Assumed the system Node could run the latest Angular CLI.** Found: `ng new` aborted with the engine error. Fix: installed `node@24` from npm and ran the CLI with it.
2. **Assumed bun would link the `node` bin into node_modules/.bin the way npm does** (PATH-shadowing trick). Found: `ls node_modules/.bin/node` failed after `bun install`. Fix: scripts call `node_modules/node/bin/node` explicitly and added `trustedDependencies`.
3. **Ran `pkill -f "server/server.mjs"` inside a compound shell command.** It matched and killed my own shell (exit 144), so the `allowedHosts` edit in the same command never ran. Found: the next `grep` still showed `allowedHosts: []`. Fix: re-applied the edit and kill the server by PID via `ps | awk`.
4. **Did not anticipate the SSR host allowlist.** Found: curl returned 400 "Header host is not allowed". Fix: added localhost/127.0.0.1/[::1]/0.0.0.0 to `security.allowedHosts`.
5. **`?seed` stripping bug (two attempts).** First, `router.navigate([], {queryParams})` without `relativeTo` resolved against the root, so `/tasks?seed=1000` ended up on `/dashboard`. Second, after switching to `parseUrl(router.url)`, it still redirected because `router.url` is still `/` inside `afterNextRender` before the initial navigation finishes. Found: Playwright printed `after seed url .../dashboard`. Fix: strip the param after the first `NavigationEnd`.
6. **Top bar overflowed at 375px (scrollWidth 410).** The search flex item had no `min-width: 0`. Found: the Playwright scrollWidth check, then an element-bounds script. Fix: `min-width: 0` on `.search`.
7. **Mobile task cards: the actions column wrapped onto a third line** when a row had many tags. Found: 375px screenshot. Fix: absolutely positioned the actions in the card, with padding on the title cell.
8. **Donut chart first rotated the whole SVG with CSS and counter-rotated the text.** This was fragile, so I rewrote it to use an SVG `rotate()` group before shipping.
9. **First version of TaskForm reset unsaved edits whenever the task object changed** (e.g. a subtask toggle or Pomodoro time on the detail page), because `linkedSignal` depended on the whole task. Found while reviewing the detail-page design. Fix: the linked source is a computed of the editable fields only, with a JSON equality check.
10. **Pomodoro ring showed a stray dot at 0% progress** (round line cap). Found: screenshot. Fix: render the progress arc only when progress > 0.
11. **Board "done" cards showed "20d overdue" due labels.** Found: screenshot. Fix: show a plain date for done tasks.
12. **Line-chart y-axis produced non-integer-spaced ticks (0,3,5,8,10).** Found: dark-mode screenshot. Fix: "nice" integer step scale.
13. **KPI grid wrapped 5+1 on desktop.** Found: screenshot. Fix: an explicit 6/3/2-column grid.
14. **Test-script mistakes:** an ambiguous `getByRole('button', {name: /Mark done/})` matched 25 row toggles, and counts were read before zoneless CD flushed. Found: Playwright strict-mode error and stale counts. Fix: scoped the locator to `.bulk-bar` and added short waits.
15. **lint `no-useless-assignment`** on `let loaded: AppState | null = null`. Fix: removed the initializer.

## Deviations / notes
- The 404 page returns HTTP 404, and Chrome logs "Failed to load resource: 404" for the document. That is the only console line in all runs. It comes from the browser's network log, not from the app.
- Settings changes (theme/page size/pomodoro) are deliberately not part of undo history ("task & project mutations" only). Import/reset clear the history.
- Pomodoro time is committed in whole minutes. Sub-minute remainders carry over per task in memory.

END: 2026-10-15T21:38:24Z
