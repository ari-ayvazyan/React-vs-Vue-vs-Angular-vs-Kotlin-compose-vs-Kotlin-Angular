#!/usr/bin/env bash
# Duplicated code (jscpd) over exactly the files structure.mjs measured. Usage: growth/dup.sh <app_dir> <structure.json> <out_dir>
set -e
app=$(realpath "$1"); out=$(realpath -m "$3"); tmp=$(mktemp -d)
node -e "for (const f of require('$(realpath "$2")').fileList) console.log(f)" | while read f; do mkdir -p "$tmp/$(dirname "$f")"; cp "$app/$f" "$tmp/$f"; done
cd "$(dirname "$0")/.."
bunx jscpd "$tmp" --silent --min-tokens 50 --formats-exts "kotlin:kt;typescript:ts;tsx:tsx;javascript:js,mjs;markup:html,vue;css:css,scss" --reporters json --output "$out" >/dev/null 2>&1 || true
rm -rf "$tmp"
