# Data: build-it experiment (all five stacks, as first built)

- `five-stacks-initial.json`: every number behind the five-way charts in `blog/` and §11 of `REPORT.md`, one array per metric, in the order Nuxt/Vue, Next.js/React, Angular, Angular + Kotlin, Kotlin only.
- `lighthouse-simulated-five-stacks.json`: Lighthouse with its default simulated throttling (median of 3), dashboard and tasks pages, mobile and desktop, all five stacks as first built.
- `agent-stats.json`: AI build time, tokens and tool calls for each initial build.
- `initial-kotlin/<app>/`: raw results for the two Kotlin variants (runtime suite, time-to-data, board render, heap after the board, detached elements, hidden routes, lines of code, complexity, structure, quality gates, bundle).
- `runtime-*.json`, `complexity-*.json`, `loc-split-*.json`, `build-*.json`, `bundles.jsonl`: Nuxt/Vue, Next.js/React and Angular after the second run (compression on, Nuxt board cap removed).
- `first-run/`: Nuxt/Vue, Next.js/React and Angular exactly as delivered (first run).
- `investigation/`: real-throttled Lighthouse and time-to-data measurements behind the blog's investigations.

The growth experiment's data (five feature requests on all five stacks) is in `../growth/data/`.
