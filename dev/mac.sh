#!/usr/bin/env bash
# Run Omicron for real on this Mac (atlas): build, install to
# ~/.local/bin/omicron, and (re)start the web page and the daemon in tmux.
#   bash dev/mac.sh          # build, install, restart
#   bash dev/mac.sh restart  # restart without building
#   bash dev/mac.sh stop
#
# It also runs a dev web page on 127.0.0.1:9011 against the dev (test)
# Supabase, with settings in ~/.omicron-dev, to click around in seeded data
# (dev/seed/seed.sh resets it). The real data is never touched by it.
#
# The web page listens on 127.0.0.1:9010; the home lab's admin-only gate
# puts it on the tailnet at https://atlas.taileedd95.ts.net:8451. Settings
# are in ~/.omicron/config.json (`omicron setup`).
#
# Claude sessions get Omicron's hooks from a separate settings file, so
# Claude Code's own settings stay as they are:
#   claude --settings ~/.omicron/claude/settings.json
set -euo pipefail
cd "$(dirname "$0")/.."
port=9010
host=atlas.taileedd95.ts.net

stop() {
  tmux kill-session -t omicron-dev-serve 2>/dev/null || true
  tmux kill-session -t omicron-serve 2>/dev/null || true
  tmux kill-session -t omicron-daemon 2>/dev/null || true
}

case "${1:-}" in
  stop) stop; echo "stopped"; exit 0 ;;
  restart) ;;
  *)
    bin=$(bash dev/build.sh)
    mkdir -p "$HOME/.local/bin"
    cp "$bin" "$HOME/.local/bin/omicron.new" && mv "$HOME/.local/bin/omicron.new" "$HOME/.local/bin/omicron"
    "$HOME/.local/bin/omicron" sessions setup-claude --settings "$HOME/.omicron/claude/settings.json" >/dev/null
    ;;
esac

stop
log=$HOME/.omicron
tmux new-session -d -s omicron-serve "$HOME/.local/bin/omicron serve --port $port --host $host 2>&1 | tee -a $log/serve.log"
tmux new-session -d -s omicron-daemon "$HOME/.local/bin/omicron daemon 2>>$log/daemon.log >/dev/null"
if [ -f "$HOME/.omicron-dev/config.json" ]; then
  # host.lima.internal: so the test machine's browser can take screenshots.
  tmux new-session -d -s omicron-dev-serve "OMICRON_HOME=$HOME/.omicron-dev $HOME/.local/bin/omicron serve --port 9011 --host $host --host host.lima.internal 2>&1 | tee -a $HOME/.omicron-dev/serve.log"
fi
sleep 2
curl -s -o /dev/null -w "web page on 127.0.0.1:$port: %{http_code}\n" "http://127.0.0.1:$port/"
[ -f "$HOME/.omicron-dev/config.json" ] && curl -s -o /dev/null -w "dev web page on 127.0.0.1:9011: %{http_code}\n" "http://127.0.0.1:9011/"
"$HOME/.local/bin/omicron" machines awake | grep -qx atlas && echo "daemon: atlas is awake"
