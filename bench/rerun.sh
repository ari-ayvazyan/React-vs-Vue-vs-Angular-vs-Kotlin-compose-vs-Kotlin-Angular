#!/usr/bin/env bash
# Full re-run: timed clean builds x3, static stats, then runtime/lighthouse/screenshots one app at a time.
cd "$(dirname "$0")"
for a in nuxt next angular; do ./static.sh $a ../apps/$a-app; node loc-split.mjs $a ../apps/$a-app; done
for i in 1 2; do for a in nuxt next angular; do (cd ../apps/$a-app; rm -rf .nuxt .output .next dist .angular; s=$(date +%s.%N); bun run build >/dev/null 2>&1; echo "$a $i $(echo "$(date +%s.%N) - $s" | bc)") ; done; done > results/build-repeats.txt
./run-all.sh
echo RERUN DONE
