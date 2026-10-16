# TaskPilot – Nuxt 4 (Vue 3 + Pinia)

Package manager / script runner: **bun** (v1.4.x). The server runtime is Nuxt's normal Nitro `node-server` output (run with Node 22).

```bash
bun install                      # installs deps, runs `nuxt prepare`
bun run dev                      # dev server on http://localhost:3000
bun run build                    # production build -> .output/
PORT=3001 bun run start:prod     # serve the production build on http://localhost:3001
bun run lint                     # ESLint (@nuxt/eslint flat config)
bun run typecheck                # nuxt typecheck (vue-tsc, strict)
bun run test                     # Vitest unit tests (pure logic in app/lib)
```

`start:prod` runs `node .output/server/index.mjs`; Nitro reads `PORT` (and `HOST`) from the environment.

Benchmark hook: open any route with `?seed=N` (e.g. `/dashboard?seed=1000`) to replace all data with
`generateDemoData(N)`; the param is removed afterwards. Data is stored in `localStorage` under `taskpilot:v2`
(schema v2: sub-projects and workflows). Existing `taskpilot:v1` data is migrated on first load and the v1 key is removed;
JSON import accepts both v1 and v2 exports, export writes v2 (`schemaVersion: 2`).

## Layout
- `app/lib/` – framework-agnostic TS: types, PRNG/demo data, filters/sort/search/URL query, stats/KPIs/streak,
  validation (task form + import schema), undo/redo history, board move ops, calendar grid, icons,
  team members (`members.ts`: initials, avatar text colour, name rules), recurring tasks (`recurrence.ts`),
  task dependencies (`dependencies.ts`), comment mentions (`mentions.ts`), the activity log (`activity.ts`),
  saved views (`views.ts`), the Gantt timeline layout (`timeline.ts`), notifications (`notifications.ts`), CSV
  export (`csv.ts`), the project tree (`projects.ts`), workflows (`workflows.ts`) and board columns (`board.ts`);
  report statistics live in `stats.ts`. Tasks store a workflow `statusId`; `status` is its category, kept in sync by
  `normalizeTasks` inside every store commit.
- `app/stores/` – Pinia setup stores: `tasks` (data, history, persistence API), `ui` (modals/toasts), `pomodoro`.
- `app/plugins/app-state.client.ts` – loads localStorage *after* hydration, handles `?seed`, theme and persistence.
- `app/pages/`, `app/components/`, `app/layouts/default.vue` – UI (hand-built charts, DnD, modals, toasts).
- `tests/logic.test.ts` (21), `tests/team-recurrence.test.ts` (20), `tests/collaboration.test.ts` (18),
  `tests/views-timeline.test.ts` (12), `tests/notifications-reports.test.ts` (12) and `tests/workflows-projects.test.ts`
  (15) – Vitest unit tests (all but the first also drive the Pinia task store directly).
