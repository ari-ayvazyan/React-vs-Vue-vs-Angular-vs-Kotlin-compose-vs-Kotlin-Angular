# TaskPilot – Angular

Angular 22.2 (standalone components, signals, zoneless), SSR + hydration via `@angular/ssr` (Express).
Package manager / script runner: **bun 1.4.2**.

## Node requirement
Angular CLI 22 requires Node >= 22.22.3 (the machine has 22.22.0). The `node@24` npm package is a
devDependency, and every script runs the CLI and the server with `node_modules/node/bin/node` (Node 24.22).
You do not need to install anything else.

## Commands
```bash
bun install                      # installs deps (+ the bundled Node 24 binary; see trustedDependencies)
bun run build                    # production build (browser + server bundles), also type-checks (strict TS + strictTemplates)
PORT=3003 bun run start:prod     # serves dist/angular-app/server/server.mjs at http://localhost:3003
bun run lint                     # angular-eslint (TS + template + template a11y rules)
bun run test                     # Vitest via `ng test --watch=false` (jsdom, headless, 112 tests)
bun run start                    # dev server (ng serve) on :4200
```

The SSR server only accepts the hosts `localhost`, `127.0.0.1`, `[::1]` and `0.0.0.0`
(`security.allowedHosts` in angular.json). Add yours there or set `NG_ALLOWED_HOSTS`.

## Notes
- Data lives in `localStorage` (`taskpilot:v2`, schema version 2; `taskpilot:v1` is migrated on load and kept as a backup). The server renders the shell plus skeletons. The client
  loads storage after hydration (`afterNextRender`), so server and client HTML match.
- `?seed=N` on any route replaces the data with `generateDemoData(N)`. The param is then removed.
- Unknown routes render the 404 page with HTTP status 404. Chrome logs this as "Failed to load resource" for the document.
- Data saved before team members existed still loads: a missing `members` array becomes `[]`, and tasks without
  `assigneeId`/`recurrence` get `null`/`'none'` (see `validateAppState`). The storage key is unchanged.
- Recurring tasks: whenever a mutation moves a recurring task to `done` (list toggle, bulk action, board drag or
  keys, form), `StoreService.mutate` adds the next occurrence in the same undo step (`core/recurrence.ts`).
- Dependencies, comments and the activity log (`core/dependencies.ts`, `core/mentions.ts`, `core/activity.ts`):
  completion of blocked tasks is refused in `StoreService` (`setStatus`, `moveOnBoard`, `updateTask`). The
  activity log is part of the undo snapshot and is appended inside `mutate`, so undo/redo keep it consistent.
- Saved views live in `AppState.views` (undoable like projects) as list query params; the board applies the
  subset that makes sense there (`core/views.ts`). `/timeline` is virtualised (`core/timeline.ts`): only rows
  near the viewport are rendered, so `?seed=1000` stays smooth.
- Notifications (`core/notifications.ts`) are persisted in `AppState.notifications` but are not part of undo
  history (a feed, like a mailbox). Change-driven ones are created in `mutate`; due/overdue reminders are synced
  on load, every minute and after each change, deduplicated per task, recipient and day.
- Saves are debounced (150ms) and flushed on `pagehide`, so a change made right before a reload is kept.
- Workflows (`core/workflows.ts`): `Task.statusId` is the workflow status; `Task.status` is its category, kept in
  sync by `reconcileTasks` inside every store mutation. Everything status-dependent reads the category.
  Sub-projects (`core/project-tree.ts`): project filters everywhere include descendants.
