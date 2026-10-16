# DEVLOG – Next.js (App Router)

START: 2026-10-15T21:10:23Z

## Setup
- Scaffolded with `create-next-app@latest` (Next 16.4.2, React 19.3, TS strict, ESLint, no Tailwind, App Router).
  The scaffold now turns on `cacheComponents` + `partialPrefetching` by default. I kept both because they are the framework defaults.
- ~21:13Z: switched from npm to **bun 1.4.2** when the coordinator asked. I deleted package-lock.json and node_modules, ran `bun install` (which produced bun.lock), and used `bun add -d vitest`.
  The only friction was that bun blocks the `unrs-resolver` postinstall by default. Nothing broke (its native binary comes from optional deps).
  The bun shell expands `${PORT:-3002}` in package scripts as expected.
- About 21:47Z the container restarted and every process stopped. Files were intact. I re-ran lint, type-check, tests, the clean build, the prod server and Playwright, and all passed.

## Architecture
- `lib/` holds pure TS (types, mulberry32 demo generator, filters/sort/search, stats, validation, undo history, reducer, `TaskStore`).
- State: a module-level external store bound with `useSyncExternalStore`. `getServerSnapshot` returns `null`, so SSR and the hydration pass both render a skeleton, and the client then swaps in the localStorage data. This gave zero hydration warnings.
  Context + `useReducer` drive the toasts, the pomodoro timer (kept in the root layout so it survives navigation), and the task modal and help modal.
- Theme: a blocking inline script in `<head>` reads `taskpilot:v1` and sets `data-theme` before paint (no flash). `suppressHydrationWarning` is only on `<html>`.
- Task-list URL state uses `window.history.pushState/replaceState`, which Next syncs into `useSearchParams` with no server round-trip.

## Framework friction
- Cache Components: `useSearchParams` / `usePathname` must sit inside `<Suspense>`, or prerendering fails (the nav has a Suspense fallback that renders without the active state).
- Cache Components keeps visited routes mounted but hidden (`<Activity>`), so hidden DOM can still match test selectors. I used `:visible` selectors in my tests.
- `LayoutProps` is a generated global type. `tsc --noEmit` fails when `.next/` is missing, so I typed `children` explicitly.
- The React Compiler ESLint rules are strict (no reassigning variables after render, no ref writes during render). They caught one real issue.
- The AGENTS.md shipped by the scaffold warns that the APIs differ from training data. The bundled docs in `node_modules/next/dist/docs` were genuinely useful.

## Went smoothly
- The first production build succeeded, and there were no hydration or console warnings in prod or dev.
- All 26 unit tests passed on the first run.
- Native HTML5 drag and drop plus keyboard moves worked first try.
- With 5000 tasks in the Playwright runs: navigating to the tasks list took about 160 ms, search about 25 ms, and the board (all 5000 cards rendered) about 950 ms.

## Mistakes I made
1. `npm i -D vitest` failed with ERESOLVE (vitest 5 wants @types/node ≥22, but the scaffold pins ^20). Found from the npm error log. Fixed by bumping `@types/node` to ^22 after the switch to bun.
2. I imported `globals.css` after the component imports in `app/layout.tsx`, so global classes overrode the CSS-module overrides. As a result, the hamburger and drawer-close buttons showed on desktop, `hideMobile` did nothing, and the search icon overlapped the text. Found in Playwright screenshots. Fixed by importing globals first.
3. The dashboard area chart scaled its whole SVG through `viewBox`, so axis text came out huge on desktop and tiny on mobile. Found in screenshots. Fixed by measuring the width with ResizeObserver.
4. The Y-axis ticks were non-integers that got rounded (for example 2.5 shown as 3). Found in a screenshot. Fixed by rewriting `niceMax` so the step is an integer.
5. The mobile list header ("Select all on page") inherited a `grid-area` and got squeezed. Found in the 375px screenshot. Fixed by resetting `grid-area` for the header cell.
6. The theme toggle cycled light→dark→system, so the first click from "system" (resolved light) did nothing visible. Found by e2e. Changed the toggle to flip the effective light/dark theme; "system" is still available in Settings.
7. The shortcut guard treated checkboxes as text fields, so Ctrl+Z did nothing after clicking "select all". Found by e2e. Fixed so only text-like inputs block shortcuts.
8. Lint error `react-hooks/immutability`: I reassigned `offset` inside the donut segment `map`. Rewrote it without mutation.
9. Type errors: the `LayoutProps` global was missing after I deleted `.next`, and a test variable was inferred as `projects: never[]`. Fixed with explicit types.
10. A Python string replace used an empty slice and corrupted `components/charts.tsx` by inserting text between every character. Spotted in the grep output. Repaired by stripping the inserted string, then re-checked with tsc and lint.
11. `pkill -f "next start"` matched and killed my own shell (exit 144). After that I stopped servers by port, and after the restart by recorded PID only.
12. The project colour picker would have pushed one undo entry per `input` event. I noticed while writing it and debounced the commit.
13. The task detail page showed the due date twice ("Oct 25, 2026 · Oct 25"), and the title squeezed the buttons at 375px. Found in screenshots and fixed.
14. These were mistakes in my e2e script, not the app: a strict-mode clash between `getByRole('alert')` and Next's route announcer, a stray `page.clock.fastForward` call, a toast assertion that ran after the fake clock had already dismissed the toast, and a missing wait after a filter change. All fixed in the script.
15. I left unused scaffold SVGs in `public/` at first. Removed them.

END: 2026-10-15T21:50:01Z
