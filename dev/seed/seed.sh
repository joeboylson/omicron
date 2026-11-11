#!/usr/bin/env bash
# Wipe the dev (test) Supabase and fill it with made-up data to click around
# in. Run inside the omicron-dev test machine:
#   bash ~/omicron/dev/seed/seed.sh
# Never touches the real Supabase.
set -euo pipefail
env_value() { grep -E "^$1=" "$HOME/supabase/.env" | head -1 | cut -d= -f2-; }
export OMICRON_SUPABASE_URL=http://localhost:8000
export OMICRON_SUPABASE_KEY=$(env_value ANON_KEY)
export OMICRON_SUPABASE_SECRET_KEY=$(env_value SERVICE_ROLE_KEY)
export CARGO_TARGET_DIR=$HOME/target
export OMICRON_BIN=$CARGO_TARGET_DIR/debug/omicron
cd "$HOME/omicron"
"$HOME/.cargo/bin/cargo" build -q
bash dev/supabase/migrate.sh --reset >/dev/null 2>&1 || bash dev/supabase/migrate.sh --reset
node dev/seed/seed.js
