# TaskPilot (Next.js) – how to run

Package manager / script runner: **bun** (v1.4.2). The app itself runs on Node through the normal `next` CLI. Bun only installs packages and runs the scripts.

```bash
bun install                      # install dependencies (uses bun.lock)

bun run dev                      # dev server on http://localhost:3000

bun run build                    # production build (.next/)
PORT=3002 bun run start:prod     # serve the production build on http://localhost:3002
                                 # (PORT defaults to 3002 if not set)

bun run lint                     # ESLint (eslint-config-next, incl. React Compiler hook rules)
bun run typecheck                # tsc --noEmit (same as `bunx tsc --noEmit`)
bun run test                     # Vitest unit tests for the pure logic in lib/ (114 tests)
```

## Notes

- Data is kept in `localStorage` under `taskpilot:v2` (schema 2: sub-projects + per-project workflows). Data saved by
  older versions under `taskpilot:v1` is migrated on first load (the v1 entry is left as a backup). Exports carry
  `"schema": 2`; imports accept v1 and v2 files. On first visit, 300 demo tasks are generated.
- Tasks store `statusId` (a status of their project's effective workflow) and a derived `category`
  (`todo | in_progress | done`); everything status-dependent uses the category (see `lib/workflow.ts`).
- Data saved before team members / assignees / recurrence existed still loads: missing `members` becomes `[]`,
  missing `assigneeId` becomes `null`, and missing `recurrence` becomes `'none'` (see `lib/validation.ts`).
- Request 2 added `blockedBy`/`comments` on tasks, a top-level `activity` log and `settings.currentUserId`; all default
  when missing (`[]`, `[]`, `[]`, `'m1'`). The activity log is part of the undoable state and capped at 5000 entries.
- Request 3 added saved views (`views` in the stored state, default `[]`). The board reads its filters from the URL
  (`/board?project=…&assignee=…&priority=…`), which is how a view opens there. `/timeline` is the Gantt chart.
- Request 4 added `notifications` (persisted, not undoable, default `[]`; cleared by `?seed=N` / demo reset) and
  `/reports`. "Export CSV" on the task list downloads exactly the filtered + sorted tasks.
- Add `?seed=N` to any URL to replace all data with `generateDemoData(N)`, for example
  `http://localhost:3002/?seed=1000`. `/` redirects to `/dashboard` and keeps the query string.
- Layout:
  - `lib/`: framework-agnostic TypeScript (types, demo generator, filters, stats, validation, undo history, reducer, store,
    `members.ts` for initials/avatar contrast/name rules, `recurrence.ts` for next-occurrence logic,
    `dependencies.ts` for blockers/cycles, `mentions.ts` for `@` mentions, `activity.ts` for the change log, `views.ts` for saved views, `timeline.ts` for the Gantt layout, `notifications.ts`, `reports.ts`, `csv.ts`, `workflow.ts` for workflows + the project tree).
  - `components/`: React client components. `components/views/*` holds one view per route.
  - `app/`: App Router routes. These are thin server components that render the views.
  - `tests/`: Vitest unit tests.
