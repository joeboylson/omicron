# Shared by scripts/test.sh and scripts/e2e.sh: run tests against the
# Supabase scripts/test.conf names (the tests' own one on this Mac, or
# Omicron's hosted one) and clean up what they made afterwards
# (scripts/lib/clean.py). Source it.

# This folder, so clean-up works wherever the script has moved to since.
test_run_lib=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$test_run_lib/../test.conf"

# The settings file clean-up reads the address and key from.
test_db_config() {
  if [ "$OMICRON_TEST_DB" = local ]; then
    echo "$HOME/.cache/omicron-test-db.json"
  else
    echo "$HOME/.omicron/config.json"
  fi
}

clean() {
  # Sessions and daemons the tests left going (a failed test skips its own
  # tidying up), then what they made in Supabase.
  python3 "$test_run_lib/stop_test_hosts.py" "$test_run_lib/../.." "$1" || true
  OMICRON_CONFIG=$(test_db_config) python3 "$test_run_lib/clean.py" "$1"
}

# Point a test run at the test Supabase (starting the local one if it isn't
# running), start the clock for clean-up, and clean up when the script
# exits, however it exits.
start_test_run() {
  case "$OMICRON_TEST_DB" in
    local)
      eval "$(bash "$test_run_lib/../test-db.sh" env)"
      mkdir -p "$HOME/.cache"
      python3 -c '
import json, os, sys
e = os.environ
json.dump({"supabase_url": e["OMICRON_SUPABASE_URL"], "supabase_key": e["OMICRON_SUPABASE_KEY"], "supabase_secret_key": e["OMICRON_SUPABASE_SECRET_KEY"]}, open(sys.argv[1], "w"))
' "$(test_db_config)"
      ;;
    hosted)
      eval "$(python3 -c '
import json, os, shlex
c = json.load(open(os.path.expanduser("~/.omicron/config.json")))
for k, v in [("OMICRON_SUPABASE_URL", c["supabase_url"]), ("OMICRON_SUPABASE_KEY", c["supabase_key"]), ("OMICRON_SUPABASE_SECRET_KEY", c["supabase_secret_key"])]:
    print("export %s=%s" % (k, shlex.quote(v)))
')"
      ;;
    *)
      echo "OMICRON_TEST_DB is \"$OMICRON_TEST_DB\"; scripts/test.conf says what it can be (local or hosted)" >&2
      exit 2
      ;;
  esac
  echo "tests: on the $OMICRON_TEST_DB Supabase ($OMICRON_SUPABASE_URL)" >&2
  export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
  # Tests decide who's on Tailscale themselves (a status file); this Mac's own
  # Tailscale login (Joe) must never leak into them, so `tailscale` fails here.
  fake=$(mktemp -d)
  printf '#!/bin/sh\necho "no Tailscale in tests" >&2\nexit 1\n' > "$fake/tailscale"
  chmod +x "$fake/tailscale"
  export PATH="$fake:$PATH"
  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  trap 'clean "$since"; rm -rf "$fake"' EXIT
}
# Build `omicron` with the web page inside (a debug build, for speed), and
# Playwright (in ~/.cache/omicron-e2e, the first time), for the browser tests
# and screenshots.
build_for_browser() {
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
}
