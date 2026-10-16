# Investigation notes

- angular-kotlin baseline time-to-data 3.27 s vs Angular 1.23 s: caused by missing compression. The SSR server
  sends 475 KB of JS uncompressed (Angular original also shipped without compression; I added it to the Angular app
  in the earlier round). Without network throttling (4x CPU only) both show data at ~0.48-0.50 s. The Kotlin
  builder did not add compression; the Kotlin-only builder added gzip to its Ktor server unprompted.
- kotlin (Compose HTML) board with 5,000 cards: ~10 s and 117 MB (others 0.8-3.2 s).
- Kotlin round 4: both builders stopped by an account usage limit (~12:00), resumed 12:19 UTC. Round-4 durations for the Kotlin apps include this gap; use START/END from ISSUES.md minus the gap.
- FINAL STEP (user request): copy all data (spec, apps, bench scripts, results incl. raw, report, blog, growth analysis) to /home/user/react-vs-vue-vs-angular-vs-kotlin-compose-vs-kotlin-angular and push to main.
- ak-0 'slow first page change' (3.5-4.7 s in runtime suite) is not CPU: profile shows 4.4 s idle while Playwright waits for the pagination button; the '?seed' toast covers the pagination controls for ~5 s in the initial Angular+Kotlin build. Not present in the final version.
