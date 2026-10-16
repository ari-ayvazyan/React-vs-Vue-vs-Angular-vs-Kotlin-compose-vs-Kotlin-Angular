# "TaskPilot" – Framework Comparison Spec

One spec, built three times: **Nuxt (Vue)**, **Next.js (React)**, **Angular**.
Every implementation must satisfy this spec exactly so the results can be compared.

## 0. Ground rules (fairness)

- Use the latest stable version of the framework, created with its official scaffolder
  (`npx nuxi@latest init`, `npx create-next-app@latest`, `npx @angular/cli@latest new`).
- **TypeScript, strict mode.** No `any` unless unavoidable (and commented).
- **Allowed dependencies:** the framework, its *official* first-party packages
  (e.g. Pinia / `@pinia/nuxt`, Angular CDK is NOT allowed, React has no official store so use built-ins),
  a unit-test runner (Vitest / Jest / framework default), ESLint/Prettier.
  **Not allowed:** UI component libraries, CSS frameworks (no Tailwind/Bootstrap/Material),
  chart libraries, drag-and-drop libraries, date libraries, state libraries other than the above.
  Everything (charts, DnD, calendar, modals, toasts) is hand-built.
- Styling: plain CSS / the framework's idiomatic scoped CSS / CSS Modules. Use CSS custom properties for theming.
- No backend. Persistence is `localStorage` (key `taskpilot:v1`). SSR / prerendering is allowed where it is
  the framework default, but there must be no hydration errors or warnings in the browser console.
- Production build must work: `npm run build` then a start command that serves the production build.

## 1. Data model

```ts
type Priority = 'low' | 'medium' | 'high' | 'urgent';
type Status = 'todo' | 'in_progress' | 'done';

interface Project { id: string; name: string; color: string; /* hex */ createdAt: string; /* ISO */ }

interface Subtask { id: string; title: string; done: boolean; }

interface Task {
  id: string;
  title: string;              // required, 1..120 chars
  description: string;        // optional, max 2000 chars
  status: Status;
  priority: Priority;
  projectId: string | null;
  tags: string[];             // lowercase, unique, max 8
  dueDate: string | null;     // 'YYYY-MM-DD'
  estimateMinutes: number | null;
  timeSpentMinutes: number;   // incremented by the Pomodoro timer
  subtasks: Subtask[];
  createdAt: string;          // ISO
  completedAt: string | null; // ISO, set when status becomes 'done', cleared otherwise
  order: number;              // ordering inside a kanban column
}

interface AppState { tasks: Task[]; projects: Project[]; settings: { theme: 'light' | 'dark' | 'system'; pomodoroMinutes: number; pageSize: number } }
```

## 2. Deterministic demo data (identical across all three apps)

Implement `generateDemoData(count: number): AppState` using this PRNG with seed `42`:

```ts
function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
```

- 6 projects: `Website, Mobile App, Marketing, Infrastructure, Hiring, Personal` with colors
  `#6366f1, #ec4899, #f59e0b, #10b981, #3b82f6, #8b5cf6`.
- Tags pool: `bug, feature, chore, research, design, backend, frontend, urgent-fix, meeting, docs`.
- For each task i (0-based), with `r = rng`:
  - title: `` `${VERBS[floor(r()*VERBS.length)]} ${NOUNS[floor(r()*NOUNS.length)]} #${i+1}` `` with
    VERBS = `Fix, Build, Review, Write, Design, Refactor, Test, Plan, Deploy, Research`,
    NOUNS = `login flow, dashboard, API docs, onboarding, landing page, CI pipeline, invoice export, search, settings page, release notes`.
  - status: r() < 0.45 → done, < 0.65 → in_progress, else todo.
  - priority: from `[low, medium, high, urgent]` at index floor(r()*4).
  - projectId: r() < 0.1 → null, else project[floor(r()*6)].
  - tags: 0–3 tags: n = floor(r()*4), pick n times `TAGS[floor(r()*10)]` (dedupe).
  - dueDate: r() < 0.15 → null, else today + (floor(r()*60) - 25) days.
  - createdAt: today − floor(r()*60) days. completedAt (if done): createdAt + floor(r()*10) days, capped at now.
  - estimateMinutes: [15,30,60,120,240][floor(r()*5)]; timeSpentMinutes: floor(r()*180).
  - subtasks: floor(r()*4) subtasks titled `Step 1..n`, `done = r() < 0.5`.
  - description: `"Demo task " + (i+1)`.
- On first load with empty storage: seed 300 tasks.
- **Benchmark hook:** visiting any route with `?seed=N` replaces all data with `generateDemoData(N)`
  (then removes the query param). Settings page also has a "Reset demo data" control.

## 3. Routes / pages

| Route | Content |
|---|---|
| `/` | redirect to `/dashboard` |
| `/dashboard` | KPIs + charts (see §4) |
| `/tasks` | task list with filters/search/sort/bulk/pagination |
| `/tasks/:id` | task detail + edit form, subtasks, pomodoro |
| `/board` | Kanban board |
| `/calendar` | month calendar |
| `/projects` | project CRUD + per-project progress |
| `/settings` | theme, pomodoro length, page size, import/export, reset demo data |
| anything else | 404 page |

App shell: collapsible sidebar navigation (becomes a drawer below 768px), top bar with global search box,
"New task" button, theme toggle.

## 4. Features

1. **Tasks CRUD** – create/edit in a modal (from anywhere) and on the detail page. Validation with inline
   error messages (title required, ≤120 chars; description ≤2000; tags ≤8; estimate positive integer).
2. **Task list** (`/tasks`):
   - Filters: status (multi), priority (multi), project, tag, due (`all | overdue | today | this week | no date`).
   - Full-text search across title, description, tags – debounced 200ms. Global top-bar search navigates here.
   - Sort: due date, priority, created, title (asc/desc).
   - Filters/search/sort/page are reflected in the URL query string (shareable, back button works).
   - Pagination using `settings.pageSize` (default 25).
   - Bulk select (checkbox per row + select all on page): mark done, delete, move to project.
   - Inline quick-toggle done per row. Overdue rows visually flagged.
3. **Kanban board** (`/board`): 3 columns by status, cards show title/priority/project/due/subtask progress.
   Native HTML5 drag & drop between and within columns (updates `status` + `order`).
   Keyboard alternative: focused card + `Shift+←/→` moves column, `Shift+↑/↓` reorders.
   Board can be filtered by project.
4. **Dashboard** (`/dashboard`):
   - KPI tiles: total tasks, open tasks, overdue, completed in last 7 days, completion rate %, total hours tracked.
   - Line/area chart: tasks completed per day, last 30 days (hand-written SVG, with axis labels and hover tooltip).
   - Donut chart: open tasks by priority (SVG, with legend).
   - Horizontal bar chart: completion % per project.
   - "Upcoming deadlines" (next 7 days, max 8) and "Overdue" lists linking to task detail.
   - Productivity streak: consecutive days (ending today or yesterday) with ≥1 completed task.
5. **Calendar** (`/calendar`): month grid (Mon-first), prev/next/today navigation, tasks shown on their due
   date (max 3 + "+N more" that expands), click task → detail. Highlight today.
6. **Projects** (`/projects`): create/rename/recolor/delete (delete asks: move tasks to "no project" or delete them).
   Shows task count and progress bar per project.
7. **Pomodoro timer** on task detail: start/pause/reset, counts down `settings.pomodoroMinutes`;
   time actually elapsed is added to `timeSpentMinutes` when paused/finished/reset. A mini timer indicator is
   visible in the top bar while running, even after navigating away.
8. **Undo/redo** for all task & project mutations (history depth 50): `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`.
   Deleting shows a toast with an "Undo" button (auto-dismiss 5s).
9. **Keyboard shortcuts**: `n` new task, `/` focus search, `g d` dashboard, `g t` tasks, `g b` board,
   `g c` calendar, `?` shortcut help modal, `Esc` closes modals. Not active while typing in inputs.
10. **Import/Export**: export state as JSON download; import a JSON file with schema validation and a clear
    error message on invalid input.
11. **Theme**: light/dark/system, persisted, no flash of wrong theme on reload if reasonably possible.
12. **Accessibility**: semantic HTML, labelled inputs, visible focus, modals trap focus & restore it,
    `aria-live` for toasts, colour contrast AA.
13. **Responsive**: usable at 375px wide (list collapses to cards, board scrolls horizontally).

## 5. Test hooks (required, used by the benchmark scripts)

Add these `data-testid` attributes:
`nav-dashboard, nav-tasks, nav-board, nav-calendar, nav-projects, nav-settings, global-search, new-task-button,
task-modal, task-title-input, task-save-button, task-row (one per row in list), task-list-search,
pagination-next, kpi-total, kpi-open, kpi-overdue, kpi-completed-7d, kpi-completion-rate, kpi-hours,
chart-completed, chart-priority, chart-projects, board-column-todo, board-column-in_progress,
board-column-done, board-card, calendar-grid, theme-toggle, toast`.

## 6. Quality requirements

- `npm run lint` and type-check pass with no errors.
- Unit tests (`npm test`) for the pure logic: filtering, sorting, search, KPI/streak calculation,
  demo-data generator determinism, import validation, undo/redo. At least 15 tests, all passing.
- No console errors at runtime.
- Keep business logic (filters, stats, generator, validation) in framework-agnostic TS modules where idiomatic,
  but state management and UI must be idiomatic for the framework.
