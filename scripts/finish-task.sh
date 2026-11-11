#!/usr/bin/env bash
# Finish an Omicron task the way a Claude session does: tick its whole
# checklist, post the report (with screenshots) marked for review, and move
# it to Review. Run on the Mac, after committing and pushing:
#   bash scripts/finish-task.sh <number> "<report>" [image ...]
# Commit <hash> is added to the report from the last commit. The Project
# is Omicron unless OMICRON_PROJECT says otherwise.
set -euo pipefail
n=$1; report=$2; shift 2
project=${OMICRON_PROJECT:-Omicron}
cd "$(dirname "$0")/.."
items=$(omicron tasks show "$project" "$n" | grep -cE '^  [0-9]+\. \[ \]' || true)

for line in $(omicron tasks show "$project" "$n" | grep -oE '^  [0-9]+\. \[ \]' | grep -oE '[0-9]+'); do
  omicron tasks tick "$project" "$n" "$line" >/dev/null
done
args=()
for img in "$@"; do args+=(--image "$img"); done
omicron tasks comment "$project" "$n" "$report Commit $(git rev-parse --short HEAD)." --review --as-machine "${args[@]}" >/dev/null
omicron tasks move "$project" "$n" Review | sed -n 1,3p
echo "(ticked $items checklist items)"
