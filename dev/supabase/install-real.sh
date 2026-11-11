#!/usr/bin/env bash
# Install and start the real Supabase (Omicron's own data), next to the test
# one, inside the omicron-dev test machine. Run inside it:
#   bash ~/omicron/dev/supabase/install-real.sh
#
# Same self-hosted Supabase as install.sh, with its own random keys, at
# ~/supabase-real, on other ports (API 8100, Postgres 5532 and 6643), and with
# its own container names so the two can run side by side. Tests never touch
# it; migrate.sh won't reset it.
set -euo pipefail
dir=$HOME/supabase-real

if [ ! -f "$dir/.env" ]; then
  work=$(mktemp -d)
  curl -fsSL https://raw.githubusercontent.com/supabase/supabase/master/docker/setup.sh -o "$work/setup.sh"
  (cd "$work" && sh setup.sh -y --skip-deps --project-dir supabase)
  mkdir -p "$dir"
  find "$dir" -mindepth 1 -delete
  cp -a "$work/supabase/." "$dir/"
  rm -rf "$work"

  cd "$dir"
  # Own container names. Realtime's name is also how its gateway reaches it
  # (and the part before the first dot names its tenant), so it's changed
  # everywhere it appears.
  sed -i 's/container_name: supabase-/container_name: omicron-supabase-/' docker-compose.yml
  grep -rl 'realtime-dev.supabase-realtime' docker-compose.yml volumes/api | xargs sed -i 's/realtime-dev\.supabase-realtime/realtime-dev.omicron-realtime/g'
  sed -i 's/container_name: realtime-dev.supabase-realtime/container_name: realtime-dev.omicron-realtime/' docker-compose.yml
  set_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
  set_env COMPOSE_PROJECT_NAME omicron-real
  set_env API_GW_HTTP_PORT 8100
  set_env KONG_HTTP_PORT 8100
  set_env KONG_HTTPS_PORT 8543
  set_env POSTGRES_PORT 5532
  set_env POOLER_PROXY_PORT_TRANSACTION 6643
fi

cd "$dir"
sudo docker compose pull -q
sudo sh run.sh start
sudo docker compose ps --format 'table {{.Service}}\t{{.Status}}'
