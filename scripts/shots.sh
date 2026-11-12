#!/usr/bin/env bash
# Screenshots of the web page full of made-up data, desktop and phone, for
# looking at UI changes. Run on the Mac:
#   bash scripts/shots.sh [folder]     (default: /tmp/omicron-shots)
# It starts its own `omicron serve`, fills the one Supabase with throwaway
# people, machines and Projects (dev/seed/seed.js), takes the pictures
# (dev/seed/shots.js), and cleans it all up after, like scripts/e2e.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
out=${1:-/tmp/omicron-shots}
mkdir -p "$out"
rm -f "$out"/*.png
. scripts/lib/test-run.sh
start_test_run
build_for_browser
export SHOTS_OUT=$out
node dev/seed/shots.js
ls "$out"/*.png
