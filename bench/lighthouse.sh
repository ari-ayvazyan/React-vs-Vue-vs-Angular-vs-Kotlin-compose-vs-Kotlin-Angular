#!/usr/bin/env bash
# Usage: ./lighthouse.sh <name> <port>   -> 3 runs each for mobile+desktop on /dashboard and /tasks
set -u
name=$1; port=$2
mkdir -p results/lh
export CHROME_PATH=/opt/pw-browsers/chromium
for path in dashboard tasks; do
  for form in mobile desktop; do
    for i in 1 2 3; do
      preset=""; [ "$form" = desktop ] && preset="--preset=desktop"
      bunx lighthouse "http://localhost:$port/$path" $preset --quiet --output=json \
        --output-path="results/lh/$name-$path-$form-$i.json" \
        --chrome-flags="--headless=new --no-sandbox --disable-gpu" >/dev/null 2>&1 || echo "LH fail $name $path $form $i"
    done
  done
done
