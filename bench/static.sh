#!/usr/bin/env bash
# Usage: ./static.sh <name> <app_dir>   -> LOC, complexity, deps, build time, bundle size
set -u
name=$1; app=$(realpath "$2"); out=$(realpath results)/static-$name; mkdir -p "$out"
EXC="node_modules,.nuxt,.output,.next,dist,.angular,out,coverage,public"
CLOC="bunx cloc"
$CLOC "$app" --exclude-dir=$EXC --not-match-f='(package(-lock)?\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|DEVLOG\.md|RUN\.md|README\.md|next-env\.d\.ts)$' --json > "$out/cloc-all.json"
# app source only (no tests, no config)
$CLOC "$app" --exclude-dir=$EXC,tests,test,__tests__,e2e --not-match-f='(\.spec\.ts|\.test\.ts|\.test\.tsx|package(-lock)?\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|\.md|config\.(ts|mjs|js)|\.json|next-env\.d\.ts)$' --json > "$out/cloc-src.json"
# tests only
find "$app" -path '*/node_modules' -prune -o \( -name '*.spec.ts' -o -name '*.test.ts' -o -name '*.test.tsx' \) -print | xargs cat 2>/dev/null | grep -cv '^\s*$' > "$out/test-loc.txt"
# Complexity: extract <script> from .vue into temp .ts for lizard
tmp=$(mktemp -d); cd "$app"
find . -path ./node_modules -prune -o -name '*.vue' -print | while read f; do mkdir -p "$tmp/$(dirname $f)"; sed -n '/<script/,/<\/script>/p' "$f" | sed '1d;$d' > "$tmp/$f.ts"; done
python3 -m lizard "$app" "$tmp" -x '*/node_modules/*' -x '*/.nuxt/*' -x '*/.output/*' -x '*/.next/*' -x '*/dist/*' -x '*/.angular/*' -x '*.spec.ts' -x '*.test.ts*' -l typescript -l javascript --csv > "$out/lizard.csv" 2>/dev/null
rm -rf "$tmp"
# deps
node -e "const p=require('$app/package.json');console.log(JSON.stringify({deps:Object.keys(p.dependencies||{}),devDeps:Object.keys(p.devDependencies||{})}))" > "$out/deps.json"
du -sm "$app/node_modules" | cut -f1 > "$out/node_modules_mb.txt"
ls "$app/node_modules" | wc -l > "$out/node_modules_toplevel.txt"
# clean build timing
rm -rf .nuxt .output .next dist .angular
s=$(date +%s.%N); bun run build > "$out/build.log" 2>&1; rc=$?; e=$(date +%s.%N)
echo "{\"rc\":$rc,\"seconds\":$(echo "$e - $s" | bc)}" > "$out/build.json"
