# Shared by scripts/test.sh and scripts/e2e.sh: the one Supabase's settings
# for tests, and the clean-up of everything a run made. Source it.
db=${OMICRON_DB_CONTAINER:-omicron-supabase-db}
env_file=/home/ubuntu/supabase-real/.env
key() { colima ssh -- grep -E "^$1=" "$env_file" | cut -d= -f2- | tr -d '\r'; }
psql() { docker exec -i "$db" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

# Everything made since the run started, except the Omicron Project and the
# people in it. Projects first (their tasks, sessions, teams and changes go
# with them), then machines and people (their logins go with them), then
# files filed under Projects that are gone.
clean() {
  local since=$1
  psql -v since="$since" <<'SQL'
\set ON_ERROR_STOP 1
begin;
create temp table keep_people as
  select m.person_id from public.project_members m join public.projects p on p.id = m.project_id where p.name = 'Omicron';
delete from public.projects where created_at >= :'since' and name <> 'Omicron';
-- Machines and people go by when their login was made: some tests backdate
-- a machine's own created_at (to look unseen for 30 days).
delete from auth.users where created_at >= :'since'
  and email like '%.omicron.invalid'
  and id not in (select person_id from keep_people);
-- Storage guards its files against deletes like this; it's on purpose here.
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'comment-images'
  and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
  and split_part(name, '/', 1)::uuid not in (select id from public.projects);
commit;
SQL
  echo "test.sh: cleaned up what the run made since $since"
}

# Point a test run at the one Supabase, start the clock for clean-up, and
# clean up when the script exits, however it exits.
start_test_run() {
  export OMICRON_SUPABASE_URL=http://127.0.0.1:8100
  export OMICRON_SUPABASE_KEY=$(key ANON_KEY)
  export OMICRON_SUPABASE_SECRET_KEY=$(key SERVICE_ROLE_KEY)
  # Lets tests talk to the database directly for cases the API can't set up.
  export OMICRON_TEST_PSQL="docker exec -i $db psql -U postgres -q -v ON_ERROR_STOP=1"
  export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
  # Tests decide who's on Tailscale themselves (a status file); this Mac's own
  # Tailscale login (Joe) must never leak into them, so `tailscale` fails here.
  fake=$(mktemp -d)
  printf '#!/bin/sh\necho "no Tailscale in tests" >&2\nexit 1\n' > "$fake/tailscale"
  chmod +x "$fake/tailscale"
  export PATH="$fake:$PATH"
  since=$(psql -tAc "select to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')" | tr -d '[:space:]')
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
