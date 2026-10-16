#!/usr/bin/env bash
# Mobile Lighthouse for each app behind the gzip proxy, 3 runs per page.
cd "$(dirname "$0")"; mkdir -p results/lh-gzip
export CHROME_PATH=/opt/pw-browsers/chromium
for spec in nuxt:3001 next:3002 angular:3003; do
  name=${spec%%:*}; port=${spec##*:}; pport=$((port+100))
  (cd ../apps/$name-app && PORT=$port nohup bun run start:prod > /dev/null 2>&1 &)
  node gzip-proxy.mjs $pport $port > /dev/null 2>&1 & proxy=$!
  for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:$pport/dashboard && break; sleep 1; done
  for path in dashboard tasks; do for i in 1 2 3; do
    bunx lighthouse "http://localhost:$pport/$path" --quiet --output=json --output-path="results/lh-gzip/$name-$path-mobile-$i.json" \
      --chrome-flags="--headless=new --no-sandbox --disable-gpu" >/dev/null 2>&1 || echo "fail $name $path $i"
  done; done
  kill $proxy; fuser -k $port/tcp >/dev/null 2>&1; sleep 2; echo "$name done"
done
