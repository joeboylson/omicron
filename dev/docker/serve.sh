#!/usr/bin/env bash
# Run the test Web Machine that the home lab puts on the tailnet, admin only:
#   https://atlas.taileedd95.ts.net:8451  (tailscale serve → Caddy gate → here)
# Run on the Mac:
#   bash dev/docker/serve.sh          # (re)start it with the current code
#   bash dev/docker/serve.sh stop
#
# It runs in the omicron-dev container on 127.0.0.1:9010, with its own
# settings folder, and uses the test Supabase through its tailnet address
# (https://atlas.taileedd95.ts.net:8450), because visitors' browsers talk to
# Supabase directly. MagicDNS doesn't resolve inside the container, so the
# name is added to its /etc/hosts.
set -euo pipefail
host=atlas.taileedd95.ts.net
ip=100.106.116.96
port=9010
supabase_url=https://$host:8450

docker exec omicron-dev bash -c 'pkill -f "[o]micron-serve/omicron serve" || true'
[ "${1:-}" = stop ] && { echo "stopped"; exit 0; }

docker exec -u root omicron-dev bash -c "grep -q ' $host\$' /etc/hosts || echo '$ip $host' >> /etc/hosts"
docker exec -u ubuntu omicron-dev bash -lc "
  set -euo pipefail
  cd ~/omicron
  export OMICRON_WEB_DIST=\$(bash dev/web.sh)
  CARGO_TARGET_DIR=~/target ~/.cargo/bin/cargo build -q
  mkdir -p ~/omicron-serve
  # A copy, so test builds don't swap the program under it.
  cp ~/target/debug/omicron ~/omicron-serve/omicron
  env_value() { grep -E \"^\$1=\" ~/supabase/.env | head -1 | cut -d= -f2-; }
  OMICRON_HOME=~/omicron-serve ~/omicron-serve/omicron setup --url $supabase_url \
    --key \"\$(env_value ANON_KEY)\" --secret-key \"\$(env_value SERVICE_ROLE_KEY)\" >/dev/null
  cd ~/omicron-serve
  OMICRON_HOME=~/omicron-serve nohup ~/omicron-serve/omicron serve --port $port --host $host > serve.log 2>&1 &
"
sleep 1
docker exec -u ubuntu omicron-dev bash -lc "cat ~/omicron-serve/serve.log; curl -s -o /dev/null -w 'index %{http_code}\n' -H 'Host: $host:8451' http://127.0.0.1:$port/"
