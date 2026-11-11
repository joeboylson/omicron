#!/usr/bin/env bash
# Run the Rust tests on this Mac against Omicron's one Supabase (the real
# one, in Colima), then clean up everything the run made. Tests make their
# own throwaway people, machines and Projects (people log in as
# <name>-<random>@example.com), so the Omicron Project is never touched.
#   bash scripts/test.sh                    every Rust test
#   bash scripts/test.sh --test sessions    one test file (cargo test arguments)
#   bash scripts/test.sh --clean-only       just clean up (after an interrupted run)
set -euo pipefail
cd "$(dirname "$0")/.."
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

if [ "${1:-}" = "--clean-only" ]; then
  clean "${2:?say since when, like '2026-11-11 16:00'}"
  exit 0
fi

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
cargo test "$@"
