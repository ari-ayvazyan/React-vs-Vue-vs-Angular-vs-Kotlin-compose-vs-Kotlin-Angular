# Nuxt/Vue vs Next.js/React vs Angular: the same app built three times

Three AI developers each built the same app from one spec ([`SPEC.md`](../SPEC.md)). Each developer was one Claude subagent, working in parallel in its own folder, with the same instructions apart from the framework. I then measured all three apps with the same scripts (`bench/`).

> **Second run (Oct 16).** After the first report I made three changes, then reran the whole benchmark:
> - removed the Nuxt board's 150-cards-per-column cap;
> - turned on response compression in the Nuxt and Angular production servers;
> - set Nuxt's brotli level to 4, the same as Angular's middleware.
>
> All numbers below come from the second run. §10 shows what changed compared with the first run.

**The app: "TaskPilot".** A task manager with a dashboard, built on 7 routes:
- Tasks: create/edit/delete, a filtered and searched list with sorting, pagination, bulk actions, and filters kept in the URL.
- A Kanban board with native drag and drop and keyboard moves.
- A dashboard with 6 KPIs and 3 hand-drawn SVG charts.
- A month calendar, project management and a Pomodoro timer.
- Undo/redo, keyboard shortcuts, JSON import/export, and a dark theme.
- Server-side rendering with hydration, accessibility and mobile layout.

**Limits on what the developers could use:**
- No UI kits, CSS frameworks, chart, drag-and-drop or date libraries.
- State management only from the framework or its official packages: Pinia for Nuxt, React built-ins for Next.js, signals for Angular.
- bun as package manager.

| Framework | Version |
|---|---|
| Nuxt/Vue | 4.6.1 (Vue 3.5, Pinia 4.1) |
| Next.js/React | 16.4.2 (React 19.3, App Router) |
| Angular | 22.2.3 (standalone components, signals, zoneless) |

---

## 1. Summary

| | Nuxt/Vue | Next.js/React | Angular |
|---|---|---|---|
| Development time | **28 min** | ~38–40 min ¹ | **28 min** |
| App code (no tests or config) | **6,312 lines** | 7,141 | 7,577 |
| Client JS (gzip) | **124 KB** | 223 KB | 142 KB |
| Clean build (median of 3) | 11.2 s | 10.1 s | **7.0 s** |
| Mobile Lighthouse ² | 98 / 98 | 97 / 97 | **99 / 99** |
| Mobile LCP | 2.11 s | 2.30 s | **1.68 s** |
| Mobile FCP | 1.85 s | **0.91 s** | 1.68 s |
| Board with 5,000 tasks | 2.80 s | **1.04 s** | 1.83 s |
| JS heap with 5,000 tasks | 131 MB | **61 MB** | 66 MB |
| Average cyclomatic complexity | 2.46 | 2.56 | **1.96** |
| Unit tests written | 21 | 26 | **31** |
| Setup friction | low | medium | **high** |
| UI quality (my rating) | 8.5 / 10 | 7.5 / 10 | 8.5 / 10 |

Lighthouse cells are dashboard / tasks.

¹ The container restarted while Next.js was in its last checks, so its time includes the restart and the resume.
² All three servers now compress their responses: Nuxt and Angular with brotli, Next.js with gzip, its built-in default.

**Overall:** all three frameworks could build the full spec in about the same time, and none of them is a clear winner.
- **Nuxt/Vue** gave the smallest code and the smallest bundle, with the least friction. Without the board cap, though, it's the slowest and uses the most memory with 5,000 cards on screen.
- **Angular** gave the best Lighthouse scores and page-load time and the lowest complexity, at the cost of more code and the most setup trouble.
- **Next.js/React** paints the first screen fastest and renders the big board fastest. But it ships the most JavaScript, re-renders slowly when the whole store changes, took the longest to build, and kept one visible bug.

---

## 2. Development time and effort

| | Nuxt/Vue | Next.js/React | Angular |
|---|---|---|---|
| Start → end (from DEVLOG) | 21:10:22 → 21:38:35 (**28m 13s**) | 21:10:23 → 21:50:01 (39m 38s) | 21:10:23 → 21:38:24 (**28m 01s**) |
| Tool calls by the builder | 117 | not recorded (lost in the restart) | **79** |
| Tokens used by the builder | 252k | ~282k | **237k** |
| First time lint, type-check, tests and build all passed | ~21:28 | — | ~21:29 |

**Caveats:**
- Each framework was built once (n = 1).
- All three builders ran at the same time on one 4-core machine.
- All three switched from npm to bun about 2 minutes in, when you asked.
- All three builders were the same AI model. That measures how much code and how many steps a framework needs from an experienced developer, not how fast a human learns it.

---

## 3. Lines of code

Counted with `bench/loc-split.mjs`. Only non-blank, non-comment lines count. `package.json`, lockfiles, JSON, docs and build output are left out.

| | Nuxt/Vue | Next.js/React | Angular |
|---|---|---|---|
| **Styling** (CSS, Vue `<style>`, Angular `styles`) | 2,728 | 2,731 | **2,666** |
| **Templates** (Vue `<template>`, Angular HTML) | 1,338 | — ⁴ | 1,860 |
| **Logic** (TS; for React this includes JSX) | 2,246 | 4,410 ⁴ | 3,051 |
| **Templates + logic** (fair comparison) | **3,584** | 4,410 | 4,911 |
| **App total (no tests/config)** | **6,312** | 7,141 | 7,577 |
| Tests | 244 (21 tests) | 280 (26 tests) | 481 (31 tests) |
| Config files | 39 | 26 | 54 |
| Source files | **45** | 51 | 58 |
| Components | 28 | 26 | 19 |

⁴ React has no separate template layer, so its JSX markup is counted as logic.

**What the numbers show:**
- **Styling is almost the same in all three** (about 2,700 lines). That's expected: all used plain CSS and built the same design.
- **Nuxt needed the least code.** Its templates + logic total is 3,584 lines: 19% less than Next.js and 27% less than Angular. Auto-imports and `<script setup>` with `v-model` and directives save a lot of boilerplate.
- **Angular has the most code.** It needs a decorator and a class per component, explicit `input()`/`output()` calls, and has more services.

---

## 4. Performance

All measurements ran against **production builds**, one app at a time on an otherwise idle machine, in headless Chromium.

### 4.1 Page load (local, no throttling, median of 5)

| Page `/dashboard` | Nuxt/Vue | Next.js/React | Angular |
|---|---|---|---|
| Time to first byte | 13 ms | **5 ms** | 18 ms |
| First Contentful Paint | 108 ms | **88 ms** | 100 ms |
| Largest Contentful Paint | 220 ms | 244 ms | **164 ms** |
| Transferred | 147 KB (brotli) | 237 KB (gzip) | **130 KB** (brotli) |
| Requests | 42 | 35 | **8** |

### 4.2 Client bundle (built files)

| | Nuxt/Vue | Next.js/React | Angular |
|---|---|---|---|
| JS, raw | **321 KB** | 715 KB | 441 KB |
| JS, gzip | **124 KB** | 223 KB | 142 KB |
| CSS, gzip | 10 KB | 9 KB | 2 KB ⁵ |

⁵ Angular puts component styles inside the JS.

### 4.3 Lighthouse (median of 3)

| | Nuxt/Vue | Next.js/React | Angular |
|---|---|---|---|
| Mobile performance (dashboard / tasks) | 98 / 98 | 97 / 97 | **99 / 99** |
| Mobile FCP (dashboard / tasks) | 1.85 / 1.70 s | **0.91 / 0.91 s** | 1.68 / 1.54 s |
| Mobile LCP (dashboard / tasks) | 2.11 / 1.96 s | 2.30 / 2.26 s | **1.68 / 1.68 s** |
| Mobile Total Blocking Time (dashboard / tasks) | **63** / 123 ms | 129 / 146 ms | 69 / **98** ms |
| Desktop performance | 100 / 100 | 100 / 100 | 100 / 100 |
| Accessibility | 97 / 96 | 100 / 96 | 100 / 96 |
| Best practices / SEO | 100 / 100 | 100 / 100 | 100 / 100 |

**Compression matters.** Next.js compresses its responses itself. The default Nuxt (Nitro) and Angular (Express) production servers don't. In the first run, uncompressed, they scored only 86–89 on mobile. With compression turned on they reach 98–99. How it's turned on:
- **Nuxt/Vue:** `nitro.compressPublicAssets: true` for static files, plus a 15-line Nitro plugin for the server-rendered HTML, since Nitro has no built-in runtime compression.
- **Angular:** one line, `app.use(compression())`, in `server.ts`.

Next.js still paints first content about twice as fast, because it streams HTML. Angular reaches the largest content first: it makes only 8 requests and inlines its critical CSS. Nuxt has 4 small CSS files that block rendering.

### 4.4 Interaction speed with 5,000 tasks (median of 3)

| | Nuxt/Vue | Next.js/React | Angular |
|---|---|---|---|
| Go to Tasks list | 179 ms | 173 ms | **108 ms** |
| Search (after the 200 ms debounce) | 57 ms | **46 ms** | 65 ms |
| Next page | 33 ms | **32 ms** | 80 ms |
| Go to Board (5,000 cards) | 2,803 ms | **1,041 ms** | 1,825 ms |
| Go to Calendar | 385 ms | **272 ms** | 286 ms |
| Go to Dashboard | 91 ms | 355 ms | **73 ms** |
| Create a task (open modal, type, save) | **337 ms** | 682 ms | 374 ms |
| JS heap after the run | 131 MB | **61 MB** | 66 MB |

With 300 tasks, every action in every app took under 400 ms, and heap use was 11–17 MB. Each value is a median of only 3 runs, so differences under about 100 ms are within the noise.

**Where each framework struggles at scale:**
- **Nuxt/Vue** is slowest at rendering 5,000 board cards: 2.8 s, and the heap grows to 131 MB, twice the others. I didn't profile the cause. A likely one: each Nuxt card renders about six child components (two `AppIcon`s, `DueLabel`, `PriorityBadge`, `ProjectChip` and a `NuxtLink`), so 5,000 cards create about 30,000 component instances. `NuxtLink` also sets up link prefetching for each link that becomes visible. The 150-card cap that the Nuxt builder had added was the right instinct.
- **Next.js/React** slows down most when the whole store changes: the dashboard takes about 4× longer, and creating a task about 2× longer, than in the other two. The likely cause: its `useSyncExternalStore` store makes every subscriber re-render on any change. With React built-ins only, that's the easy path; selective subscriptions would need more code.
- **Angular** is the most even. It's never the slowest except on paging (80 ms, still instant to the eye).

---

## 5. Build, dependencies, tooling

| | Nuxt/Vue | Next.js/React | Angular |
|---|---|---|---|
| Clean build (median of 3) | 11.2 s ⁹ | 10.1 s | **7.0 s** |
| Runtime dependencies | 5 | **3** | 12 (incl. `compression`) |
| Dev dependencies | **7** | **7** | 15 |
| `node_modules` size | **369 MB** | 639 MB | 561 MB ⁷ |
| Unit tests (`bun run test`) | Vitest, 21 tests | Vitest, 26 tests | Vitest via `ng test`, 31 tests |

⁹ Includes about 1 s for pre-compressing static files (new in the second run).

⁷ Angular's figure includes about 100 MB for a Node 24 binary. The latest Angular CLI needs Node ≥ 22.22.3, and this machine has 22.22.0, so the builder installed Node 24 as a dependency.

---

## 6. Code complexity

Measured with [lizard](https://github.com/terryyin/lizard). For Vue, the `<script>` blocks were extracted first; for Next.js, `.tsx` files were included.

| | Nuxt/Vue | Next.js/React | Angular |
|---|---|---|---|
| Functions | 368 | 389 | **288** |
| Average cyclomatic complexity | 2.46 | 2.56 | **1.96** |
| Average function length (lines) | 4.8 | 8.3 | **4.2** |
| Functions with complexity > 10 | 8 | 8 | **3** |
| Functions with complexity > 15 | 3 | 6 | **2** |
| Most complex | shortcut handler, validation (31) | `validateTask` (28), `AppShell.onKey` (27) | `validateTask` (19) ⁸ |

⁸ lizard reports 55 for Angular's `matchesDue`. That's a parsing error: the function is a plain 5-case `switch`.

**What the numbers show:**
- **Angular's code is the most even.** Its many small methods spread across services and components keep each function simple, but add lines (§3).
- **Next.js has the longest functions.** React components are themselves functions, so JSX branches and hooks pile up inside one function body. The big reducer adds to it.
- **Nuxt is in between.** Most of its branching lives in templates (`v-if`), which lizard doesn't measure.

---

## 7. UI quality

Screenshots of every page, in light and dark mode at desktop (1440 px) and mobile (375 px) width, are in `report/screenshots/`:
- `compare/`: all five apps side by side (including the two Kotlin variants from §11), one image per page, mode and width.
- `nuxt/`, `next/`, `angular/`, `angular-kotlin/`, `kotlin/`: the full-size screenshots of each app (26 each).

The three UIs look strikingly alike. The same model designed all three, and all used the same indigo-on-slate look, card-based KPIs and sidebar layout. All three have working dark mode and mobile layouts, and Lighthouse accessibility scores of 96–100.

| | Nuxt/Vue | Next.js/React | Angular |
|---|---|---|---|
| Strengths | Projects listed in the sidebar; streak badge; tag "chips" in the task form; on mobile, filters collapse behind a "Filters" button; dense, informative task list | Clean KPI tiles with icons; "Last 30 days · 84 tasks" context on the chart; clean modal | Friendly header ("Good evening …"); KPI progress bar; overdue count shown in red; past and next month greyed out in the calendar; "1–25 of 300" on the list; collapsible filters on mobile |
| Weaknesses | The smoothed line chart draws curves between whole-number days (it never dips below zero); KPI tiles with coloured left borders look busier | **Bug: done cards on the board still say "20d overdue"** (the red style is skipped, but the text is wrong; the other two fixed this fully); on mobile all filters stay open and push the list down; tags are typed into a comma-separated text field | On mobile, the chart's y-axis labels are very small; the modal is taller with more empty space |
| Rating | **8.5** | **7.5** | **8.5** |

---

## 8. Mistakes each builder reported

Each builder kept a full list in its `apps/*/DEVLOG.md`: Nuxt 16 items, Next.js 15, Angular 15. The ones that say something about the framework:

**Mistakes all three made:**
- Each one killed its own shell with `pkill -f …`.
- Each built a task form that threw away unsaved edits when the task changed elsewhere.
- Each had chart axes with uneven or fractional ticks, or text that scaled badly.
- Each first labelled done tasks as "overdue". Next.js still shows the "overdue" text (without the red style) on the board.

None of these depend on the framework.

| Framework | Problems specific to the framework |
|---|---|
| **Nuxt/Vue** | Tried `export interface` inside `<script setup>` (not allowed). `<component :is="'NuxtLink'">` doesn't resolve without `resolveComponent`. **Scoped styles also apply to a child component's root element**, which caused two visual bugs. The scaffolder's npm install crashed (an npm bug). |
| **Next.js/React** | **Importing global CSS after the components let it override CSS Modules**, which broke the layout. Cache Components (on by default) requires `useSearchParams` to sit inside `<Suspense>` and **keeps hidden copies of visited pages in the page**, so the same test IDs exist twice. The React Compiler lint rules are strict. `tsc` fails when `.next/` is missing. The scaffold's `@types/node` version conflicted with Vitest. |
| **Angular** | The **CLI needs a newer Node** than the machine had. With bun, the scripts couldn't find a `node` binary on their own. **The SSR server returned 400 errors until `allowedHosts` was set.** `?seed` handling broke twice because `router.url` is not set yet before the first navigation finishes. Zoneless change detection updates the page asynchronously, so tests needed short waits. The default style size budget was too tight. |

---

## 9. Conclusions

**Pick Nuxt/Vue** if you care most about building fast with little code: it had the least code, the smallest bundle, the smallest install, and the least setup trouble. Turn on compression in production, watch for scoped-style leakage, and paginate or virtualize very long lists: rendering 5,000 components at once was its weakest result.

**Pick Angular** if you want strong structure and good production performance, and don't mind more code: it had the lowest complexity, the most tests, the best Lighthouse scores and LCP, the most even performance at scale, and the fastest builds. Expect the most toolchain trouble with each new release (Node version, host allowlist).

**Pick Next.js/React** if first paint and the React ecosystem matter most: it has the fastest FCP, and compression and streaming work out of the box. It also rendered the 5,000-card board fastest. But it has the largest JS bundle and `node_modules`, and changes to the whole store cost the most once the data gets large. Its newest defaults (Cache Components) added friction that the developer had to work around.

**Limitations of this comparison:**
- Each framework was built once, and all three builders were the same AI model.
- All timings are on localhost. Lighthouse simulates mobile network throttling, but my own timing script ran unthrottled.
- Next.js's development time includes a container restart.
- Nuxt and Angular send brotli and Next.js sends gzip. Brotli files are usually a bit smaller, which slightly favours Nuxt and Angular in transfer size.

---

### How to reproduce

```bash
cd bench && bun install
./static.sh <name> ../apps/<name>-app          # LOC, complexity, deps, timed build
node loc-split.mjs <name> ../apps/<name>-app   # styling / templates / logic split
./run-all.sh                                   # runtime + Lighthouse + screenshots, one app at a time
./rerun.sh                                     # everything above for all three apps
```

The raw results are in `report/data/`.

---

## 10. What changed since the first run

| | Nuxt/Vue (1st → 2nd) | Next.js/React (1st → 2nd) | Angular (1st → 2nd) |
|---|---|---|---|
| Mobile Lighthouse, as served (dashboard) | 86 → **98** | 98 → 97 | 87 → **99** |
| Mobile LCP, as served (dashboard) | 3.31 → **2.11 s** | 2.27 → 2.30 s | 3.16 → **1.68 s** |
| Transferred on load (dashboard) | 410 → **147 KB** | 237 → 237 KB | 397 → **130 KB** |
| Board with 5,000 tasks | 428 ms (450 cards) → **2,803 ms** (5,000 cards) | 976 → 1,041 ms | 1,674 → 1,825 ms |
| JS heap with 5,000 tasks | 27 → **131 MB** | 54 → 61 MB | 63 → 66 MB |

**What changed in each app:**
- **Compression** (Nuxt, Angular) cut the bytes on load by about two-thirds and lifted mobile Lighthouse from 86–89 to 98–99.
- **Removing the cap** (Nuxt) made its board about 6.5× slower than before and 2.7× slower than Next.js, and its memory 5× higher. With the cap, Nuxt looked best at scale; without it, it's worst on that page.
- **Brotli level** (Nuxt): my first version of the compression plugin used brotli's slowest level (11). That raised Nuxt's time to first byte from 10 ms to 53 ms. Level 4 brought it back to 13 ms.
- **Next.js/React** wasn't changed. Its small differences between runs (±10%) show how noisy the measurements are.

The first run's report is in the git history (commit `7d6db63`).

---

## 11. All five stacks: adding Angular + Kotlin and Kotlin Compose

Two more variants were later built from the same spec, with the same rules and the same scripts:
- **Angular + Kotlin:** Angular templates and thin TypeScript components, with all logic in Kotlin/JS.
- **Kotlin Compose:** Compose HTML in the browser plus a Ktor server.

They were measured as first built, at git tags `ak-0` and `k-0`, with the same scripts as the first three. Both were built while five agents shared 4 CPU cores, so their build times are somewhat inflated.

| As first built | Nuxt/Vue | Next.js/React | Angular | Angular + Kotlin | Kotlin Compose |
|---|---|---|---|---|---|
| AI build time | 28 min | ~38–40 min | 28 min | 36 min | 39 min |
| Tokens / tool calls | 252k / 117 | ~282k / n/a | 237k / 79 | 299k / 100 | 302k / 111 |
| Lines of app code | 6,312 | 7,141 | 7,577 | 7,031 | **5,139** |
| Client JS (gzip) | **124 KB** | 223 KB | 142 KB | 172 KB | 286 KB |
| Unit tests | 21 | 26 | 31 | **40** | 29 (run on JVM and Node) |
| Mobile Lighthouse, as delivered (dashboard) | 86 | **98** | 87 | 79 | 75 |
| Mobile FCP / LCP, simulated | 1.85 / 2.11 s | 0.91 / 2.30 s | 1.68 / 1.68 s | 3.81 / 3.81 s | 0.76 / 3.24 s |
| Mobile FCP / LCP, real throttling | 1.32 / 4.16 s | 1.34 / 3.29 s | 0.73 / 0.73 s | **0.72 / 0.74 s** | 4.13 / 4.13 s |
| Time until data shows, with compression | 1.48 s | 1.53 s | **1.24 s** | 1.51 s | 2.21 s |
| 5,000-card board | 2.80 s | **1.04 s** | 1.83 s | 1.60 s | 9.80 s |
| Memory on that board | 87 MB | **31 MB** | 50 MB | 49 MB | 118 MB |
| Memory after leaving it (after GC) | **8 MB** | 31 MB | 45 MB (leak) | 44 MB (leak) | 14 MB |
| Shipped with compression | no | yes | no | no | **yes (agent added it)** |

FCP is when the first content appears; LCP is when the largest element appears. For Nuxt/Vue, Next.js/React and Angular, the real-throttling and "time until data shows" rows were measured after compression was turned on. Angular + Kotlin was measured as delivered, uncompressed, for real throttling, and behind a gzip proxy for "time until data shows".

**What the two Kotlin variants add:**
- **Angular + Kotlin's runtime matches Angular.** Once compressed, the Kotlin core costs no measurable time; it only adds bundle size (172 KB against 142 KB).
- **It also has the same incremental-hydration memory leak** (50,273 detached elements). Two separate codebases written by two separate agents leak identically, which confirms the leak comes from Angular's defaults.
- **Kotlin Compose renders entirely in the browser.** That gives it the slowest real-throttled first paint (4.1 s), which Lighthouse's estimate misses entirely (0.76 s). Its Compose HTML board is about 5–10× slower than the others.
- **Both Kotlin variants cost the AI more:** 36–39 minutes, about 300k tokens and 100+ tool calls, spent mostly on build setup and Kotlin/JS details (see each app's `DEVLOG.md`).
- **One apparent slowdown in Angular + Kotlin was a test artifact.** Its first page change took 3.5 s in the benchmark, but the CPU profile was idle: a toast covered the pagination buttons for about 5 seconds after seeding.

**UI quality.** The screenshots in `report/screenshots/compare/` show all five side by side.

| | Angular + Kotlin | Kotlin Compose |
|---|---|---|
| Strengths | Very close to the Angular app; clear KPI tiles and charts | Clean dashboard; status chips on rows; theme works in both modes |
| Weaknesses | Filters stay expanded on mobile | Filters stay expanded on mobile; a stray "( / )" in the search placeholder; the first paint is blank on slow devices |
| Rating | **8.5** | **7.5** |

The growth experiment, five feature requests on top of all five apps, is in [`growth/GROWTH.md`](growth/GROWTH.md).

