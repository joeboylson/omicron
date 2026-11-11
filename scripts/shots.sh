#!/usr/bin/env bash
# Screenshots of the dev web page (seeded data), desktop and phone, copied to
# a folder on this Mac. Run on the Mac:
#   bash scripts/shots.sh [folder]     (default: /tmp/omicron-shots)
# Reseed first if tests ran since: docker exec -u ubuntu omicron-dev bash /home/ubuntu/omicron/dev/seed/seed.sh
set -euo pipefail
out=${1:-/tmp/omicron-shots}
mkdir -p "$out"
docker exec -u ubuntu omicron-dev bash -c 'rm -rf ~/omicron-e2e-results/seed-shots; NODE_PATH=~/omicron-e2e-deps/node_modules node ~/omicron/dev/seed/shots.js'
docker cp omicron-dev:/home/ubuntu/omicron-e2e-results/seed-shots/. "$out/"
ls "$out"/*.png
