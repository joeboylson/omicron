#!/usr/bin/env bash
# Check `omicron daemon start-at-login` against a real systemd. Run on the
# Mac, after dev/docker/setup.sh and dev/supabase/install.sh:
#   bash dev/docker/systemd-test.sh
# Starts a throwaway container with systemd running, logs in a user there,
# registers it as a machine, and checks the daemon starts, shows as awake,
# comes back after being killed, and goes away with stop-at-login.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
name=omicron-systemd-test

docker exec -u ubuntu omicron-dev bash -lc 'cd ~/omicron && CARGO_TARGET_DIR=~/target ~/.cargo/bin/cargo build -q'
env_value() { docker exec omicron-dev grep -E "^$1=" /home/ubuntu/supabase/.env | head -1 | cut -d= -f2-; }
key=$(env_value ANON_KEY)
secret=$(env_value SERVICE_ROLE_KEY)

docker build -q -t "$name" "$here/systemd" >/dev/null
docker rm -f "$name" >/dev/null 2>&1 || true
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$name" --privileged --cgroupns=host --network host \
  --tmpfs /run --tmpfs /run/lock -v /sys/fs/cgroup:/sys/fs/cgroup:rw "$name" >/dev/null
docker cp omicron-dev:/home/ubuntu/target/debug/omicron /tmp/omicron-systemd-test-bin
docker cp /tmp/omicron-systemd-test-bin "$name":/usr/local/bin/omicron
rm -f /tmp/omicron-systemd-test-bin

for _ in $(seq 30); do
  docker exec "$name" systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded' && break
  sleep 1
done
# Like a machine that just booted with linger on: pat's systemd runs
# without pat logging in.
uid=$(docker exec "$name" id -u pat)
docker exec "$name" loginctl enable-linger pat
docker exec "$name" systemctl start "user@$uid"
for _ in $(seq 30); do docker exec "$name" test -S "/run/user/$uid/bus" && break; sleep 1; done

as_pat() { docker exec -u pat -e XDG_RUNTIME_DIR="/run/user/$uid" -e HOME=/home/pat -w /home/pat "$name" "$@"; }
machine="systemd-test-$(date +%s)"
as_pat omicron setup --url http://localhost:8000 --key "$key" --secret-key "$secret" >/dev/null
as_pat omicron machines register "$machine" >/dev/null

as_pat omicron daemon start-at-login
awake() {
  for _ in $(seq 20); do
    as_pat omicron machines awake 2>/dev/null | grep -qx "$machine" && return 0
    sleep 1
  done
  return 1
}
as_pat systemctl --user is-active omicron-daemon.service
awake && echo "PASS: $machine shows as awake"

as_pat systemctl --user kill --signal=KILL omicron-daemon.service
as_pat test -f /home/pat/.omicron/daemon.log && echo "PASS: errors go to daemon.log"
sleep 35
as_pat systemctl --user is-active omicron-daemon.service && awake && echo "PASS: it came back after being killed"

as_pat omicron daemon stop-at-login
if as_pat systemctl --user is-active omicron-daemon.service >/dev/null 2>&1; then
  echo "FAIL: still running after stop-at-login"; exit 1
fi
as_pat test ! -e /home/pat/.config/systemd/user/omicron-daemon.service
echo "PASS: stop-at-login stopped it and removed the service file"
