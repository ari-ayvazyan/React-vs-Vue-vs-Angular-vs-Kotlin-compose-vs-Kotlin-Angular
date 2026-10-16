#!/usr/bin/env bash
# Commit, tag and measure one Kotlin experiment round. Usage: growth/kround.sh <angular-kotlin|kotlin> <N> "<commit title>"
cd "$(dirname "$0")/../.."
a=$1; n=$2; title=$3
case $a in angular-kotlin) t=ak; p=3004; d=apps/angular-kotlin-app/dist/angular-kotlin-app/browser;; kotlin) t=k; p=3005; d=apps/kotlin-app/web/build/dist/js/productionExecutable;; esac
git add -A apps && git commit -qm "$title

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013JP1UN2jKp9nLa8begAgFE"
git tag $t-$n && git push -q origin ccr-0dce65d5-48srep
cd bench && growth/measure-app.sh $a ../apps/$a-app $p ../$d results/growth/iter-$n/$a $t-$((n-1)) 2>&1 | grep -v Killed
awk '$3 !~ /\.md$|lock|package\.json|tests?\/|Test|\.spec\.|\.test\./ {f++; ad+=$1; de+=$2} END {print "src files changed:", f, "+"ad, "-"de}' results/growth/iter-$n/$a/churn.txt
