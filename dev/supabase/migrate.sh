#!/usr/bin/env bash
# Apply Omicron's migrations to the VM's Supabase. Run inside the VM:
#   bash ~/omicron/dev/supabase/migrate.sh          # apply new migrations
#   bash ~/omicron/dev/supabase/migrate.sh --reset  # drop Omicron's data and start over
#   OMICRON_SUPABASE_DIR=~/supabase-real bash ~/omicron/dev/supabase/migrate.sh  # the real one
set -euo pipefail
dir=${OMICRON_SUPABASE_DIR:-$HOME/supabase}
cd "$dir"
psql() { sudo docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

if [ "${1:-}" = "--reset" ] && [ "$dir" != "$HOME/supabase" ]; then
  echo "migrate: --reset only works on the test Supabase (~/supabase), never on $dir" >&2
  exit 1
fi
if [ "${1:-}" = "--reset" ]; then
  psql <<'SQL'
drop schema if exists public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
delete from auth.users where email like '%.omicron.invalid';
drop schema if exists omicron_private cascade;
SQL
fi

# Kept out of the public schema, so the REST API never shows it.
psql -c "create schema if not exists omicron_private; create table if not exists omicron_private.migrations (name text primary key, applied_at timestamptz not null default now())"
for f in "$HOME"/omicron/supabase/migrations/*.sql; do
  name=$(basename "$f")
  done_already=$(psql -tA -c "select 1 from omicron_private.migrations where name = '$name'")
  [ -n "$done_already" ] && continue
  { echo "begin;"; cat "$f"; echo "insert into omicron_private.migrations (name) values ('$name'); commit;"; } | psql
  echo "applied $name"
done
# Tell the REST API about the new tables.
psql -c "notify pgrst, 'reload schema'"
# The reload happens in the background. Wait until the API can see the tables,
# so whatever runs next doesn't hit "table not found".
key=$(grep -E '^ANON_KEY=' .env | cut -d= -f2-)
for _ in $(seq 30); do
  port=$(grep -E '^API_GW_HTTP_PORT=' .env | cut -d= -f2-)
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $key" "http://localhost:${port:-8000}/rest/v1/projects?limit=0")
  # 404 means the API doesn't know the table yet. Anything else (even "not
  # allowed") means it does.
  [ "$code" != 404 ] && [ "$code" != 000 ] && exit 0
  sleep 0.5
done
echo "migrate: the API still can't see the tables after 15 seconds" >&2
exit 1
