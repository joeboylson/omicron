#!/usr/bin/env bash
# Copy the real Supabase (the database and uploaded files) to this Mac,
# outside Colima, and keep 21 days of copies. Run on the Mac:
#   bash scripts/backup.sh             make a copy now
#   bash scripts/backup.sh --install   make one every night at 03:17 (launchd)
# Copies go to $OMICRON_BACKUP_DIR (default ~/.omicron/backups), as
# <date>.dump (the database) and <date>-files.tgz (comment images).
# Restore with scripts/restore.sh.
set -euo pipefail
dir=${OMICRON_BACKUP_DIR:-$HOME/.omicron/backups}
db=${OMICRON_DB_CONTAINER:-omicron-supabase-db}
files=${OMICRON_STORAGE_CONTAINER:-omicron-supabase-storage}
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

if [ "${1:-}" = "--install" ]; then
  plist=$HOME/Library/LaunchAgents/com.omicron.backup.plist
  mkdir -p "$(dirname "$plist")" "$dir"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.omicron.backup</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$(cd "$(dirname "$0")" && pwd)/backup.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>17</integer></dict>
  <key>StandardOutPath</key><string>$dir/backup.log</string>
  <key>StandardErrorPath</key><string>$dir/backup.log</string>
</dict></plist>
PLIST
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist"
  echo "A copy will be made every night at 03:17 ($plist). Log: $dir/backup.log"
  exit 0
fi

mkdir -p "$dir"
stamp=$(date +%Y-%m-%d-%H%M)
# Written under a temporary name, so a half-made copy never looks finished.
docker exec "$db" pg_dump -U postgres -Fc --no-owner postgres > "$dir/.$stamp.dump"
docker exec "$files" tar -C /var/lib/storage -czf - . > "$dir/.$stamp-files.tgz"
mv "$dir/.$stamp.dump" "$dir/$stamp.dump"
mv "$dir/.$stamp-files.tgz" "$dir/$stamp-files.tgz"
find "$dir" -maxdepth 1 \( -name '*.dump' -o -name '*-files.tgz' \) -mtime +21 -delete
echo "$(date '+%F %T') saved $dir/$stamp.dump ($(du -h "$dir/$stamp.dump" | cut -f1)) and $stamp-files.tgz"
