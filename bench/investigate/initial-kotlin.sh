#!/usr/bin/env bash
# Experiment-1 suite on the two Kotlin apps as first delivered (tags ak-0, k-0), same scripts as the original three.
cd "$(dirname "$0")/.."
W=/tmp/claude-0/-home-user-aa-empty-claude-agent/57ef4d1d-f980-5689-8203-93f7fbe7e395/scratchpad/initial
export CHROME_PATH=/opt/pw-browsers/chromium
mkdir -p results/lh-devtools results/initial-kotlin
for spec in angular-kotlin:3004:ak kotlin:3005:k; do
  IFS=: read a p t <<< "$spec"; o=results/initial-kotlin/$a; mkdir -p $o
  fuser -k $p/tcp >/dev/null 2>&1
  (cd $W/$t/apps/$a-app && PORT=$p nohup bun run start:prod > /dev/null 2>&1 &)
  for i in $(seq 90); do curl -sf -o /dev/null localhost:$p/dashboard && break; sleep 1; done
  node runtime.mjs $a $p 5 > /dev/null 2>&1; cp results/runtime-$a.json $o/runtime.json
  ./lighthouse.sh $a $p
  for i in 1 2 3 4 5; do bunx lighthouse http://localhost:$p/dashboard --throttling-method=devtools --only-categories=performance --quiet --output=json --output-path=results/lh-devtools/$a-$i.json --chrome-flags="--headless=new --no-sandbox --disable-gpu" >/dev/null 2>&1; done
  node investigate/time-to-data.mjs $p > $o/time-to-data.json 2>/dev/null
  node investigate/board-time.mjs $p > $o/board.json 2>/dev/null
  node investigate/gc-after-board.mjs $p > $o/gc-after-board.json 2>/dev/null
  node investigate/detached.mjs $p > $o/detached.json 2>/dev/null
  node investigate/hidden-routes.mjs $p > $o/hidden-routes.txt 2>/dev/null
  node shots.mjs $a $p > /dev/null 2>&1
  fuser -k $p/tcp >/dev/null 2>&1; sleep 2
  echo "$a done: $(cat $o/time-to-data.json) $(cat $o/board.json) $(cat $o/gc-after-board.json)"
done
echo INITIAL KOTLIN DONE
