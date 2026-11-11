#!/usr/bin/env bash
# Set up (or update) Omicron's tables in any Supabase, from its database
# connection string:
#   bash scripts/migrate.sh "postgresql://postgres:<password>@<host>:5432/postgres"
# Applies each file in supabase/migrations once, in order, and remembers
# which it applied (in the omicron_private schema), so running it again only
# applies new ones. Needs psql.
set -euo pipefail
db=${1:?give the database connection string (Supabase: Project Settings > Database)}
cd "$(dirname "$0")/.."
psql() { command psql "$db" -v ON_ERROR_STOP=1 -q "$@"; }
psql -c "create schema if not exists omicron_private; create table if not exists omicron_private.migrations (name text primary key, applied_at timestamptz not null default now())"
for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  [ -n "$(psql -tA -c "select 1 from omicron_private.migrations where name = '$name'")" ] && continue
  { echo "begin;"; cat "$f"; echo "insert into omicron_private.migrations (name) values ('$name'); commit;"; } | psql
  echo "applied $name"
done
# Tell Supabase's REST API about new tables.
psql -c "notify pgrst, 'reload schema'"
echo "Omicron's tables are up to date."
