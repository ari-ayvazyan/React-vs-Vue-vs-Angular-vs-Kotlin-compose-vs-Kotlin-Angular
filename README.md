# React-vs-Vue-vs-Angular-vs-Kotlin-compose-vs-Kotlin-Angular
Benchmark, what works best with Opus 5.5 Medium

This repository holds a benchmark of which web stack works best when an AI builds an app and then keeps maintaining it. All code was written by Claude agents, one per stack, working from the same spec ([`SPEC.md`](SPEC.md)) and the same feature requests ([`report/growth/requests.md`](report/growth/requests.md)).

The app is **TaskPilot**, a task manager:
- 7 routes;
- a dashboard with hand-drawn SVG charts;
- a Kanban board with drag and drop;
- a calendar, undo/redo, keyboard shortcuts, import/export and dark mode;
- server-side rendering where the framework supports it.

The spec banned UI kits, CSS frameworks and chart, drag-and-drop or date libraries.

## The five stacks

| Folder | Stack |
|---|---|
| [`apps/nuxt-app`](apps/nuxt-app) | Nuxt/Vue: Nuxt 4, Vue 3.5, Pinia |
| [`apps/next-app`](apps/next-app) | Next.js/React: Next 16 App Router, React 19, built-in state only |
| [`apps/angular-app`](apps/angular-app) | Angular 22: standalone components, signals, zoneless, SSR |
| [`apps/angular-kotlin-app`](apps/angular-kotlin-app) | Angular UI with all logic in Kotlin/JS (Gradle, `@JsExport`) |
| [`apps/kotlin-app`](apps/kotlin-app) | Kotlin only: Compose HTML in the browser, Ktor server |

Every app uses bun for packages and scripts. Each app's `RUN.md` explains how to build and run it. `DEVLOG.md` and `ISSUES.md` are the agents' own logs, including the mistakes they made.

## The two experiments

### 1. Build it: "build this with X", nothing else

All five stacks were built from the spec: first Nuxt/Vue, Next.js/React and Angular in parallel, then the two Kotlin variants. The report is [`report/REPORT.md`](report/REPORT.md) (§11 compares all five).

- **Nuxt/Vue** got to a working app fastest (28 min), with the smallest JavaScript bundle.
- **Angular** produced the fastest-loading app under real mobile throttling.
- **Angular + Kotlin** matched Angular at runtime once compressed. It took the AI longer (36 min) and has the most tests.
- **Next.js/React** took the longest of the first three (~40 min), shipped a lot of JavaScript, and was the only one with a visible bug.
- **Kotlin only** has the least code, but it renders in the browser only: 4 s to first paint on a throttled phone, and 10 s to render 5,000 cards.
- **Framework defaults the AI didn't change:**
  - No compression in three of the five.
  - A memory leak in Angular's default incremental hydration, reproduced in both Angular apps: 50k detached DOM elements.
  - Next.js keeps hidden visited routes mounted.
- **Lighthouse's default (simulated) mobile mode** ranked the stacks differently from real throttling. It was off by 3 s in both directions.

### 2. Grow it: five feature requests

Each app got its own AI maintainer, which received five feature requests one at a time. The maintainers weren't told they were being measured. The two Kotlin stacks were built for this experiment from the same spec. The report is [`report/growth/GROWTH.md`](report/growth/GROWTH.md).

- **Size:** grew by 76–90% everywhere.
- **No spaghetti:** no stack turned into spaghetti. There were no import cycles in the TypeScript apps, duplication stayed at 1.5% or less, and tests stayed green.
- **Where complexity piled up:**
  - long components in Next.js/React and Kotlin only;
  - a widely used store in Nuxt/Vue;
  - the most new very complex functions in Angular;
  - least of all in Angular + Kotlin, which had the lowest complexity throughout.
- **The cross-cutting change request** doubled the AI's time in every stack.
- **Kotlin only (Compose HTML)** has a performance problem at scale: 13 s to render 5,000 cards.

## Repository layout

```
SPEC.md                    the spec every agent built from
apps/                      the five apps (with DEVLOG.md, ISSUES.md, RUN.md each)
report/REPORT.md           experiment 1 report (+ data/, screenshots/)
report/growth/GROWTH.md    experiment 2 report (+ charts, requests.md, data/)
blog/                      charts and images
bench/                     all measurement scripts
  growth/                  growth-experiment tooling (structure, complexity, duplication, perf, aggregation, charts)
  investigate/             one-off investigation scripts (heap/leak tracing, real-throttled timing, …)
  results/                 summarised results; raw Lighthouse JSON in raw-lighthouse.tar.xz
  results-v1.tar.xz        raw results of the first benchmark run
```

## Reproducing

Requirements: bun 1.4, Node 22, Chromium for Playwright, and JDK 21 with Gradle 8.14 for the Kotlin apps.

```bash
cd bench && bun install
./run-all.sh                     # experiment 1: runtime + Lighthouse + screenshots (Nuxt/Vue, Next.js/React, Angular)
growth/measure.sh <N>            # growth metrics for the three TypeScript apps at iteration N
growth/measure-app.sh ...        # one app (used for the Kotlin apps)
growth/final-perf.sh             # final quiet performance run, all five apps
python3 growth/aggregate.py && python3 growth/charts.py
```

## Caveats

- **One run per stack and one AI model.** Results that are close could change order on another run.
- **The timing figures are affected by the run conditions.** Several agents shared a 4-core machine, and a container restart and an account usage limit interrupted some runs. The reports call out where this applies.
