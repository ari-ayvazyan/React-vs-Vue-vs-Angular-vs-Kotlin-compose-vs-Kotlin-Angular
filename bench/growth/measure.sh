#!/usr/bin/env bash
# Measure all three apps for growth iteration N. Usage: growth/measure.sh <N>
# Static metrics for each app, then performance one app at a time on an otherwise idle machine.
cd "$(dirname "$0")/.."
N=$1; R=results/growth/iter-$N; mkdir -p $R
for a in nuxt next angular; do
  app=../apps/$a-app; o=$R/$a; mkdir -p $o
  node loc-split.mjs $a $app >/dev/null && cp results/loc-split-$a.json $o/loc.json
  node growth/structure.mjs $a $app $o/structure.json
  rm -rf $o/jscpd; growth/dup.sh $app $o/structure.json $o/jscpd
  python3 growth/complexity.py $o/structure.json $app $o/complexity.json
  # files and lines changed since the previous iteration (source only)
  if [ "$N" -gt 0 ]; then
    git -C .. diff --numstat growth-$((N-1)) -- apps/$a-app ':!*.lock' ':!*lock.json' ':!*.md' ':!**/package.json' > $o/churn.txt
    git -C .. diff --name-status growth-$((N-1)) -- apps/$a-app ':!*.lock' ':!*lock.json' ':!*.md' ':!**/package.json' > $o/churn-files.txt
    git -C .. ls-files --others --exclude-standard apps/$a-app | grep -v -E '\.md$|lock' >> $o/churn-files.txt
  fi
  # quality gates + timed clean build
  ( cd $app
    bun run lint > /dev/null 2>&1; l=$?
    bun run test > test.log 2>&1; t=$?; tests=$(sed -E 's/\x1b\[[0-9;]*m//g' test.log | grep -E '^ *Tests +[0-9]+ passed' | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1); rm -f test.log
    rm -rf .nuxt .output .next dist .angular
    s=$(date +%s.%N); bun run build > /dev/null 2>&1; b=$?; e=$(date +%s.%N)
    echo "{\"lint_rc\":$l,\"test_rc\":$t,\"tests_passed\":${tests:-0},\"build_rc\":$b,\"build_s\":$(echo "$e - $s" | bc)}" ) > $o/quality.json
  case $a in nuxt) d=$app/.output/public/_nuxt;; next) d=$app/.next/static;; angular) d=$app/dist/angular-app/browser;; esac
  gz=0; for f in $(find $d -name '*.js'); do gz=$((gz + $(gzip -9c $f | wc -c))); done
  echo "{\"js_gz_kb\":$((gz/1024)),\"js_files\":$(find $d -name '*.js' | wc -l)}" > $o/bundle.json
  echo "$a static done: $(cat $o/quality.json) $(cat $o/bundle.json)"
done
for spec in nuxt:3001 next:3002 angular:3003; do
  a=${spec%%:*}; p=${spec##*:}; o=$R/$a
  fuser -k $p/tcp >/dev/null 2>&1
  (cd ../apps/$a-app && PORT=$p nohup bun run start:prod > /dev/null 2>&1 &)
  for i in $(seq 60); do curl -sf -o /dev/null localhost:$p/dashboard && break; sleep 1; done
  node runtime.mjs growth-$a $p 3 > /dev/null 2>&1; mv results/runtime-growth-$a.json $o/runtime.json 2>/dev/null
  node investigate/time-to-data.mjs $p > $o/time-to-data.json 2>/dev/null
  node investigate/board-time.mjs $p > $o/board.json 2>/dev/null
  fuser -k $p/tcp >/dev/null 2>&1; sleep 1
  echo "$a perf done: $(cat $o/time-to-data.json) $(cat $o/board.json)"
done
echo "ITER $N DONE"
