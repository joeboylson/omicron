#!/usr/bin/env bash
# Run the browser tests (e2e/, Playwright) on this Mac against Omicron's one
# Supabase, then clean up everything the run made, like scripts/test.sh.
# Each test file starts its own `omicron serve` with its own settings and
# throwaway people and Projects; the Omicron Project is never touched.
#   bash scripts/e2e.sh                       every browser test
#   bash scripts/e2e.sh -g "drag"             only tests whose name matches
#   bash scripts/e2e.sh --project a11y        only the accessibility check
# Playwright and its Chromium go in ~/.cache/omicron-e2e the first time.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/test-run.sh
start_test_run

# The program with the web page inside (a debug build, for speed).
(
  cd web
  [ -d node_modules ] && [ node_modules -nt package.json ] || { npm install --silent --no-audit --no-fund && touch node_modules; }
  npx --no-install tsc --noEmit
  OMICRON_WEB_OUT="$PWD/dist" npx --no-install vite build --logLevel warn
)
OMICRON_WEB_DIST="$PWD/web/dist" cargo build -q
export OMICRON_BIN="${CARGO_TARGET_DIR:-$PWD/target}/debug/omicron"

deps=$HOME/.cache/omicron-e2e
mkdir -p "$deps"
if ! cmp -s e2e/package.json "$deps/package.json" || [ ! -d "$deps/node_modules" ]; then
  cp e2e/package.json "$deps/"
  (cd "$deps" && npm install --silent --no-audit --no-fund && npx --no-install playwright install chromium >/dev/null)
fi
export NODE_PATH=$deps/node_modules
cd e2e
# One test file at a time: the Mac's memory is shared with the home lab.
"$deps/node_modules/.bin/playwright" test --workers 1 --trace off "$@"
