#!/usr/bin/env bash
# Run the browser tests inside the omicron-dev VM:
#   bash ~/omicron/dev/e2e.sh [playwright args]
# Installs Node and Playwright's Chromium the first time.
set -euo pipefail

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -q nodejs
fi

env_value() { grep -E "^$1=" "$HOME/supabase/.env" | head -1 | cut -d= -f2-; }
export OMICRON_SUPABASE_URL=http://localhost:8000
export OMICRON_SUPABASE_KEY=$(env_value ANON_KEY)
export OMICRON_SUPABASE_SECRET_KEY=$(env_value SERVICE_ROLE_KEY)
export CARGO_TARGET_DIR=$HOME/target
export OMICRON_BIN=$CARGO_TARGET_DIR/debug/omicron

cd "$HOME/omicron"
"$HOME/.cargo/bin/cargo" build -q

# node_modules lives on the VM's disk, not in the mounted folder.
deps=$HOME/omicron-e2e-deps
mkdir -p "$deps"
cp e2e/package.json "$deps/"
(cd "$deps" && npm install --silent --no-audit --no-fund && npx playwright install --with-deps chromium >/dev/null)
export NODE_PATH=$deps/node_modules
cd e2e
"$deps/node_modules/.bin/playwright" test "$@"
