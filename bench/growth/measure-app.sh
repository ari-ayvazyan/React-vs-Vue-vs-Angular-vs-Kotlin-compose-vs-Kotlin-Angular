#!/usr/bin/env bash
# Measure one app. Usage: growth/measure-app.sh <name> <app_dir> <port> <bundle_dir> <out_dir> [prev_git_tag] [--no-perf]
cd "$(dirname "$0")/.."
a=$1; app=$2; p=$3; d=$4; o=$5; prev=$6; noperf=$7
mkdir -p $o
node loc-split.mjs $a $app >/dev/null && cp results/loc-split-$a.json $o/loc.json
node growth/structure.mjs $a $app $o/structure.json
rm -rf $o/jscpd; growth/dup.sh $app $o/structure.json $o/jscpd
python3 growth/complexity.py $o/structure.json $app $o/complexity.json
rel=$(realpath --relative-to=.. $app)
if [ -n "$prev" ]; then
  git -C .. diff --numstat $prev -- $rel ':!*.lock' ':!*lock.json' ':!*.md' ':!**/package.json' > $o/churn.txt
  git -C .. ls-files --others --exclude-standard $rel | grep -v -E '\.md$|lock' > $o/churn-new-files.txt
fi
( cd $app
  bun run lint > /dev/null 2>&1; l=$?
  bun run test > test.log 2>&1; t=$?
  tests=$(sed -E 's/\x1b\[[0-9;]*m//g' test.log | grep -E '^ *Tests +[0-9]+ passed' | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1)
  [ -z "$tests" ] && tests=$(find . -path ./node_modules -prune -o -path '*/build/test-results/*' -name 'TEST-*.xml' -print 2>/dev/null | xargs grep -ho 'tests="[0-9]*"' 2>/dev/null | grep -oE '[0-9]+' | paste -sd+ | bc)
  rm -f test.log
  rm -rf .nuxt .output .next dist .angular
  for g in ./gradlew ./core/gradlew; do [ -x $g ] && (cd $(dirname $g) && ./gradlew clean -q > /dev/null 2>&1); done
  s=$(date +%s.%N); bun run build > /dev/null 2>&1; b=$?; e=$(date +%s.%N)
  echo "{\"lint_rc\":$l,\"test_rc\":$t,\"tests_passed\":${tests:-0},\"build_rc\":$b,\"build_s\":$(echo "$e - $s" | bc)}" ) > $o/quality.json
gz=0; for f in $(find $d -name '*.js' 2>/dev/null); do gz=$((gz + $(gzip -9c $f | wc -c))); done
echo "{\"js_gz_kb\":$((gz/1024)),\"js_files\":$(find $d -name '*.js' 2>/dev/null | wc -l)}" > $o/bundle.json
echo "$a static done: $(cat $o/quality.json) $(cat $o/bundle.json)"
[ "$noperf" = "--no-perf" ] && exit 0
fuser -k $p/tcp >/dev/null 2>&1
(cd $app && PORT=$p nohup bun run start:prod > /dev/null 2>&1 &)
for i in $(seq 90); do curl -sf -o /dev/null localhost:$p/dashboard && break; sleep 1; done
node runtime.mjs growth-$a $p 3 > /dev/null 2>&1; mv results/runtime-growth-$a.json $o/runtime.json 2>/dev/null
node investigate/time-to-data.mjs $p > $o/time-to-data.json 2>/dev/null
node investigate/board-time.mjs $p > $o/board.json 2>/dev/null
fuser -k $p/tcp >/dev/null 2>&1; sleep 1
echo "$a perf done: $(cat $o/time-to-data.json) $(cat $o/board.json)"
