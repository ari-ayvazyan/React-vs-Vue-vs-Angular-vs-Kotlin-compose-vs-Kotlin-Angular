#!/usr/bin/env bash
# Final quiet performance run for all five apps (nothing else running).
# Per app: time-to-data as delivered and behind a gzip proxy, 5k board render, interaction suite, real-throttled Lighthouse (3 runs).
cd "$(dirname "$0")/.."
O=results/growth/final-perf; mkdir -p $O
export CHROME_PATH=/opt/pw-browsers/chromium
for spec in nuxt:3001 next:3002 angular:3003 angular-kotlin:3004 kotlin:3005; do
  a=${spec%%:*}; p=${spec##*:}; pp=$((p+100)); o=$O/$a; mkdir -p $o
  fuser -k $p/tcp $pp/tcp >/dev/null 2>&1
  (cd ../apps/$a-app && PORT=$p nohup bun run start:prod > /dev/null 2>&1 &)
  for i in $(seq 90); do curl -sf -o /dev/null localhost:$p/dashboard && break; sleep 1; done
  node gzip-proxy.mjs $pp $p > /dev/null 2>&1 & px=$!
  sleep 1
  node investigate/time-to-data.mjs $p > $o/ttd-as-delivered.json 2>/dev/null
  node investigate/time-to-data.mjs $pp > $o/ttd-gzip.json 2>/dev/null
  node investigate/board-time.mjs $p > $o/board.json 2>/dev/null
  node runtime.mjs final-$a $p 3 > /dev/null 2>&1; mv results/runtime-final-$a.json $o/runtime.json 2>/dev/null
  curl -s -o /dev/null -w '%{size_download}' -H 'accept-encoding: gzip, br' localhost:$p/dashboard > $o/html-bytes.txt
  curl -s -D - -o /dev/null -H 'accept-encoding: gzip, br' localhost:$p/dashboard | grep -i content-encoding > $o/encoding.txt
  for i in 1 2 3; do bunx lighthouse http://localhost:$pp/dashboard --throttling-method=devtools --only-categories=performance --quiet --output=json --output-path=$o/lh-$i.json --chrome-flags="--headless=new --no-sandbox --disable-gpu" >/dev/null 2>&1; done
  kill $px 2>/dev/null; fuser -k $p/tcp >/dev/null 2>&1; sleep 2
  echo "$a: $(cat $o/ttd-as-delivered.json) | gzip $(cat $o/ttd-gzip.json) | $(cat $o/board.json) | enc: $(cat $o/encoding.txt | tr -d '\r\n')"
done
echo FINAL PERF DONE
