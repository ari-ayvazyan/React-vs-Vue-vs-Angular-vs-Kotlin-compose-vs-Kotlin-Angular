#!/bin/sh
# Runs the Angular CLI on Node >= 22.22.3 (required by Angular CLI 22).
# The sandbox ships Node 22.22.0, so a pinned Node 24 is installed as the npm package "node"
# (devDependency) and put first on PATH so that the CLI and its worker processes use it.
DIR=$(cd "$(dirname "$0")/.." && pwd)
if [ -x "$DIR/node_modules/node/bin/node" ]; then
  PATH="$DIR/node_modules/node/bin:$PATH"
  export PATH
fi
exec node "$DIR/node_modules/@angular/cli/bin/ng.js" "$@"
