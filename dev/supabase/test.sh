#!/usr/bin/env bash
# Run every test, including the ones that need Supabase. Run inside the VM:
#   bash ~/omicron/dev/supabase/test.sh [cargo test args]
set -euo pipefail
env_value() { grep -E "^$1=" "$HOME/supabase/.env" | head -1 | cut -d= -f2-; }
export OMICRON_SUPABASE_URL=http://localhost:8000
export OMICRON_SUPABASE_KEY=$(env_value ANON_KEY)
export OMICRON_SUPABASE_SECRET_KEY=$(env_value SERVICE_ROLE_KEY)
export CARGO_TARGET_DIR=$HOME/target
cd "$HOME/omicron"
"$HOME/.cargo/bin/cargo" test "$@"
