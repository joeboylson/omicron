#!/usr/bin/env bash
# The tests' own Supabase on this Mac (dev/test-db), in the Docker named in
# scripts/test.conf. scripts/test.sh starts it when needed; this is for
# doing it by hand.
#   bash scripts/test-db.sh start    start it (the first time takes a while)
#   bash scripts/test-db.sh stop     stop it (its data is kept)
#   bash scripts/test-db.sh reset    start over: empty, with the migrations
#   bash scripts/test-db.sh status   is it running, and its address
#   bash scripts/test-db.sh env      its address and keys, as shell exports
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/test.conf
workdir=dev/test-db

use_docker() {
  if [ -n "$OMICRON_TEST_DOCKER" ]; then
    if [ "$OMICRON_TEST_DOCKER" = colima ] && ! colima status >/dev/null 2>&1; then
      colima start >&2
    fi
    export DOCKER_CONTEXT=$OMICRON_TEST_DOCKER
  fi
  docker info >/dev/null 2>&1 || {
    echo "test-db: Docker${OMICRON_TEST_DOCKER:+ ($OMICRON_TEST_DOCKER)} isn't running. Start it, or set OMICRON_TEST_DOCKER in scripts/test.conf." >&2
    exit 1
  }
}

running() {
  supabase status --workdir "$workdir" >/dev/null 2>&1
}

case "${1:-status}" in
  start)
    use_docker
    running || supabase start --workdir "$workdir" >&2
    ;;
  stop)
    use_docker
    supabase stop --workdir "$workdir" >&2
    ;;
  reset)
    use_docker
    running || supabase start --workdir "$workdir" >&2
    supabase db reset --local --workdir "$workdir" >&2
    ;;
  status)
    use_docker
    if running; then
      supabase status --workdir "$workdir" -o json | python3 -c 'import json,sys; print("running at", json.load(sys.stdin)["API_URL"])'
    else
      echo "not running (start it with: bash scripts/test-db.sh start)"
    fi
    ;;
  env)
    use_docker
    running || supabase start --workdir "$workdir" >&2
    supabase status --workdir "$workdir" -o json | python3 -c '
import json, shlex, sys
s = json.load(sys.stdin)
key = s.get("PUBLISHABLE_KEY") or s["ANON_KEY"]
secret = s.get("SECRET_KEY") or s["SERVICE_ROLE_KEY"]
for k, v in [("OMICRON_SUPABASE_URL", s["API_URL"]), ("OMICRON_SUPABASE_KEY", key), ("OMICRON_SUPABASE_SECRET_KEY", secret)]:
    print("export %s=%s" % (k, shlex.quote(v)))
'
    ;;
  *)
    echo "usage: $0 start|stop|reset|status|env" >&2
    exit 2
    ;;
esac
