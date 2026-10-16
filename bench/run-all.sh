#!/usr/bin/env bash
# Runs runtime + lighthouse + screenshots for one app at a time against its production server.
cd "$(dirname "$0")"
for spec in nuxt:3001 next:3002 angular:3003; do
  name=${spec%%:*}; port=${spec##*:}
  (cd ../apps/$name-app && PORT=$port nohup bun run start:prod > ../../bench/results/server-$name.log 2>&1 & echo $! > ../../bench/results/server-$name.pid)
  for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:$port/dashboard && break; sleep 1; done
  echo "== $name up"
  node runtime.mjs $name $port 5 > results/runtime-$name.log 2>&1; echo "runtime rc=$?"
  ./lighthouse.sh $name $port; echo "lighthouse done"
  node shots.mjs $name $port > results/shots-$name.log 2>&1; echo "shots rc=$?"
  pkill -P $(cat results/server-$name.pid) 2>/dev/null; kill $(cat results/server-$name.pid) 2>/dev/null
  fuser -k $port/tcp 2>/dev/null; sleep 2
done
echo ALL DONE
