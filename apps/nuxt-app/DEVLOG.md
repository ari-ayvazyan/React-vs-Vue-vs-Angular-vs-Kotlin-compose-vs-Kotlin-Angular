# DEVLOG – Nuxt (Vue 3 + Pinia)

START: 2026-10-15T21:10:22Z

## Stack
Nuxt 4.6.1, Vue 3.5, vue-router 5, Pinia 4.1 + @pinia/nuxt 1.0, @nuxt/eslint 1.17 (ESLint 10), Vitest 5,
vue-tsc 3 / TypeScript 6. Scaffolded with `npx nuxi@latest init` (minimal template).

## Timeline / notes
- 21:10 Scaffolded. `npm i` inside the scaffolder failed with an npm 10.9 arborist crash
  (`Cannot read properties of null (reading 'edgesOut')`). Worked around with `npx npm@11 install`.
- 21:12 **Switched to bun** (coordinator request): deleted `node_modules` + `package-lock.json`, `bun install`
  (5 s, produced `bun.lock`). Friction: almost none. bun blocks untrusted postinstall scripts
  (`unrs-resolver`); nothing broke because of it. `postinstall: nuxt prepare` still ran. Scripts now run via
  `bun run …`; the production server still runs on Node (`node .output/server/index.mjs`).
- Business logic written first as plain TS in `app/lib` (filters, stats, generator, validation, history,
  board ops, calendar), then Pinia setup stores, then UI.
- 21:28 First `typecheck`, `lint`, `test` (21 tests) and `build` all passed; only lint warnings were
  `vue/html-self-closing` on `<input />` (autofixed).
- 21:30–21:37 Playwright (playwright-core from `../../bench/node_modules`, scripts in the scratchpad) against the
  production server: every route, `?seed=1000`, search/URL/back button, bulk actions, modal validation,
  create task + reload persistence, `n`/`Esc`/`g b`/`?` shortcuts, HTML5 drag between columns, Shift+arrow moves,
  calendar expand/month nav, Pomodoro + top-bar mini timer across navigation, theme toggle, project delete + undo,
  import (invalid and valid) / export download, Ctrl+Z / Ctrl+Shift+Z, focus trap, mobile drawer, no horizontal
  overflow at 375px. Also loaded all routes on the **dev** server (Vue's detailed hydration-mismatch warnings
  are on there): no warnings at all.
  The only console error is the browser's own "Failed to load resource: 404" on the 404 route, because the
  catch-all page sets a real HTTP 404 status (on purpose).

## Design decisions
- **SSR + localStorage**: the server renders the shell plus skeletons. A client plugin loads storage on
  `app:suspense:resolve` (after hydration). Server HTML and the first client render therefore match, and
  hydration is clean. Theme: a small inline `<head>` script reads `taskpilot:v1` and sets `data-theme` before
  first paint, so there's no flash of the wrong theme.
- Tasks/projects live in `shallowRef` arrays that are updated immutably. Undo/redo snapshots (depth 50) are then
  just two array references, and big datasets avoid deep-reactivity overhead.
- Filters/search/sort/page live entirely in the route query (`parseTaskQuery`/`serializeTaskQuery`). Search uses
  `router.replace` after a 200 ms debounce; other filter changes `push`, so Back works.
- Board: native DnD with a drop-position indicator. With a project filter on, visible indices are mapped to
  full-column indices so hidden cards keep their order. Very large columns render 150 cards at a time with a
  "Show N more" button (with `?seed=5000` the board renders 450 cards instead of ~5000).
- Pomodoro time logging is **not** part of undo history (it's tracking, not an edit). Sub-minute remainders
  carry over between pauses and are rounded on finish/reset.
- `?seed=N` keeps the user's persisted settings (theme etc.) and replaces tasks and projects.

## What went smoothly
- Nuxt auto-imports plus `<script setup>` made the UI fast to write. Pinia setup stores feel like plain composables.
- `nuxt typecheck` and `@nuxt/eslint` worked with zero config beyond the generated flat config.
- Route-query-driven state worked naturally with `useRoute()` + `computed`.
- Production build is about 10 s, and the output is a self-contained `.output` folder.

## Friction
- npm 10 crashed while installing the scaffolded project (npm bug, not Nuxt's).
- `<script setup>` can't `export` interfaces, so shared prop types had to move into `app/lib/*.ts`.
- Scoped styles also apply to a child component's **root** element. That caused two visual bugs: a page's
  `.chip` class styled `ProjectChip`, and a bare `svg {}` rule in a component stretched the icon SVGs in its
  buttons.
- To keep hydration clean, every data-dependent page needs a `ready` gate (skeleton until the client data loads).
  Content therefore isn't in the SSR HTML. That's expected with localStorage-only data.

## Mistakes I made
1. **Assumed the scaffolder's npm install would work.** npm 10 crashed. Found it in the scaffolder output and
   fixed it by installing with `npx npm@11` (later replaced by bun anyway).
2. **Put `export interface` inside `<script setup>`** (AppIcon, TaskForm, Donut/Bar charts). I caught this while
   writing the code, before the first compile, and moved the types to `app/lib/icons.ts`, `validation.ts` and
   `chartTypes.ts`.
3. **TaskForm reset the whole draft whenever the task object changed.** That would have wiped unsaved edits
   whenever a subtask was toggled or Pomodoro time was logged. I spotted it while writing the detail page.
   Fix: only fields the user hasn't edited get updated from the store.
4. **Used `<component :is="'NuxtLink'">`**, which doesn't resolve at runtime. Noticed during self-review and
   fixed with `resolveComponent('NuxtLink')`.
5. **Line chart used `preserveAspectRatio="none"`**, which would have stretched the axis text. Fixed before
   running. Later screenshots showed tiny text and fractional ticks (2.5, 7.5) on mobile. I rewrote the chart
   to measure its width with a ResizeObserver and use integer tick steps.
6. **Scoped-style bleed** (see Friction). Screenshots showed the project chip drawn as a bordered pill and the
   Pomodoro Start/Reset icons blown up. I renamed the filter class to `.fchip` and scoped the SVG rules
   (`.dial svg`, `.donut > svg`, `.chart > svg`).
7. **Done tasks showed "20d overdue"** on board cards and DueLabel. Seen in screenshots; done tasks now show
   the plain date.
8. **Mobile task-list layout:** I first hid project/priority/due on mobile, which lost information. I caught
   this in review and used a `display: contents` meta wrapper that becomes a wrapped row on small screens.
   The mobile header also needed fixing ("Select" was wrapping badly).
9. **Mobile board header text was clipped** because I removed the page's right padding to let the columns
   bleed. Seen in a screenshot. Fixed with a negative margin on the column scroller only.
10. **Duplicate `data-testid="task-title-input"`**: the detail page's inline form and the modal both had it,
    so Playwright hit a strict-mode violation. The test id is now opt-in (`testids` prop), used only by the
    global modal.
11. **Calendar ARIA:** I first used `role="grid"` without row wrappers, which is invalid ARIA. Changed to
    region and group roles.
12. **Calendar "late" items had red outlines** that dominated the month view. Seen in a screenshot; changed
    to red text.
13. **Process-killing commands killed my own shell.** `pkill -f ".output/server/index.mjs"` and
    `ps | grep "[i]ndex.mjs" | xargs kill` matched the bash command line itself (exit code 144). The second,
    broader pattern could also have matched other agents' processes that had `index.mjs` in their command line.
    I replaced both with a script that kills only processes whose cwd is `apps/nuxt-app` and whose command line
    contains `.output/server`.
14. **Scratchpad collision:** I first wrote my e2e files into `scratchpad/e2e`, which other agents were also
    using (I found their files there). Moved mine to `scratchpad/nuxt-e2e`.
15. **Test-script selector mistakes:** `getByRole('heading', { name: 'Data' })` also matched "Reset demo data".
    Fixed with `exact: true`.
16. **Modal close felt slow in the benchmark** (`create_task` took about 500 ms because the panel waited for its
    leave transition). Close is now instant; only the open is animated.

END: 2026-10-15T21:38:35Z
