#!/usr/bin/env bash
# Put a copy made by scripts/backup.sh back. Run on the Mac:
#   bash scripts/restore.sh <date> --scratch   into a separate database
#                                            (omicron_restore) to look at it;
#                                            the real one isn't touched
#   bash scripts/restore.sh <date> --real      over the real database and
#                                            files (stop the daemon and web
#                                            page first)
# <date> is the copy's name, like 2026-11-11-0317 (ls ~/.omicron/backups),
# or "latest".
set -euo pipefail
dir=${OMICRON_BACKUP_DIR:-$HOME/.omicron/backups}
db=${OMICRON_DB_CONTAINER:-omicron-supabase-db}
files=${OMICRON_STORAGE_CONTAINER:-omicron-supabase-storage}
stamp=${1:?say which copy, like 2026-11-11-0317 or latest}
mode=${2:?say --scratch or --real}
if [ "$stamp" = latest ]; then
  stamp=$(ls "$dir"/*.dump | sort | tail -1 | xargs basename | sed 's/\.dump$//')
fi
dump=$dir/$stamp.dump
[ -f "$dump" ] || { echo "there's no copy $dump"; exit 1; }
psql() { docker exec -i "$db" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

case "$mode" in
  --scratch)
    psql -c "drop database if exists omicron_restore" -c "create database omicron_restore"
    # Supabase's own extensions complain about owners; the data still comes back.
    docker exec -i "$db" pg_restore -U postgres -d omicron_restore --no-owner < "$dump" 2>/dev/null || true
    echo "Restored $stamp into omicron_restore:"
    psql -d omicron_restore -tAc "select format('%s Projects, %s tasks, %s comments, %s sessions', (select count(*) from public.projects), (select count(*) from public.tasks), (select count(*) from public.comments), (select count(*) from public.sessions))"
    ;;
  --real)
    read -r -p "Replace the real database and files with $stamp? Type yes: " answer
    [ "$answer" = yes ] || { echo "Left as it is."; exit 1; }
    docker exec -i "$db" pg_restore -U postgres -d postgres --clean --if-exists --no-owner < "$dump" 2>/dev/null || true
    docker exec -i "$files" sh -c 'rm -rf /var/lib/storage/* && tar -C /var/lib/storage -xzf -' < "$dir/$stamp-files.tgz"
    echo "Restored $stamp. Start the daemon and web page again (bash dev/mac.sh)."
    ;;
  *) echo "say --scratch or --real"; exit 1 ;;
esac
